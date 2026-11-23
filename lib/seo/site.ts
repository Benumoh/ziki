import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";
import { AGENTS_DIRECTORY_HREF } from "@/lib/header-nav";

/**
 * The site's name and the metadata every public page shares (#seo-pages).
 * Each page's title goes through the root layout's template, so a page gives
 * only its own title ("How it works"); the site name is added once.
 */
export const SITE_NAME = "Ziki - AI Agent Marketplace";
/** The brand on its own, for structured data and short labels. */
export const BRAND_NAME = "Ziki";
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;
export const SITE_DESCRIPTION =
  "Ziki is the AI agent marketplace where people and AI agents build software together: agents bid on issues, deliver with evidence and get paid for work that ships, while people stay in control.";

/** Where else "Ziki" is ziki.dev: the public repository. Add the brand's social profiles here as they exist. */
export const SITE_SAME_AS = ["https://github.com/emerjent/ziki"];

/** A page's own openGraph replaces the site's whole block, so every page sets these again. */
export const SITE_OG = { siteName: SITE_NAME, locale: "en_US" } as const;
export const DEFAULT_OG_IMAGES = [{ ...SHARE_IMAGE }];

export const NOINDEX = { index: false, follow: true } as const;

/**
 * How much of a title and description search results show (#seo-ctr). Both are
 * kept one character under the usual limits, so nothing is cut off mid-sentence
 * on a phone; every generated title and description goes through `clip`.
 */
export const TITLE_MAX = 59;
export const DESCRIPTION_MAX = 154;

/** Shorten to at most `max` characters, on a word boundary, with an ellipsis. */
export function clip(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** A page's full title as search results and link previews show it, never past `TITLE_MAX`. */
export function fullTitle(title: string, max = TITLE_MAX): string {
  if (title === SITE_NAME) return clip(title, max);
  const suffix = ` | ${SITE_NAME}`;
  if (suffix.length >= max) return clip(title, max);
  return `${clip(title, max - suffix.length)}${suffix}`;
}

/**
 * The first title that fits in `max` characters; if none does, the last one,
 * clipped. Templates list their wording from richest to plainest, so a long
 * project or skill name drops the extra words before it loses any letters.
 */
export function fittedTitle(candidates: string[], max = TITLE_MAX): string {
  const fitting = candidates.find((candidate) => candidate.length <= max);
  return clip(fitting ?? candidates[candidates.length - 1], max);
}

/**
 * One public page's metadata: its title, description, canonical address and
 * link previews. `noindex` keeps it out of search results (its links are still followed).
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  image,
  noindex = false,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article" | "profile";
  /** An absolute image URL for the preview; the site's share image otherwise. */
  image?: string | null;
  noindex?: boolean;
  /** The title as given, without the site name after it (the homepage). */
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteUrl(path);
  const shown = absoluteTitle ? clip(title, TITLE_MAX) : fullTitle(title);
  const summary = clip(description);
  const images = image ? [{ url: image }] : DEFAULT_OG_IMAGES;
  return {
    // The full shown title, so the root layout's template never pushes it past TITLE_MAX.
    title: { absolute: shown },
    description: summary,
    alternates: { canonical: url },
    robots: noindex ? NOINDEX : { index: true, follow: true },
    openGraph: { ...SITE_OG, type, title: shown, description: summary, url, images },
    twitter: { card: "summary_large_image", title: shown, description: summary, images: images.map((i) => i.url) },
  };
}

/**
 * FAQPage structured data for a question list the page already shows (#seo-ctr):
 * the rich result Google reads from the homepage's FAQ section.
 */
export function faqPageJsonLd(items: ReadonlyArray<{ q: string; a: string }>, path = "/"): object {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    url,
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** The site's structured data, on the homepage: who runs it, and its agent search. */
export function siteJsonLd(): object[] {
  const url = absoluteUrl("/");
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${url}#organization`,
      name: BRAND_NAME,
      alternateName: SITE_NAME,
      url,
      logo: absoluteUrl("/icon1.png"),
      description: SITE_DESCRIPTION,
      // #855: other places that are "Ziki", so search ties the name to this site.
      sameAs: SITE_SAME_AS,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${url}#website`,
      name: SITE_NAME,
      alternateName: BRAND_NAME,
      url,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${url}#organization` },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(AGENTS_DIRECTORY_HREF)}?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

/**
 * Google Search Console and Bing Webmaster Tools verification tags (#855), from GOOGLE_SITE_VERIFICATION and
 * BING_SITE_VERIFICATION. Unset, no tag is emitted (verifying by DNS record needs neither).
 */
export function siteVerification(env: NodeJS.ProcessEnv = process.env): Metadata["verification"] {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.BING_SITE_VERIFICATION?.trim();
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
