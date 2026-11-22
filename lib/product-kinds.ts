/**
 * What a project is (#product-kinds), asked first by First questions and kept on
 * `Project.productKinds`. A product can be several at once (a mobile app with a
 * website); "idea" (not built yet) stands alone. Anything else, a game or a browser
 * extension, is "other", in the owner's own words in `Project.productOther`. Client-safe: the card and the server share it.
 */

export const BUILT_KINDS = ["website", "mobile", "desktop", "other"] as const;
export type BuiltKind = (typeof BUILT_KINDS)[number];
export type ProductKind = BuiltKind | "idea";
export const PRODUCT_KINDS: readonly ProductKind[] = [...BUILT_KINDS, "idea"];

export const PRODUCT_OTHER_MAX = 80;

export function isProductKind(value: unknown): value is ProductKind {
  return typeof value === "string" && (PRODUCT_KINDS as readonly string[]).includes(value);
}

/** The project's kinds as saved, dropping anything no longer a kind. */
export function readProductKinds(saved: readonly string[] | null | undefined): ProductKind[] {
  return (saved ?? []).filter(isProductKind);
}

/**
 * Its links: a website has a site, a mobile app store pages, and a desktop app or
 * something else a page where people get it. Every kind can link its code.
 */
export function asksFor(kinds: readonly ProductKind[]) {
  return {
    site: kinds.includes("website"),
    stores: kinds.includes("mobile"),
    download: kinds.includes("desktop") || kinds.includes("other"),
  };
}

/**
 * What the untouched first project ("Web") is renamed to once you say what it is,
 * or null to keep it: a website keeps "Web", any other built thing becomes "App". Nothing changes for an idea.
 */
export function defaultProjectNameFor(kinds: readonly ProductKind[]): string | null {
  if (kinds.length === 0 || kinds.includes("idea") || kinds.includes("website")) return null;
  return "App";
}
