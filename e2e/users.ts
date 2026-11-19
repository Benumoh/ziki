/**
 * Accounts the seed creates. Desktop and mobile runs get separate people,
 * because issue creation and sign-in are rate limited per user.
 */
export const E2E_PASSWORD = "e2e-password-123";

export type Role = "user" | "admin" | "super";
export type Width = "desktop" | "mobile";

export function emailFor(role: Role, width: Width): string {
  return `e2e-${role}-${width}@test.local`;
}

export function nameFor(role: Role, width: Width): string {
  const r = { user: "Uma User", admin: "Ada Admin", super: "Sam Super" }[role];
  return `${r} ${width === "desktop" ? "D" : "M"}`;
}

/** Signs in fresh in the session-expiry test, then is deleted mid-session. */
export const STALE_EMAIL = (width: Width) => `e2e-stale-${width}@test.local`;

/**
 * An organisation none of the test accounts belong to (#access-control), with one
 * public and one private project. Its issues are #1 (public) and #2 (private).
 */
export const OUTSIDE_ORG = "e2e-outside";
export const OUTSIDE_PUBLIC = "open-web";
export const OUTSIDE_PRIVATE = "vault";
export const OUTSIDE_PUBLIC_ISSUE = "Outside public issue";
export const OUTSIDE_PRIVATE_ISSUE = "Outside private issue";

export const ROLES: Role[] = ["user", "admin", "super"];
export const WIDTHS: Width[] = ["desktop", "mobile"];

export function authFile(role: Role, width: Width): string {
  return `e2e/.auth/${role}-${width}.json`;
}

export function widthOf(projectName: string): Width {
  return projectName === "mobile" ? "mobile" : "desktop";
}
