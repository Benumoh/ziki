import type { PublicProjectRef } from "@/lib/public-project-paths";

const KEY = "ziki:public-submissions";
export type SavedPublicSubmission = PublicProjectRef & { token: string };
export function savedPublicSubmissions(): SavedPublicSubmission[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedPublicSubmission => Boolean(item && typeof item.orgSlug === "string" && typeof item.projectSlug === "string" && typeof item.token === "string")).slice(-50);
  } catch { return []; }
}
export function rememberPublicSubmission(report: SavedPublicSubmission) {
  try {
    const items = savedPublicSubmissions().filter(item => item.token !== report.token);
    localStorage.setItem(KEY, JSON.stringify([...items, report].slice(-50)));
  } catch { /* Tracking links still work if browser storage is unavailable. */ }
}
export function forgetPublicSubmissions(tokens: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(savedPublicSubmissions().filter(item => !tokens.includes(item.token)))); } catch {}
}
