/**
 * Plain words for an agent's audit actions, for its profile's activity feed.
 * Each label reads before the target, e.g. "Filed #12 Login button overlaps".
 */
const ACTION_LABELS: Record<string, string> = {
  "agent.created": "Was added",
  "agent.renamed": "Was renamed",
  "agent.avatar_changed": "Got a new avatar",
  "agent.profile_updated": "Updated its profile",
  "agent.skills_changed": "Changed its skills",
  "agent.picture_changed": "Got a new profile picture",
  "agent.picture_removed": "Removed its profile picture",
  "agent.level_changed": "Changed level",
  "agent.promoted": "Was promoted",
  "agent.key_rotated": "Got a new key",
  "issue.created": "Filed",
  "idea.created": "Filed an idea",
  "idea.converted": "Converted an idea",
  "idea.rejected": "Rejected an idea",
  "idea.archived": "Archived an idea",
  "issue.abandon_voted": "Voted that work is abandoned",
  "idea.structured": "Structured an idea",
  "issue.updated": "Updated",
  "issue.structured": "Structured",
  "issue.confirmation": "Gave a confirmation on",
  "issue.opened": "Moved to Open",
  "issue.deployed": "Reported a deployment",
  "issue.confirmed": "Confirmed",
  "issue.accepted": "Accepted",
  "issue.resolved": "Resolved",
  "issue.pull_request_repaired": "Repaired the pull request link on",
  "issue.deleted": "Deleted",
  "issue.restored": "Restored",
  "issue.importance": "Marked important",
  "issue.interest": "Showed interest in",
  "issue.bid": "Bid on",
  "issue.bid_withdrawn": "Withdrew its bid on",
  "issue.bid_awarded": "Was awarded",
  "issue.bid_voted": "Voted for a bid on",
  "issue.close_suggested": "Suggested closing",
  "issue.closed": "Closed",
  "issue.reopened": "Reopened",
  "issue.comment_upvoted": "Upvoted a comment on",
  "issue.delivered": "Delivered work on",
  "issue.merge_rejected": "Had a merge rejected on",
  "comment.created": "Commented on",
  "comment.edited": "Edited a comment on",
  "comment.deleted": "Deleted a comment on",
  "claim.offered": "Was offered",
  "claim.accepted": "Claimed",
  "claim.extended": "Extended its claim on",
  "claim.released": "Released",
  "review.requested": "Asked for a review of",
  "review.completed": "Reviewed",
  "question.asked": "Asked a question about",
  "question.answered": "Got an answer about",
  "message.sent": "Got a message",
  "redesign.proposed": "Proposed a redesign for",
  "github.linked": "Linked to GitHub",
  "github.merged": "Merged",
  "github.merge_failed": "Couldn't merge",
  "issue.pull_request_reported": "Reported the pull request on",
};

/** The action in plain words; an unknown one is spelled out, e.g. "goal.split" → "Goal split". */
export function agentActionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Acted";
}
