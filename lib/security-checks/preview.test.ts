import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { setRateLimitStore } from "@/lib/rate-limit";
import { PREVIEW_SCANS_PER_VISITOR_PER_HOUR } from "@/lib/security-checks";
import {
  certificateFindings,
  clearPreviewCache,
  cookieFindings,
  emailFindings,
  headerFindings,
  previewScan,
  realPreviewNetwork,
  type CertificateAnswer,
  type PageAnswer,
  type PreviewNetwork,
} from "./preview";
import { PrivateAddressError } from "./ownership";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const SAFE_HEADERS: PageAnswer["headers"] = {
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  server: "cloudflare",
};
const GOOD_CERT: CertificateAnswer = { authorized: true, authorizationError: null, validTo: new Date(NOW + 60 * DAY), protocol: "TLSv1.3" };

/** A network that answers from tables; anything not listed doesn't answer. */
function network(answers: {
  pages?: Record<string, Partial<PageAnswer>>;
  certificate?: CertificateAnswer | null;
  txt?: Record<string, string[][]>;
}): PreviewNetwork & { page: ReturnType<typeof vi.fn> } {
  return {
    page: vi.fn(async (url: string) => {
      const page = answers.pages?.[url];
      if (!page) throw Object.assign(new Error(`not reachable: ${url}`), { code: "ECONNREFUSED" });
      return { status: page.status ?? 200, location: page.location ?? null, headers: page.headers ?? {} };
    }),
    certificate: async () => answers.certificate ?? null,
    txt: async (host) => answers.txt?.[host] ?? [],
  };
}

/** A well-kept site: HTTPS, a redirect from HTTP, good headers, SPF and an enforced DMARC. */
const WELL_KEPT = {
  pages: {
    "https://settle.ng/": { headers: SAFE_HEADERS },
    "http://settle.ng/": { status: 301, location: "https://settle.ng/" },
  },
  certificate: GOOD_CERT,
  txt: { "settle.ng": [["v=spf1 include:_spf.google.com -all"]], "_dmarc.settle.ng": [["v=DMARC1; p=reject"]] },
};

let visitor = 0;
const scan = (link: string, net: PreviewNetwork, now = NOW) => previewScan(link, { visitor: `v${++visitor}`, network: net, now });

beforeEach(() => {
  clearPreviewCache();
  setRateLimitStore(null);
});
afterEach(() => setRateLimitStore(null));

describe("preview scan (#security-checks, 12 Nov plan D3)", () => {
  it("finds nothing on a well-kept site and says what it looked at", async () => {
    const result = await scan("https://settle.ng", network(WELL_KEPT));
    expect(result).toMatchObject({ ok: true, kind: "website", target: "settle.ng", findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } });
    expect(result.ok && result.checked).toEqual(["https", "certificate", "headers", "cookies", "email"]);
  });

  it("reports what a browser can see is missing, worst first, with counts", async () => {
    const result = await scan("settle.ng", network({
      pages: { "https://settle.ng/": { headers: { "set-cookie": ["sid=1; Path=/"], "x-powered-by": "Express" } }, "http://settle.ng/": { status: 200 } },
      certificate: { ...GOOD_CERT, validTo: new Date(NOW + 5 * DAY) },
      txt: { "_dmarc.settle.ng": [["v=DMARC1; p=none"]] },
    }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.findings.map((f) => f.id)).toEqual([
      "no-https-redirect", "certificate-expiring", "missing-hsts", "missing-csp", "missing-frame-protection", "cookie-not-secure", "missing-spf",
      "missing-nosniff", "missing-referrer-policy", "version-disclosure", "cookie-not-httponly", "cookie-no-samesite", "dmarc-not-enforced",
    ]);
    expect(result.counts).toEqual({ critical: 0, high: 0, medium: 7, low: 6 });
  });

  it("flags a site that only answers over plain HTTP", async () => {
    const result = await scan("settle.ng", network({ pages: { "http://settle.ng/": { status: 200 } } }));
    expect(result.ok && result.findings.map((f) => f.id)).toContain("no-https");
    expect(result.ok && result.checked).not.toContain("headers");
  });

  it("never calls a DNS record missing when the lookup itself failed", async () => {
    let calls = 0;
    const flaky: PreviewNetwork = {
      ...network(WELL_KEPT),
      txt: async () => {
        calls += 1;
        throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      },
    };
    const result = await scan("settle.ng", flaky);
    if (!result.ok) throw new Error(result.reason);
    expect(result.findings.map((f) => f.id)).not.toContain("missing-spf");
    expect(result.findings.map((f) => f.id)).not.toContain("missing-dmarc");
    expect(result.checked).not.toContain("email");
    expect(calls).toBe(4); // SPF and DMARC, each asked twice
  });

  it("says so plainly when nothing answers on the web", async () => {
    const result = await scan("settle.ng", network({}));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("didn't answer on the web") });
  });

  it("refuses repos and private or unreadable links before touching the network", async () => {
    const net = network(WELL_KEPT);
    expect(await scan("github.com/settle/app", net)).toEqual({ ok: false, reason: expect.stringContaining("Sign up to check a repo") });
    expect(await scan("http://192.168.1.10", net)).toMatchObject({ ok: false });
    expect(await scan("localhost", net)).toMatchObject({ ok: false });
    expect(await scan("not a link", net)).toMatchObject({ ok: false });
    expect(net.page).not.toHaveBeenCalled();
  });

  it("stops at once when a name turns out to point at a private address", async () => {
    const net: PreviewNetwork = {
      page: async () => { throw new PrivateAddressError("settle.ng"); },
      certificate: async () => null,
      txt: async () => [],
    };
    expect(await scan("settle.ng", net)).toEqual({ ok: false, reason: expect.stringContaining("private network") });
  });

  it("follows redirects on the same site only, and reads headers from the site's own page", async () => {
    const elsewhere = network({
      ...WELL_KEPT,
      pages: { ...WELL_KEPT.pages, "https://settle.ng/": { status: 302, location: "https://other.example.com/" } },
    });
    const result = await scan("settle.ng", elsewhere);
    // Redirected away: the other site's headers are never fetched or judged.
    expect(elsewhere.page).not.toHaveBeenCalledWith("https://other.example.com/");
    expect(result.ok && result.checked).not.toContain("headers");

    const www = network({ ...WELL_KEPT, pages: { ...WELL_KEPT.pages, "https://settle.ng/": { status: 301, location: "https://www.settle.ng/" }, "https://www.settle.ng/": { headers: SAFE_HEADERS } } });
    expect(await scan("settle.ng", www)).toMatchObject({ ok: true, findings: [] });
  });

  it("limits each visitor to a few previews an hour, and reuses a recent result without counting it", async () => {
    const net = network(WELL_KEPT);
    const sites = Array.from({ length: PREVIEW_SCANS_PER_VISITOR_PER_HOUR + 1 }, (_, i) => `site${i}.ng`);
    const results = [];
    for (const site of sites) {
      results.push(await previewScan(site, { visitor: "same-ip", network: network({ ...WELL_KEPT, pages: { [`https://${site}/`]: { headers: SAFE_HEADERS } } }), now: NOW }));
    }
    expect(results.slice(0, -1).every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toMatchObject({ ok: false, retryAfterSeconds: expect.any(Number) });

    // A link scanned a moment ago comes from the cache, even for a visitor at the limit.
    const cached = await previewScan("site0.ng", { visitor: "same-ip", network: net, now: NOW + 60_000 });
    expect(cached).toMatchObject({ ok: true, target: "site0.ng" });
    expect(net.page).not.toHaveBeenCalled();
  });

  it("doesn't hold an IP-reached server to a name on its certificate", () => {
    const mismatch = { ...GOOD_CERT, authorized: false, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID" };
    expect(certificateFindings(mismatch, "server", "8.8.4.4", NOW)).toEqual([]);
    expect(certificateFindings(mismatch, "website", "settle.ng", NOW).map((f) => f.id)).toEqual(["certificate-untrusted"]);
    expect(certificateFindings({ ...GOOD_CERT, validTo: new Date(NOW - DAY), authorized: false }, "website", "settle.ng", NOW).map((f) => f.id)).toEqual(["certificate-expired"]);
    expect(certificateFindings({ ...GOOD_CERT, protocol: "TLSv1.1" }, "website", "settle.ng", NOW).map((f) => f.id)).toEqual(["old-tls"]);
  });

  it("reads headers, cookies and email records the way a browser and a mail server would", () => {
    expect(headerFindings(SAFE_HEADERS)).toEqual([]);
    expect(headerFindings({ ...SAFE_HEADERS, "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" })).toEqual([]);
    expect(headerFindings({ ...SAFE_HEADERS, server: "nginx/1.18.0" }).map((f) => f.id)).toEqual(["version-disclosure"]);

    expect(cookieFindings({ "set-cookie": ["sid=1; Secure; HttpOnly; SameSite=Lax"] })).toEqual([]);
    expect(cookieFindings({ "set-cookie": ["a=1; HttpOnly; SameSite=Lax", "b=2; Secure; SameSite=Lax"] }).map((f) => [f.id, f.detail.slice(0, 8)])).toEqual([
      ["cookie-not-secure", "1 cookie"],
      ["cookie-not-httponly", "1 cookie"],
    ]);

    // TXT records can be split into pieces; they're joined before reading.
    expect(emailFindings([["v=spf1 ", "-all"]], [["v=DMARC1; ", "p=quarantine"]], "settle.ng")).toEqual([]);
    expect(emailFindings([["google-site-verification=x"]], [], "settle.ng").map((f) => f.id)).toEqual(["missing-spf", "missing-dmarc"]);
  });

  it("never opens a connection to a private address, by name or by number", async () => {
    let hits = 0;
    const local = createServer((_req, res) => {
      hits += 1;
      res.end("secret");
    });
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
    const { port } = local.address() as AddressInfo;
    try {
      await expect(realPreviewNetwork.page(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(PrivateAddressError);
      await expect(realPreviewNetwork.page(`http://localhost:${port}/`)).rejects.toMatchObject({ code: "EPRIVATE" });
      await expect(realPreviewNetwork.certificate("127.0.0.1")).rejects.toBeInstanceOf(PrivateAddressError);
      expect(hits).toBe(0);
    } finally {
      local.close();
    }
  });
});
