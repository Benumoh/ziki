import "server-only";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import tls from "node:tls";
import { getDomain } from "tldts";
import type { SecuritySeverity, SecurityTargetKind } from "@prisma/client";
import { logger } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PREVIEW_SCANS_PER_VISITOR_PER_HOUR, scanLimitsEnabled } from "@/lib/security-checks";
import { isPublicAddress, PrivateAddressError, publicOnlyLookup, realNetwork } from "@/lib/security-checks/ownership";
import { parseSecurityTarget } from "@/lib/security-checks/target";
import { osvLookup, type OsvLookup } from "@/lib/security-checks/osv";
import { repoReader, type RepoReader } from "@/lib/security-checks/repo-reader";
import { dependabotFindings, dependencyFindings, filesToRead, hygieneFindings, packagesIn, secretFileFindings, secretFindings, workflowFindings } from "@/lib/security-checks/repo-scan";

/**
 * The quick preview scan on the public security page (#security-checks, 12 Nov
 * plan, part D3). Code only: no agents and no AI, so it costs almost nothing,
 * and the same site gives the same answer every time. Since 18 Nov it also
 * checks the yes/no facts agents used to find only sometimes (old TLS versions
 * accepted, the certificate's names, robots.txt and security.txt, more headers,
 * cookie scoping), and a scan's findings join its main list (code-findings.ts).
 *
 * It reads only what any visitor's browser already gets from a site: the
 * homepage's response headers and cookies, its HTTPS certificate (and whether
 * the server still agrees to TLS 1.0 or 1.1), robots.txt and
 * /.well-known/security.txt (the two files sites publish for visitors and
 * crawlers), and the domain's public SPF and DMARC records. It never probes: no
 * login forms, no guessed paths, no port scans. Every connection goes through the same
 * public-only lookup as the ownership check, so a link can't point Ziki at a
 * private network, by name, by number or by DNS rebinding.
 *
 * The result is shown blurred until the site is proven to be the client's.
 * It is rate-limited per visitor and cached per link for a short while.
 */

/** How long one link's result is reused. */
export const PREVIEW_CACHE_MS = 10 * 60 * 1000;

const TIMEOUT_MS = 5_000;
/** How much of a public text file (robots.txt, security.txt) is read. */
const TEXT_MAX_CHARS = 64_000;
/** Same-site redirects followed for a public text file. */
const TEXT_MAX_REDIRECTS = 3;
/** Same-site HTTPS redirects followed before the homepage is called unreadable (browsers allow about 20). */
export const MAX_REDIRECTS = 10;
const EXPIRING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PreviewArea = "https" | "certificate" | "headers" | "cookies" | "files" | "email" | "secrets" | "policy" | "updates" | "dependencies" | "workflows";

export type PreviewFinding = {
  /** Stable for each kind of problem, so a page can key and count them. */
  id: string;
  severity: SecuritySeverity;
  area: PreviewArea;
  title: string;
  detail: string;
};

export type PreviewResult =
  | {
      ok: true;
      kind: SecurityTargetKind;
      target: string;
      checkedAt: string;
      /** Which areas were looked at, so "no problems" is honest about what it covers. */
      checked: PreviewArea[];
      counts: Record<SecuritySeverity, number>;
      /** Worst first. */
      findings: PreviewFinding[];
      /** What it saw, as short hashes per part, so a rescan can tell whether the site changed (18 Nov). */
      fingerprint?: SiteFingerprint;
    }
  | { ok: false; reason: string; retryAfterSeconds?: number };

/** The parts of a site whose fingerprint is kept, each a short hash of what the quick scan saw. */
export type FingerprintPart = "certificate" | "tls" | "headers" | "cookies" | "files" | "email" | "repo";
export type SiteFingerprint = Partial<Record<FingerprintPart, string>>;

const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
/** The security headers whose values are kept, with per-request values (CSP nonces) left out so they don't look like changes. */
const FINGERPRINT_HEADERS = [
  "strict-transport-security", "content-security-policy", "content-security-policy-report-only", "x-frame-options", "x-content-type-options",
  "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "server", "x-powered-by",
];

/** Cookie names and settings, without their values or expiry, which change on every visit. */
function cookieShape(headers: PageAnswer["headers"]): string[] {
  const raw = headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((cookie) => {
      const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
      const kept = attributes.map((part) => part.toLowerCase()).filter((part) => !/^(expires|max-age)=/.test(part)).sort();
      return [pair!.split("=")[0], ...kept].join(";");
    })
    .sort();
}

/* ------------------------------------------------------------------ */
/* The network, behind one seam so the rules can be tested             */
/* ------------------------------------------------------------------ */

export type PageAnswer = { status: number; location: string | null; headers: Record<string, string | string[] | undefined> };

export type CertificateAnswer = {
  /** Whether the certificate chain is trusted for this name. */
  authorized: boolean;
  authorizationError: string | null;
  validTo: Date | null;
  /** The TLS version agreed, for example "TLSv1.3". */
  protocol: string | null;
  /** The host names the certificate covers (its subject alternative names). Absent when not read. */
  names?: string[];
};

/** A small public text file, such as robots.txt: its status and the start of its body. */
export type TextAnswer = { status: number; body: string };

export type PreviewNetwork = {
  /** One GET that reads the headers only, never following redirects itself. */
  page(url: string): Promise<PageAnswer>;
  /** The HTTPS certificate on port 443, or null when nothing answers there. */
  certificate(host: string): Promise<CertificateAnswer | null>;
  /** TXT records for a name; empty when there are none. */
  txt(host: string): Promise<string[][]>;
  /** Which of the old TLS versions (TLSv1, TLSv1.1) the server on port 443 still agrees to; empty when none. */
  oldTls?(host: string): Promise<string[]>;
  /** One GET of a small public text file, following same-site HTTPS redirects (example.com to www.example.com); null when nothing answers. */
  text?(url: string): Promise<TextAnswer | null>;
  /** A reader for a repo (repo-reader.ts): public ones only, unless `access` names the workspace's App installation. */
  repo(owner: string, name: string, access: { installationId: string | null }): Promise<RepoReader>;
  /** Known security holes in packages (osv.ts). */
  osv: OsvLookup;
};

/* ------------------------------------------------------------------ */
/* The scan                                                            */
/* ------------------------------------------------------------------ */

const REPO_NOT_FOUND = "We couldn't see that repo on GitHub. It may be private or the name may be wrong. To check a private repo, connect it to a project with Ziki's GitHub App first.";
const REPO_UNAVAILABLE = "We couldn't read that repo from GitHub just now. Try again in a little while.";
const unavailableReason = (detail?: string) => (detail ? `We couldn't read that repo from GitHub just now (${detail}). Try again in a little while.` : REPO_UNAVAILABLE);
const LIMIT_REASON = "You've run a few previews already. Try again in a little while, or sign up to check your site properly.";
const NOT_PUBLIC = "That address points inside a private network, so Ziki won't look at it.";

const cache = new Map<string, { at: number; result: Extract<PreviewResult, { ok: true }> }>();

/**
 * Preview a pasted link. `visitor` is the visitor's IP (or another stable key)
 * for the rate limit. Never throws: a problem comes back as a plain reason.
 */
export async function previewScan(
  link: string,
  {
    visitor,
    network = realPreviewNetwork,
    now = Date.now(),
    limited = scanLimitsEnabled(),
    fresh = false,
    repoAccess = null,
  }: {
    visitor: string;
    network?: PreviewNetwork;
    now?: number;
    limited?: boolean;
    fresh?: boolean;
    /** For a private repo: the workspace's App installation (`privateRepoAccess`). Only signed-in callers pass it. */
    repoAccess?: { installationId: string } | null;
  },
): Promise<PreviewResult> {
  const parsed = parseSecurityTarget(link);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  const { kind, value } = parsed.target;

  // `fresh` skips the 10-minute reuse: a fix was paid for since the last look (#security-rescan, 17 Nov), so look again.
  // A private repo's result is kept apart, so a visitor without access never gets it from the cache.
  const cacheKey = `${kind}:${value}:${repoAccess?.installationId ?? "public"}`;
  const cached = cache.get(cacheKey);
  if (!fresh && cached && now - cached.at < PREVIEW_CACHE_MS) return cached.result;

  // The per-visitor limit counts only while scan limits are on (14 Nov plan: off for now, not removed).
  if (limited) {
    const limit = await consumeRateLimit(`security-preview:${visitor}`, { max: PREVIEW_SCANS_PER_VISITOR_PER_HOUR, windowMs: 60 * 60 * 1000 }, now);
    if (!limit.allowed) return { ok: false, reason: LIMIT_REASON, retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000) };
  }

  try {
    const result = kind === "repo" ? await scanRepo(value, network, now, repoAccess) : await scan(kind, value, network, now);
    if (result.ok) {
      cache.set(cacheKey, { at: now, result });
      for (const [key, entry] of cache) if (now - entry.at >= PREVIEW_CACHE_MS) cache.delete(key);
    }
    return result;
  } catch (error) {
    if (error instanceof PrivateAddressError) return { ok: false, reason: NOT_PUBLIC };
    return { ok: false, reason: `We couldn't reach ${value} just now. Check it opens in a browser, then try again.` };
  }
}

/** Forget cached results (tests). */
export function clearPreviewCache(): void {
  cache.clear();
}

async function scan(
  kind: Exclude<SecurityTargetKind, "repo">,
  value: string,
  network: PreviewNetwork,
  now: number,
): Promise<PreviewResult> {
  const host = isIP(value) === 6 ? `[${value}]` : value;
  // Mail records live on the registrable domain (app.example.co.uk -> example.co.uk), not on each subdomain.
  const mailDomain = kind === "website" ? emailDomainFor(value) : null;
  const readText = (path: string) => (kind === "website" && network.text ? network.text(`https://${host}${path}`).catch(rethrowPrivate) : Promise.resolve(null));
  const [home, plain, certificate, spf, dmarc, oldTls, robots, securityTxt] = await Promise.all([
    homepage(network, `https://${host}/`, value).catch(rethrowPrivate),
    network.page(`http://${host}/`).catch(rethrowPrivate),
    network.certificate(value).catch(rethrowPrivate),
    mailDomain ? readTxt(network, mailDomain) : Promise.resolve(null),
    mailDomain ? readDmarc(network, value, mailDomain) : Promise.resolve(null),
    network.oldTls ? network.oldTls(value).catch(rethrowPrivate) : Promise.resolve(null),
    readText("/robots.txt"),
    readText("/.well-known/security.txt"),
  ]);
  // Too many redirects says nothing about HTTPS either way: don't call it missing.
  const tooManyRedirects = home === TOO_MANY_REDIRECTS;
  const secure = tooManyRedirects ? null : home;

  if (!secure && !plain && !tooManyRedirects) {
    return { ok: false, reason: `${value} didn't answer on the web (ports 80 and 443). Check it opens in a browser, then try again.` };
  }

  const findings: PreviewFinding[] = [];
  const checked: PreviewArea[] = tooManyRedirects ? [] : ["https"];

  if (tooManyRedirects) {
    // Couldn't check: the homepage kept redirecting on its own site, so HTTPS isn't judged.
  } else if (!secure) {
    findings.push({
      id: "no-https",
      severity: "high",
      area: "https",
      title: "The site doesn't work over HTTPS",
      detail: `${value} answers on plain HTTP but not on HTTPS, so what visitors send and receive can be read or changed on the way.`,
    });
  } else if (plain && !redirectsToHttps(plain, value)) {
    findings.push({
      id: "no-https-redirect",
      severity: "medium",
      area: "https",
      title: "Plain HTTP doesn't send visitors to HTTPS",
      detail: `http://${value} doesn't redirect to https://, so anyone who types the address without https stays on an unprotected connection.`,
    });
  }

  if (certificate) {
    checked.push("certificate");
    findings.push(...certificateFindings(certificate, kind, value, now, oldTls));
  }

  // Headers and cookies are read from the site's own page, not from a redirect that sends visitors elsewhere.
  const page = secure && (secure.status < 300 || secure.status >= 400) ? secure : null;
  if (page) {
    checked.push("headers", "cookies");
    findings.push(...headerFindings(page.headers));
    findings.push(...cookieFindings(page.headers));
  }

  // A file is only judged when the site answered for it: a request that failed says nothing.
  if (robots || securityTxt) {
    checked.push("files");
    findings.push(...publicFileFindings(robots, securityTxt, value, now));
  }

  // A record is only called missing when the lookup really answered: a lookup that failed says nothing.
  if (mailDomain && (spf !== null || dmarc !== null)) {
    checked.push("email");
    findings.push(...emailFindings(spf, dmarc, mailDomain));
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts: Record<SecuritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  // A part is only fingerprinted when it was really seen, so a failed look never reads as a change.
  const fingerprint: SiteFingerprint = {};
  if (certificate) fingerprint.certificate = hashOf([certificate.validTo?.toISOString() ?? null, [...(certificate.names ?? [])].sort(), certificate.authorized]);
  if (certificate && oldTls) fingerprint.tls = hashOf([certificate.protocol, oldTls]);
  if (page) {
    fingerprint.headers = hashOf(FINGERPRINT_HEADERS.map((name) => (header(page.headers, name) ?? "").replace(/'nonce-[^']*'/g, "'nonce'")));
    fingerprint.cookies = hashOf(cookieShape(page.headers));
  }
  if (robots || securityTxt) fingerprint.files = hashOf([robots?.status ?? null, robots?.body ?? null, securityTxt?.status ?? null, securityTxt?.body ?? null]);
  if (mailDomain && (spf !== null || dmarc !== null)) fingerprint.email = hashOf([spf, dmarc]);
  return { ok: true, kind, target: value, checkedAt: new Date(now).toISOString(), checked, counts, findings, fingerprint };
}

/* ------------------------------------------------------------------ */
/* A public repo                                                       */
/* ------------------------------------------------------------------ */

/**
 * The repo quick scan (#security-repo-scan, 18 Nov): Ziki reads the repo itself, in seconds, with no agents. A public
 * repo is read as any visitor could; a private one only through the workspace's GitHub App (`repoAccess`). It opens
 * lockfiles, workflows and a few config files (repo-scan.ts says which and why), looks package versions up in OSV.dev,
 * and adds GitHub's own Dependabot alerts when the App may read them. It never runs anything and never repeats a secret.
 */
async function scanRepo(value: string, network: PreviewNetwork, now: number, repoAccess: { installationId: string } | null): Promise<PreviewResult> {
  const [owner, name] = value.split("/");
  const reader = await network.repo(owner!, name!, { installationId: repoAccess?.installationId ?? null });
  const meta = await reader.meta();
  if (meta.status === "not_found") return { ok: false, reason: REPO_NOT_FOUND };
  if (meta.status === "unavailable") return { ok: false, reason: unavailableReason(meta.detail) };
  const tree = await reader.tree();
  if (!tree) return { ok: false, reason: REPO_UNAVAILABLE };
  const files = tree.files;

  const findings: PreviewFinding[] = [...secretFileFindings(value, files), ...hygieneFindings(value, files, meta.pushedAt, now)];
  const checked: PreviewArea[] = ["secrets", "policy", "updates", "workflows"];
  const toRead = filesToRead(files);
  const read = async (path: string) => ({ path, text: await reader.file(path) });
  const [locks, workflows, configs, alerts] = await Promise.all([
    Promise.all(toRead.lockfiles.map(read)),
    Promise.all(toRead.workflows.map(read)),
    Promise.all(toRead.configs.map(read)),
    reader.dependabotAlerts(),
  ]);

  // Workflows are checked for risky patterns and for keys pasted into them.
  for (const { path, text } of workflows) if (text) findings.push(...workflowFindings(path, text), ...secretFindings(path, text));
  for (const { path, text } of configs) if (text) findings.push(...secretFindings(path, text));

  // Packages: GitHub's own alerts when the App may read them, else (or as well) OSV.dev for the versions in lockfiles.
  const packages = locks.flatMap(({ path, text }) => (text ? packagesIn(path, text) : []));
  const fromGitHub = alerts ? dependabotFindings(alerts) : [];
  const vulnerable = packages.length ? await network.osv(packages) : [];
  const fromOsv = vulnerable ? dependencyFindings(vulnerable) : [];
  if (packages.length || fromGitHub.length) checked.push("dependencies");
  const seen = new Set(fromGitHub.map((finding) => finding.id));
  findings.push(...fromGitHub, ...fromOsv.filter((finding) => !seen.has(finding.id)));

  // One finding per id: the same secret file can't be counted twice.
  const unique = [...new Map(findings.map((finding) => [finding.id, finding])).values()];
  unique.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts: Record<SecuritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of unique) counts[finding.severity] += 1;
  const fingerprint: SiteFingerprint = { repo: hashOf([files.map((file) => `${file.path}:${file.size}`).sort()]) };
  return { ok: true, kind: "repo", target: value, checkedAt: new Date(now).toISOString(), checked, counts, findings: unique, fingerprint };
}

const SEVERITY_ORDER: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** A private address stops the whole preview; any other failure just means "didn't answer". */
function rethrowPrivate(error: unknown): null {
  if (error instanceof PrivateAddressError || (error as { code?: string } | null)?.code === "EPRIVATE") {
    throw error instanceof PrivateAddressError ? error : new PrivateAddressError("private");
  }
  return null;
}

/** TXT records, asked twice before giving up; null when no answer came (not the same as "no records"). */
async function readTxt(network: PreviewNetwork, host: string): Promise<string[][] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await network.txt(host);
    } catch {
      // Try once more: a busy resolver often answers the second time.
    }
  }
  return null;
}

/** The registrable domain whose SPF and DMARC records cover `host`; the host itself when it has none (an IP, localhost). */
export function emailDomainFor(host: string): string {
  return getDomain(host, { allowPrivateDomains: false }) ?? host;
}

/**
 * The DMARC records that apply to `host`: its own `_dmarc` record, else the
 * registrable domain's (RFC 7489 section 6.6.3). Null when a lookup didn't answer.
 */
async function readDmarc(network: PreviewNetwork, host: string, mailDomain: string): Promise<string[][] | null> {
  const own = await readTxt(network, `_dmarc.${host}`);
  if (host === mailDomain || own === null) return own;
  const hasPolicy = own.some((parts) => parts.join("").trim().toLowerCase().startsWith("v=dmarc1"));
  return hasPolicy ? own : readTxt(network, `_dmarc.${mailDomain}`);
}

const TOO_MANY_REDIRECTS = "too_many_redirects" as const;

/**
 * The homepage's headers, following same-site HTTPS redirects. Null when it
 * doesn't answer; TOO_MANY_REDIRECTS when it still redirects after MAX_REDIRECTS.
 */
async function homepage(network: PreviewNetwork, start: string, site: string): Promise<PageAnswer | typeof TOO_MANY_REDIRECTS | null> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const answer = await network.page(url.toString());
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      const next = new URL(answer.location, url);
      // Stay on the same site over HTTPS: the preview is about this site, not wherever it points.
      if (next.protocol !== "https:" || !sameSite(next.hostname, site)) return answer;
      url = next;
      continue;
    }
    return answer;
  }
  return TOO_MANY_REDIRECTS;
}

function sameSite(host: string, site: string): boolean {
  return host.replace(/^\[|\]$/g, "").replace(/^www\./, "") === site.replace(/^www\./, "");
}

function redirectsToHttps(answer: PageAnswer, site: string): boolean {
  if (answer.status < 300 || answer.status >= 400 || !answer.location) return false;
  try {
    const next = new URL(answer.location, `http://${site}/`);
    return next.protocol === "https:" && sameSite(next.hostname, site);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* What each answer says (pure, so each rule is tested on its own)     */
/* ------------------------------------------------------------------ */

export function certificateFindings(
  certificate: CertificateAnswer,
  kind: Exclude<SecurityTargetKind, "repo">,
  value: string,
  now: number,
  /** Which old TLS versions the server still agrees to when asked for one; null when that wasn't checked. */
  oldTls: readonly string[] | null = null,
): PreviewFinding[] {
  const findings: PreviewFinding[] = [];
  const expired = certificate.validTo !== null && certificate.validTo.getTime() <= now;
  if (expired) {
    findings.push({
      id: "certificate-expired",
      severity: "high",
      area: "certificate",
      title: "The HTTPS certificate has expired",
      detail: `The certificate on ${value} expired on ${certificate.validTo!.toISOString().slice(0, 10)}. Browsers warn visitors away from the site.`,
    });
  } else if (certificate.validTo !== null && certificate.validTo.getTime() - now < EXPIRING_DAYS * DAY_MS) {
    findings.push({
      id: "certificate-expiring",
      severity: "medium",
      area: "certificate",
      title: "The HTTPS certificate expires soon",
      detail: `The certificate on ${value} expires on ${certificate.validTo.toISOString().slice(0, 10)}. If it isn't renewed, browsers will warn visitors away.`,
    });
  }
  // A server reached by its IP rarely has a certificate for that IP, so only a website's name is held to it.
  const nameMismatchOnIp = kind === "server" && certificate.authorizationError === "ERR_TLS_CERT_ALTNAME_INVALID";
  if (!certificate.authorized && !expired && !nameMismatchOnIp) {
    findings.push({
      id: "certificate-untrusted",
      severity: "high",
      area: "certificate",
      title: "Browsers don't trust the HTTPS certificate",
      detail: `The certificate on ${value} isn't trusted (${certificate.authorizationError ?? "unknown reason"}), so visitors see a security warning.`,
    });
  }
  if (certificate.protocol === "TLSv1" || certificate.protocol === "TLSv1.1") {
    findings.push({
      id: "old-tls",
      severity: "medium",
      area: "certificate",
      title: "The site still uses an old version of TLS",
      detail: `${value} agreed to ${certificate.protocol}, which browsers no longer consider safe. TLS 1.2 or 1.3 should be the minimum.`,
    });
  } else if (oldTls && oldTls.length > 0) {
    // It uses a modern version by default but still agrees to an old one when a client asks for it.
    findings.push({
      id: "old-tls-accepted",
      severity: "low",
      area: "certificate",
      title: "The site still accepts old versions of TLS",
      detail: `${value} still agrees to ${oldTls.map((version) => (version === "TLSv1" ? "TLS 1.0" : version.replace("TLSv", "TLS "))).join(" and ")} when a visitor asks for it. Browsers dropped these years ago; TLS 1.2 or 1.3 should be the minimum.`,
    });
  }
  const internal = internalNames(certificate.names ?? [], value);
  if (internal.length > 0) {
    findings.push({
      id: "certificate-internal-names",
      severity: "low",
      area: "certificate",
      title: "The certificate lists internal-looking host names",
      detail: `The certificate on ${value} also covers ${internal.slice(0, 5).join(", ")}${internal.length > 5 ? ` and ${internal.length - 5} more` : ""}. Anyone can read these names, which point to staging, test or internal systems worth hiding.`,
    });
  }
  return findings;
}

/** Labels that usually name a staging, test or internal system. */
const INTERNAL_LABEL = /^(?:staging|stage|stg|dev|develop|development|internal|intranet|test|testing|qa|uat|preprod|pre-prod|sandbox|corp)\d*$/;

/** The certificate's names, other than the site itself, that look internal (a label like staging, dev or internal). */
export function internalNames(names: readonly string[], value: string): string[] {
  const site = value.toLowerCase().replace(/^www\./, "");
  return [...new Set(names.map((name) => name.toLowerCase()))].filter((name) => {
    if (name.replace(/^\*\./, "").replace(/^www\./, "") === site) return false;
    return name.split(".").some((label) => label.split("-").some((part) => INTERNAL_LABEL.test(part)));
  });
}


function header(headers: PageAnswer["headers"], name: string): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : null;
}

export function headerFindings(headers: PageAnswer["headers"]): PreviewFinding[] {
  const findings: PreviewFinding[] = [];
  const csp = header(headers, "content-security-policy");
  if (!header(headers, "strict-transport-security")) {
    findings.push({
      id: "missing-hsts",
      severity: "medium",
      area: "headers",
      title: "Browsers aren't told to always use HTTPS",
      detail: "There is no Strict-Transport-Security header, so a visitor's first visit can be pushed onto plain HTTP.",
    });
  }
  if (!csp) {
    findings.push({
      id: "missing-csp",
      severity: "medium",
      area: "headers",
      title: "No Content Security Policy",
      detail: "There is no Content-Security-Policy header limiting where scripts may load from, which makes injected scripts (XSS) more harmful.",
    });
  }
  if (!header(headers, "x-frame-options") && !/frame-ancestors/i.test(csp ?? "")) {
    findings.push({
      id: "missing-frame-protection",
      severity: "medium",
      area: "headers",
      title: "Other sites can show this one inside a frame",
      detail: "Neither X-Frame-Options nor a frame-ancestors rule is set, so another site can load this one in a hidden frame and trick visitors into clicking (clickjacking).",
    });
  }
  if ((header(headers, "x-content-type-options") ?? "").toLowerCase() !== "nosniff") {
    findings.push({
      id: "missing-nosniff",
      severity: "low",
      area: "headers",
      title: "Browsers may guess file types",
      detail: "X-Content-Type-Options: nosniff is not set, so a browser may treat an uploaded file as a script.",
    });
  }
  if (!header(headers, "referrer-policy")) {
    findings.push({
      id: "missing-referrer-policy",
      severity: "low",
      area: "headers",
      title: "Full page addresses may leak to other sites",
      detail: "There is no Referrer-Policy header, so links to other sites may pass on the full address of the page the visitor came from.",
    });
  }
  if (!header(headers, "permissions-policy")) {
    findings.push({
      id: "missing-permissions-policy",
      severity: "low",
      area: "headers",
      title: "Browsers aren't told which features the site may use",
      detail: "There is no Permissions-Policy header, so an injected or embedded script can ask for the camera, microphone, location and similar features without the site ruling them out.",
    });
  }
  if (!header(headers, "cross-origin-opener-policy")) {
    findings.push({
      id: "missing-cross-origin-isolation",
      severity: "low",
      area: "headers",
      title: "No cross-origin isolation headers",
      detail: "There is no Cross-Origin-Opener-Policy header, so a page this site opens, or that opens it, keeps a handle on its window, which some cross-site attacks rely on.",
    });
  }
  const server = header(headers, "server");
  const poweredBy = header(headers, "x-powered-by");
  if ((server && /\d/.test(server)) || poweredBy) {
    findings.push({
      id: "version-disclosure",
      severity: "low",
      area: "headers",
      title: "The site says what software it runs",
      detail: "The response headers name the server software or framework (sometimes with its version), which helps an attacker look up known holes.",
    });
  }
  return findings;
}

export function cookieFindings(headers: PageAnswer["headers"]): PreviewFinding[] {
  const raw = headers["set-cookie"];
  const cookies = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((cookie) => cookie.toLowerCase());
  if (cookies.length === 0) return [];
  const attributes = (cookie: string) => cookie.split(";").slice(1).map((part) => part.trim().split("=")[0]);
  const count = (missing: (attrs: string[]) => boolean) => cookies.filter((cookie) => missing(attributes(cookie))).length;
  const plural = (n: number) => (n === 1 ? "1 cookie" : `${n} cookies`);

  const findings: PreviewFinding[] = [];
  const insecure = count((attrs) => !attrs.includes("secure"));
  if (insecure) {
    findings.push({
      id: "cookie-not-secure",
      severity: "medium",
      area: "cookies",
      title: "Cookies can be sent without HTTPS",
      detail: `${plural(insecure)} set on the homepage lack the Secure flag, so they can travel over plain HTTP where they can be read.`,
    });
  }
  const scriptReadable = count((attrs) => !attrs.includes("httponly"));
  if (scriptReadable) {
    findings.push({
      id: "cookie-not-httponly",
      severity: "low",
      area: "cookies",
      title: "Scripts on the page can read cookies",
      detail: `${plural(scriptReadable)} set on the homepage lack the HttpOnly flag. If any of them keeps someone signed in, an injected script could steal it.`,
    });
  }
  const noSameSite = count((attrs) => !attrs.includes("samesite"));
  if (noSameSite) {
    findings.push({
      id: "cookie-no-samesite",
      severity: "low",
      area: "cookies",
      title: "Cookies don't say when other sites may send them",
      detail: `${plural(noSameSite)} set on the homepage have no SameSite setting, which leaves more room for cross-site request forgery.`,
    });
  }
  const domainWide = count((attrs) => attrs.includes("domain"));
  if (domainWide) {
    findings.push({
      id: "cookie-domain-wide",
      severity: "low",
      area: "cookies",
      title: "Cookies are shared with every subdomain",
      detail: `${plural(domainWide)} set on the homepage name a Domain, so every subdomain of the site receives them, including any that are less well looked after.`,
    });
  }
  return findings;
}

/** Words in a robots.txt path that usually point to something private. */
const PRIVATE_PATH = /(?:^|[/_.-])(?:admin|administrator|internal|staging|private|backup|backups|secret|secrets|config|debug|test|dev|cms|wp-admin|phpmyadmin)(?:$|[/_.-])/i;

/**
 * robots.txt and /.well-known/security.txt. `null` for either means the site didn't answer for it, so nothing is said
 * about it. robots.txt is only read for the paths it lists; security.txt only for whether it exists, says who to
 * contact, and hasn't expired.
 */
export function publicFileFindings(robots: TextAnswer | null, securityTxt: TextAnswer | null, value: string, now: number): PreviewFinding[] {
  const findings: PreviewFinding[] = [];
  if (robots && robots.status === 200) {
    const paths = robots.body
      .split(/\r?\n/)
      .map((line) => /^\s*(?:dis)?allow\s*:\s*(\S+)/i.exec(line)?.[1] ?? "")
      .filter((path) => path && PRIVATE_PATH.test(path));
    const unique = [...new Set(paths)];
    if (unique.length > 0) {
      findings.push({
        id: "robots-private-paths",
        severity: "low",
        area: "files",
        title: "robots.txt points to private pages",
        detail: `${value}/robots.txt names ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ` and ${unique.length - 5} more` : ""}. The file is public, so it tells anyone where the private pages are; they should be protected by sign-in, not hidden by name.`,
      });
    }
  }
  if (securityTxt) {
    const body = securityTxt.status === 200 ? securityTxt.body : "";
    const contact = /^\s*contact\s*:/im.test(body);
    const expires = /^\s*expires\s*:\s*(\S+)/im.exec(body)?.[1];
    const expiredAt = expires ? Date.parse(expires) : Number.NaN;
    if (!contact) {
      findings.push({
        id: "missing-security-txt",
        severity: "low",
        area: "files",
        title: "No security.txt telling people how to report problems",
        detail: `${value} has no /.well-known/security.txt with a Contact line, so a person who finds a problem doesn't know where to report it privately.`,
      });
    } else if (!Number.isNaN(expiredAt) && expiredAt <= now) {
      findings.push({
        id: "security-txt-expired",
        severity: "low",
        area: "files",
        title: "The site's security.txt has expired",
        detail: `${value}/.well-known/security.txt expired on ${new Date(expiredAt).toISOString().slice(0, 10)}, so people may not trust its contact details.`,
      });
    }
  }
  return findings;
}

/** `null` for either means its lookup didn't answer, so nothing is said about it. */
export function emailFindings(spf: readonly (readonly string[])[] | null, dmarc: readonly (readonly string[])[] | null, domain: string): PreviewFinding[] {
  const join = (records: readonly (readonly string[])[]) => records.map((parts) => parts.join("").trim().toLowerCase());
  const findings: PreviewFinding[] = [];
  if (spf !== null && !join(spf).some((record) => record.startsWith("v=spf1"))) {
    findings.push({
      id: "missing-spf",
      severity: "medium",
      area: "email",
      title: "Anyone can send email that claims to be from this domain",
      detail: `${domain} has no SPF record saying which servers may send its email, so spoofed mail is easier to pass off.`,
    });
  }
  if (dmarc === null) return findings;
  const policy = join(dmarc).find((record) => record.startsWith("v=dmarc1"));
  if (!policy) {
    findings.push({
      id: "missing-dmarc",
      severity: "medium",
      area: "email",
      title: "No DMARC policy for the domain's email",
      detail: `${domain} has no DMARC record, so receiving mail servers aren't told to reject mail that fakes the domain.`,
    });
  } else if (/(?:^|;)\s*p\s*=\s*none\b/.test(policy)) {
    findings.push({
      id: "dmarc-not-enforced",
      severity: "low",
      area: "email",
      title: "The DMARC policy only watches, it doesn't block",
      detail: `${domain}'s DMARC policy is p=none, so mail faking the domain is reported but still delivered.`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* The real network                                                    */
/* ------------------------------------------------------------------ */

const USER_AGENT = "ZikiSecurityPreview/1.0 (+https://ziki.dev/security)";

export const realPreviewNetwork: PreviewNetwork = {
  repo: (owner, name, access) => repoReader(owner, name, access),
  osv: osvLookup,
  async page(url) {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, "");
    // An address typed as a number skips the lookup, so check it here.
    if (isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError(host);
    const client = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.request(
        target,
        {
          method: "GET",
          agent: false,
          lookup: publicOnlyLookup(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // A certificate problem is reported by certificate(); here only the headers matter.
          rejectUnauthorized: false,
          headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.1" },
        },
        (response) => {
          // Only the headers are needed: stop before reading the page itself.
          resolve({
            status: response.statusCode ?? 0,
            location: typeof response.headers.location === "string" ? response.headers.location : null,
            headers: response.headers,
          });
          response.destroy();
        },
      );
      request.on("error", reject);
      request.end();
    });
  },
  async certificate(host) {
    if (isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError(host);
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host,
        port: 443,
        // A name is checked against the certificate; an IP can't be sent as SNI.
        servername: isIP(host) ? undefined : host,
        lookup: publicOnlyLookup(),
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      });
      const done = (answer: CertificateAnswer | null) => {
        socket.destroy();
        resolve(answer);
      };
      socket.once("secureConnect", () => {
        const peer = socket.getPeerCertificate();
        const authorizationError = socket.authorizationError ? String((socket.authorizationError as NodeJS.ErrnoException).code ?? socket.authorizationError) : null;
        done({
          authorized: socket.authorized,
          authorizationError,
          validTo: peer?.valid_to ? new Date(peer.valid_to) : null,
          protocol: socket.getProtocol(),
          names: (peer?.subjectaltname ?? "").split(",").map((name) => name.trim()).filter((name) => name.startsWith("DNS:")).map((name) => name.slice(4).toLowerCase()),
        });
      });
      socket.once("timeout", () => done(null));
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error instanceof PrivateAddressError || error.code === "EPRIVATE") reject(new PrivateAddressError(host));
        else done(null);
      });
    });
  },
  txt: (host) => realNetwork.txt(host),
  async oldTls(host) {
    if (isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError(host);
    const accepted: string[] = [];
    // One handshake per old version, nothing more: the same as an old browser connecting once.
    for (const version of ["TLSv1", "TLSv1.1"] as const) {
      const agreed = await new Promise<boolean>((resolve, reject) => {
        const socket = tls.connect({
          host,
          port: 443,
          servername: isIP(host) ? undefined : host,
          lookup: publicOnlyLookup(),
          rejectUnauthorized: false,
          timeout: TIMEOUT_MS,
          minVersion: version,
          maxVersion: version,
          // Old versions need OpenSSL's lowest security level to be offered at all; this only asks, it sends nothing.
          ciphers: "DEFAULT:@SECLEVEL=0",
        });
        const done = (yes: boolean) => {
          socket.destroy();
          resolve(yes);
        };
        socket.once("secureConnect", () => done(socket.getProtocol() === version));
        socket.once("timeout", () => done(false));
        socket.once("error", (error: NodeJS.ErrnoException) => {
          if (error instanceof PrivateAddressError || error.code === "EPRIVATE") reject(new PrivateAddressError(host));
          else done(false);
        });
      });
      if (agreed) accepted.push(version);
    }
    return accepted;
  },
  async text(url) {
    // Many sites send /robots.txt and /.well-known/security.txt on to www. (netflix.com does): follow that, on the same site only.
    let next = new URL(url);
    const site = next.hostname;
    for (let hop = 0; hop <= TEXT_MAX_REDIRECTS; hop++) {
      const answer = await readTextOnce(next);
      if (!answer || !answer.location) return answer && { status: answer.status, body: answer.body };
      const moved = new URL(answer.location, next);
      if (moved.protocol !== "https:" || !sameSite(moved.hostname, site)) return { status: answer.status, body: "" };
      next = moved;
    }
    return null;
  },
};

/** One GET of a small text file: its status, body (only on 200) and where a redirect points. */
async function readTextOnce(target: URL): Promise<(TextAnswer & { location: string | null }) | null> {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError(host);
  return new Promise((resolve, reject) => {
    const request = https.request(
      target,
      {
        method: "GET",
        agent: false,
        lookup: publicOnlyLookup(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        rejectUnauthorized: false,
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain,*/*;q=0.1" },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = status >= 300 && status < 400 && typeof response.headers.location === "string" ? response.headers.location : null;
        // A redirect or error page has no file to read.
        if (status !== 200) {
          response.destroy();
          resolve({ status, body: "", location });
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (body.length >= TEXT_MAX_CHARS) response.destroy();
        });
        response.on("close", () => resolve({ status, body: body.slice(0, TEXT_MAX_CHARS), location: null }));
        response.on("error", () => resolve({ status, body: body.slice(0, TEXT_MAX_CHARS), location: null }));
      },
    );
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof PrivateAddressError || error.code === "EPRIVATE") reject(new PrivateAddressError(host));
      else resolve(null);
    });
    request.end();
  });
}
