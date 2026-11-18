import { Prisma, type PrismaClient } from "@prisma/client";
import { SEVERITY_PRICE } from "@/lib/security-checks";
import { fixBucketOf } from "./fix-bucket";
import type { PreviewArea, PreviewFinding, PreviewResult } from "./preview";
import { PREVIEW_AREA_LABEL } from "./preview-summary";

/**
 * Ziki's own code checks join the scan's main list (18 Nov, Tolu). The quick scan is code: the same site gives the
 * same answer every time, so its findings are real findings, tickable, priced and sent to fix like an agent's. Each
 * area it looked at gets an `automatic` part ("Automatic check: Certificate"), saved already done, never given to
 * an agent and never counted as a part, so it doesn't change when a check starts or finishes. No agent is paid for
 * them (`payUnlockedFindings` pays only parts an agent did).
 *
 * On a rescan, code rechecks its own earlier findings: one the new quick scan still sees is still there, one it no
 * longer sees in an area it did look at is fixed, and only problems it hadn't found before are added. An earlier
 * finding whose fix is still in progress is left alone, as agents leave theirs (`toRecheck` in engine.ts).
 *
 * It also keeps the quick scan's fingerprint of the site on the check, so a rescan can say whether the site changed.
 */

/** How each code finding is fixed, by its kind (`PreviewFinding.id`, before any `:` detail). */
const HOW_TO_FIX: Record<string, string> = {
  "no-https": "Install a certificate (Let's Encrypt is free and most hosts set it up in one click) and serve the site over HTTPS.",
  "no-https-redirect": "Redirect every plain-HTTP request to the same address on https:// with a permanent (301) redirect, at the server or the host's settings.",
  "certificate-expired": "Renew the certificate now, and turn on automatic renewal so it can't lapse again.",
  "certificate-expiring": "Renew the certificate before it expires, and turn on automatic renewal.",
  "certificate-untrusted": "Use a certificate from a trusted authority that covers this exact name, and serve the full chain (including the intermediate certificate).",
  "old-tls": "Turn off TLS 1.0 and 1.1 in the server or CDN settings and allow only TLS 1.2 and 1.3.",
  "old-tls-accepted": "Turn off TLS 1.0 and 1.1 in the server or CDN settings and allow only TLS 1.2 and 1.3.",
  "certificate-internal-names": "Use a separate certificate for internal and staging hosts, or a wildcard certificate, so the public certificate doesn't list their names.",
  "missing-hsts": "Send Strict-Transport-Security: max-age=31536000; includeSubDomains on every HTTPS response, once every subdomain works over HTTPS.",
  "missing-csp": "Add a Content-Security-Policy header listing where scripts, styles and frames may load from. Start in report-only mode, then enforce it.",
  "missing-frame-protection": "Send X-Frame-Options: DENY, or a Content-Security-Policy with frame-ancestors 'none' (or 'self' if the site frames itself).",
  "missing-nosniff": "Send X-Content-Type-Options: nosniff on every response.",
  "missing-referrer-policy": "Send Referrer-Policy: strict-origin-when-cross-origin, or a stricter policy.",
  "missing-permissions-policy": "Send a Permissions-Policy header that turns off the features the site doesn't use, for example camera=(), microphone=(), geolocation=().",
  "missing-cross-origin-isolation": "Send Cross-Origin-Opener-Policy: same-origin (or same-origin-allow-popups if the site relies on pop-up sign-in).",
  "version-disclosure": "Remove the version from the Server header and drop X-Powered-By in the server or framework settings.",
  "cookie-not-secure": "Set the Secure flag on every cookie, so it is only ever sent over HTTPS.",
  "cookie-not-httponly": "Set HttpOnly on every cookie that scripts on the page don't need to read, above all sign-in and session cookies.",
  "cookie-no-samesite": "Set SameSite=Lax (or Strict) on every cookie; use SameSite=None only with Secure, for cookies other sites must receive.",
  "cookie-domain-wide": "Leave out the Domain attribute so each cookie stays on the host that set it, unless a subdomain really needs it.",
  "robots-private-paths": "Take private paths out of robots.txt and protect those pages with sign-in instead; robots.txt is a public file.",
  "missing-security-txt": "Publish /.well-known/security.txt with a Contact line (an email or form) and an Expires date, as RFC 9116 describes.",
  "security-txt-expired": "Update the Expires date in /.well-known/security.txt and check its contact details still work.",
  "missing-spf": "Publish an SPF TXT record listing the servers that send the domain's mail, ending in -all or ~all.",
  "missing-dmarc": "Publish a DMARC record at _dmarc.<domain>, starting with p=none to watch reports, then moving to quarantine or reject.",
  "dmarc-not-enforced": "Once the reports show the domain's real mail passes, change the DMARC policy to p=quarantine, then p=reject.",
  "secret-file": "Remove the file from the repo and its history, add it to .gitignore, and change every key or password it held.",
  "no-security-policy": "Add a SECURITY.md saying how to report a vulnerability privately (an email address or GitHub's private reporting).",
  "no-dependency-updates": "Turn on Dependabot (a .github/dependabot.yml) or Renovate so outdated packages get update pull requests.",
};

export function howToFixFor(finding: Pick<PreviewFinding, "id">): string {
  return HOW_TO_FIX[finding.id.split(":")[0]!] ?? "See what the finding says, then change the setting it names on the server, host or repo.";
}

/** Code findings are matched across scans by title: case, extra spaces and a trailing full stop don't count. */
function sameTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
}

export const AUTOMATIC_PART_PREFIX = "Automatic check: ";
const partTitle = (area: PreviewArea) => `${AUTOMATIC_PART_PREFIX}${PREVIEW_AREA_LABEL[area]}`;
const areaOfPart = (title: string) => (Object.keys(PREVIEW_AREA_LABEL) as PreviewArea[]).find((area) => partTitle(area) === title) ?? null;

export type CodeFindingsOutcome = { added: number; stillThere: number; fixed: number };

/**
 * Saves a check's quick scan as findings in its main list (see the top of this file). Safe to run again for the same
 * check (a replaced quick scan): a finding it already holds isn't added twice.
 */
export async function saveCodeFindings(
  db: PrismaClient,
  checkId: string,
  result: Extract<PreviewResult, { ok: true }>,
  now = new Date(),
): Promise<CodeFindingsOutcome> {
  return db.$transaction(async (tx) => {
    const outcome: CodeFindingsOutcome = { added: 0, stillThere: 0, fixed: 0 };
    const check = await tx.securityCheck.findUnique({
      where: { id: checkId },
      select: { organisationId: true, requestedById: true, targetId: true, previousCheckId: true, status: true },
    });
    if (!check || check.status === "cancelled") return outcome;
    if (result.fingerprint) {
      await tx.securityCheck.update({ where: { id: checkId }, data: { siteFingerprint: result.fingerprint as Prisma.InputJsonObject } });
    }

    const parts = new Map(
      (await tx.securityCheckItem.findMany({ where: { checkId, kind: "automatic" }, select: { id: true, title: true } })).map((part) => [part.title, part.id]),
    );
    const partFor = async (area: PreviewArea): Promise<string> => {
      const title = partTitle(area);
      const known = parts.get(title);
      if (known) return known;
      const created = await tx.securityCheckItem.create({
        data: { checkId, kind: "automatic", title, status: "done", reportedAt: now, instructions: "Checked by Ziki's own code, the same way every scan." },
        select: { id: true },
      });
      parts.set(title, created.id);
      return created.id;
    };

    const taken = new Set(
      (await tx.securityCheckResult.findMany({ where: { checkId, item: { kind: "automatic" } }, select: { title: true } })).map((row) => sameTitle(row.title)),
    );
    const current = new Map(result.findings.map((finding) => [sameTitle(finding.title), finding]));

    if (check.previousCheckId) {
      const earlier = await tx.securityCheckResult.findMany({
        where: {
          checkId: { not: checkId },
          check: { organisationId: check.organisationId, requestedById: check.requestedById, targetId: check.targetId, status: { not: "cancelled" } },
          item: { kind: "automatic" },
          OR: [{ recheckState: null }, { recheckState: "still_there" }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          item: { select: { title: true } },
          finding: { select: { bug: { select: { status: true, isDeleted: true } }, idea: { select: { status: true, isDeleted: true } } } },
        },
      });
      for (const row of earlier) {
        const key = sameTitle(row.title);
        taken.add(key);
        if (row.finding && fixBucketOf(row.finding) === "fixing") continue;
        const seen = current.get(key);
        const area = seen?.area ?? areaOfPart(row.item.title);
        // Gone only counts when the quick scan really looked at that area this time.
        if (!area || (!seen && !result.checked.includes(area))) continue;
        await tx.securityCheckResult.update({
          where: { id: row.id },
          data: {
            recheckState: seen ? "still_there" : "fixed",
            recheckNote: seen ? "Ziki's automatic check still sees it." : "Ziki's automatic check no longer sees it.",
            recheckedAt: now,
            recheckCheckId: checkId,
            recheckItemId: await partFor(area),
          },
        });
        if (seen) outcome.stillThere++;
        else outcome.fixed++;
      }
    }

    for (const finding of result.findings) {
      const key = sameTitle(finding.title);
      if (taken.has(key)) continue;
      taken.add(key);
      await tx.securityCheckResult.create({
        data: {
          checkId,
          itemId: await partFor(finding.area),
          severity: finding.severity,
          title: finding.title,
          description: finding.detail,
          howToFix: howToFixFor(finding),
          priceCoins: SEVERITY_PRICE[finding.severity],
        },
      });
      outcome.added++;
    }
    return outcome;
  });
}
