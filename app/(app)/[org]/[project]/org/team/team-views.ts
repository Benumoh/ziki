/** The Team page's filters (#team-page), shared by the server page (`?show=`) and the list. */
export const TEAM_VIEWS = ["all", "active", "invited", "requests", "collaborators", "deactivated"] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

export function teamViewFrom(value: string): TeamView {
  return (TEAM_VIEWS as readonly string[]).includes(value) ? (value as TeamView) : "all";
}
