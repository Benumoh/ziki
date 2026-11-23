import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Owns robots.txt rather than letting the platform generate it (#224). It blocks only the API, which is data, not
 * pages (#robots-minimal).
 *
 * Keep it that way. Private pages already need sign-in (a crawler only ever reaches /login), and pages that must stay
 * out of search say so with a `noindex` robots tag in their metadata. A robots.txt block would stop Google reading
 * that tag, can still leave the bare address in results, and is easy to get wrong: a `/$` rule (which means "exactly
 * /") hid the homepage for two weeks.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    // Points crawlers at the sitemap (#310), on the configured origin.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
