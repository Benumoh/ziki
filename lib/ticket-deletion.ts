import type { MembershipRole } from "@prisma/client";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";
import type { BugVoterSummary } from "@/lib/voters";
import { DELETED_PARENT_ATTACHMENT_TTL_DAYS } from "@/lib/attachment-retention";

export const TICKET_DELETION_ERRORS = {
  unauthorized: "Only an owner or admin of this organisation can delete issues",
  unauthorizedRestore:
    "Only an owner or admin of this organisation can restore issues",
  invalidId: "Invalid issue ID",
  notFound: "Issue not found",
  alreadyDeleted: "Issue is already deleted",
  notDeleted: "Issue is not deleted",
  failed: "Could not delete issue. Please try again.",
  failedRestore: "Could not restore issue. Please try again.",
} as const;

export type TicketDeletionError = keyof typeof TICKET_DELETION_ERRORS;

/** What a delete leaves in place. Deleting only hides an issue (#692). */
export type TicketDeletionCounts = { comments: number; votes: number };

/**
 * The counts every delete and restore message quotes. Votes are upvotes only:
 * downvotes were removed (#1059), and the dislike rows still in the database
 * no longer count anywhere, so the messages say what the vote button says.
 */
export function deletionCounts(visibleComments: number, voters: BugVoterSummary): TicketDeletionCounts {
  return { comments: visibleComments, votes: voters.likes.count };
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The one sentence that says what is kept when an issue is deleted. Without
 * counts it still says what is kept, just not how much.
 */
export function retainedSummary(counts?: TicketDeletionCounts): string {
  if (!counts) return "Its comments, importance marks and history are kept.";
  return `Its ${plural(counts.comments, "comment")}, ${plural(counts.votes, "importance mark")} and history are kept.`;
}

/**
 * What happens to a deleted issue's attachments (#596): they are kept, and
 * come back with a restore, for DELETED_PARENT_ATTACHMENT_TTL_DAYS; then the
 * retention sweep removes them for good.
 */
export const ATTACHMENTS_KEPT_SUMMARY = `Its attachments are kept for ${DELETED_PARENT_ATTACHMENT_TTL_DAYS} days, then removed for good.`;

/**
 * What deleting does, before it happens. The confirm dialog and the danger
 * zone both print this string, so they cannot drift apart.
 */
export function deleteSummary(counts?: TicketDeletionCounts): string {
  return `It will be hidden from regular users. ${retainedSummary(counts)} ${ATTACHMENTS_KEPT_SUMMARY} Owners and admins of this organisation can restore it from "View deleted issues".`;
}

/** The same facts, once the issue has been deleted (the banner on a deleted issue). */
export function deletedSummary(counts?: TicketDeletionCounts): string {
  return `It is hidden from regular users. ${retainedSummary(counts)} ${ATTACHMENTS_KEPT_SUMMARY} Owners and admins of this organisation can restore it.`;
}

/**
 * What restoring does. Mirrors {@link deleteSummary}: what was hidden comes
 * back as it was, and its attachments too while they are kept (#596).
 */
export function restoreSummary(counts?: TicketDeletionCounts): string {
  const kept = counts
    ? `its ${plural(counts.comments, "comment")}, ${plural(counts.votes, "importance mark")} and history`
    : "its comments, importance marks and history";
  return `It will be visible to everyone who can see this organisation's issues again, with ${kept} as they were. Its attachments come back too if it was deleted less than ${DELETED_PARENT_ATTACHMENT_TTL_DAYS} days ago.`;
}

/**
 * Soft-delete is an organisation power: owner, admin, or the site super admin.
 * A site-wide admin who is only a member cannot delete here.
 */
export function canDeleteTicket(
  role?: AppRole | null,
  membershipRole?: MembershipRole | null,
): boolean {
  return isOrganisationAdmin(membershipRole, role);
}

/** Same people who can delete can restore. */
export function canRestoreTicket(
  role?: AppRole | null,
  membershipRole?: MembershipRole | null,
): boolean {
  return isOrganisationAdmin(membershipRole, role);
}
