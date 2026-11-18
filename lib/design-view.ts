import type { RedesignStatus } from "@prisma/client";
import { isOrganisationAdmin, type OrganisationRole } from "@/lib/organisation-role";

/**
 * The Design area's rules for people (#9): which proposals each filter lists,
 * how a status reads, and which decisions a viewer is offered. Pure, so the
 * pages and their tests share one answer. Proposals are `Redesign*` in code
 * and "Design" in the UI.
 */

export const DESIGN_VIEWS = [
  { value: "waiting", label: "Waiting" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
] as const;
export type DesignView = (typeof DESIGN_VIEWS)[number]["value"];

/** The statuses each filter lists; `null` is every status. */
export const DESIGN_VIEW_STATUSES: Record<DesignView, RedesignStatus[] | null> = {
  waiting: ["proposed"],
  decided: ["approved", "rejected", "superseded"],
  all: null,
};

/** The filter an address asks for: Waiting unless it names another, as on Escalations. */
export function designViewOf(raw: string | string[] | undefined): DesignView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return DESIGN_VIEWS.some((view) => view.value === value) ? (value as DesignView) : "waiting";
}

export type DesignStatusTone = "warn" | "ok" | "bad" | "muted";

/** A status as people read it, and its colour. An approved linked proposal was the design chosen for its issue. */
export function designStatus(status: RedesignStatus, linked: boolean): { label: string; tone: DesignStatusTone } {
  switch (status) {
    case "proposed":
      return { label: "Waiting for a decision", tone: "warn" };
    case "approved":
      return { label: linked ? "Chosen" : "Approved", tone: "ok" };
    case "rejected":
      return { label: "Rejected", tone: "bad" };
    case "superseded":
      return { label: "Superseded", tone: "muted" };
  }
}

export type DesignDecision = "approved" | "rejected" | "chosen";

/**
 * The decisions a person is offered on a proposal: the same rule
 * `decideRedesign` (lib/redesigns.ts) enforces. Only a waiting proposal, only an
 * organisation owner or admin by membership, and never the owner of the agent
 * that proposed it. A proposal for an issue is chosen or rejected; one for no
 * issue is approved or rejected.
 */
export function designDecisionsFor(
  proposal: { status: RedesignStatus; bugId: string | null; authorOwnerId: string },
  viewer: { userId: string; membershipRole: OrganisationRole | null | undefined },
): DesignDecision[] {
  if (proposal.status !== "proposed") return [];
  if (!isOrganisationAdmin(viewer.membershipRole)) return [];
  if (viewer.userId === proposal.authorOwnerId) return [];
  return proposal.bugId ? ["chosen", "rejected"] : ["approved", "rejected"];
}

/** Why a waiting proposal offers this viewer no decision, for the line shown instead of the buttons. */
export function designWaitingNote(
  proposal: { authorOwnerId: string },
  viewer: { userId: string; membershipRole: OrganisationRole | null | undefined },
): string {
  if (viewer.userId === proposal.authorOwnerId) return "Your agent proposed this design, so another organisation owner or admin decides it.";
  if (!isOrganisationAdmin(viewer.membershipRole)) return "An organisation owner or admin decides this design.";
  return "";
}
