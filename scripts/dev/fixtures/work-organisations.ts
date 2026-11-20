/**
 * Two more organisations for the Demo owner (demo@fixtures.local), to see the
 * issue list's Your Work and Live stages, which show only when they hold
 * issues:
 *
 *   Demo Work  (slug demo-work)  every kind of the Demo owner's work, nothing live yet
 *   Demo Live  (slug demo-live)  the same, and some live
 *
 * Each has the Demo owner as owner, one project, one set-up agent of theirs
 * that holds the claims, and a few issues in other states around them. Like
 * the Demo organisation they touch only their own rows (ids `fx-ws-*`) and a
 * rerun recreates them.
 */
import type { PrismaClient, Status, Substatus } from "@prisma/client";

/**
 * What the issue is to the Demo owner, the kinds of Your Work:
 * a live bid, an offer to accept, assigned work (on time or overdue), or none
 * (someone's report, not theirs). Delivered, accepted and merging work stays
 * theirs through the claim.
 */
type You = "bid" | "offered" | "assigned" | "overdue" | null;
type IssueSpec = { title: string; summary: string; status: Status; substatus: Substatus; you: You };

type OrganisationSpec = { key: string; slug: string; name: string; issues: IssueSpec[] };

const MINUTE = 60_000;

const WORK_ISSUES: IssueSpec[] = [
  { title: "[Bug] Saving a draft loses the selected area", summary: "The area picker resets to none after a draft is saved and reopened.", status: "in_progress", substatus: "in_progress", you: "assigned" },
  { title: "[Feature] Keyboard shortcut to open the search", summary: "Pressing / should focus the issue search from anywhere in the list.", status: "in_progress", substatus: "in_progress", you: "overdue" },
  { title: "[Bug] Avatar upload accepts files over the limit", summary: "Pictures larger than 1 MB upload and then fail to display.", status: "done", substatus: "requires_review", you: "assigned" },
  { title: "[Bug] Comment drafts vanish on reload", summary: "A half-written comment is lost when the page reloads.", status: "done", substatus: "accepted", you: "assigned" },
  { title: "[Bug] Sort order resets on refresh", summary: "The list forgets the chosen sort after a refresh.", status: "merge", substatus: "ready_to_merge", you: "assigned" },
  { title: "[Bug] CSV export drops the last row", summary: "The exported file is one issue short.", status: "merge", substatus: "error", you: "assigned" },
  { title: "[Feature] Bulk-close from the list", summary: "Select several issues and close them in one go.", status: "open", substatus: "open", you: "offered" },
  { title: "[Improvement] Show the deadline on claimed issues", summary: "The issue row doesn't say when the claimed work is due.", status: "open", substatus: "open", you: "bid" },
  { title: "[Bug] Notification count stays after reading", summary: "The bell keeps its badge after every notification has been read.", status: "open", substatus: "requires_confirmation", you: "bid" },
  { title: "[Improvement] Faster search on big lists", summary: "Searching a list of thousands of issues takes seconds.", status: "open", substatus: "open", you: null },
  { title: "[Bug] Tooltip clipped at the screen edge", summary: "Tooltips near the right edge are cut off.", status: "open", substatus: "requires_confirmation", you: null },
];

const LIVE_ISSUES: IssueSpec[] = [
  ...WORK_ISSUES,
  { title: "[Bug] Dark mode flashes white on load", summary: "The page renders light for a moment before switching to dark.", status: "resolved", substatus: "on_dev", you: "assigned" },
  { title: "[Feature] Export issues as CSV", summary: "Admins can download the issue list as a CSV file.", status: "resolved", substatus: "on_staging", you: "assigned" },
  { title: "[Bug] Long titles overflow the issue row", summary: "Titles over 120 characters push the status chips off screen.", status: "resolved", substatus: "on_prod", you: "assigned" },
];

const ORGANISATIONS: OrganisationSpec[] = [
  { key: "work", slug: "demo-work", name: "Demo Work", issues: WORK_ISSUES },
  { key: "live", slug: "demo-live", name: "Demo Live", issues: LIVE_ISSUES },
];

export async function loadWorkOrganisations(db: PrismaClient, ownerId: string, now: number): Promise<void> {
  for (const ws of ORGANISATIONS) {
    const organisationId = `fx-ws-${ws.key}-organisation`;
    const projectId = `fx-ws-${ws.key}-project`;
    const agentId = `fx-ws-${ws.key}-agent`;
    const existing = await db.organisation.findUnique({ where: { slug: ws.slug }, select: { id: true } });
    if (existing && existing.id !== organisationId) throw new Error(`A "${ws.slug}" organisation exists that the fixtures didn't make; not touching it.`);
    if (existing) {
      // Issues and ideas restrict deleting the organisation (one may have been filed here locally); everything else
      // cascades.
      await db.bug.deleteMany({ where: { organisationId } });
      await db.idea.deleteMany({ where: { organisationId } });
      await db.organisation.delete({ where: { id: organisationId } });
    }
    // #user-agents: the agent is the owner's and outlives the organisation; replace it too.
    await db.agent.deleteMany({ where: { id: agentId } });

    await db.organisation.create({
      data: {
        id: organisationId,
        slug: ws.slug,
        name: ws.name,
        description: "Local fixtures: the Demo owner's assigned work (scripts/dev/fixtures/work-organisations.ts).",
        nextIssueNumber: 1,
        nextIdeaNumber: 1,
        memberships: { create: { userId: ownerId, role: "owner" } },
        projects: { create: { id: projectId, slug: ws.slug, name: ws.name, workflow: { create: {} } } },
      },
    });
    // The owner's agent, set up so it may work, holds the claims.
    await db.agent.create({
      data: {
        id: agentId,
        ownerUserId: ownerId,
        name: `${ws.name} Builder`,
        username: `${ws.slug}-builder`,
        activations: { create: { organisationId, level: "working" } },
        tagline: "Steady builder who finishes what it claims",
        about: "I pick up one issue at a time, reproduce it, fix it with a test, and deliver a small pull request.",
        createdAt: new Date(now - 30 * 24 * 60 * MINUTE),
      },
    });
    const tag = await db.skillTag.create({ data: { id: `fx-ws-${ws.key}-tag`, organisationId, name: "TypeScript", slug: "typescript" } });
    await db.agentSkill.create({ data: { agentId, tagId: tag.id, summary: "Strict types and small, tested fixes.", description: "I keep the types honest and add a test for every fix.", position: 0 } });

    // In number order: a trigger numbers issues from the organisation's counter.
    for (const [index, issue] of ws.issues.entries()) {
      const n = index + 1;
      const bugId = `fx-ws-${ws.key}-bug-${n}`;
      const ago = (ws.issues.length - index) * 6 * 60;
      const assigned = issue.you === "assigned" || issue.you === "overdue";
      await db.bug.create({
        data: {
          id: bugId,
          organisationId,
          projectId,
          title: issue.title,
          summary: issue.summary,
          description: `## Summary

${issue.summary}
`,
          status: issue.status,
          substatus: issue.substatus,
          reporterId: ownerId,
          beneficiaryUserId: ownerId,
          assigneeId: assigned ? ownerId : null,
          createdAt: new Date(now - ago * MINUTE),
        },
      });
      if (!issue.you) continue;
      const bid = { bugId, agentId, beneficiaryUserId: ownerId, summary: "I'll fix it with a test.", description: "Reproduce it, fix it, and add a test that failed before the fix." };
      if (issue.you === "bid") {
        await db.issueBid.create({ data: { id: `fx-ws-${ws.key}-bid-${n}`, ...bid, createdAt: new Date(now - 30 * MINUTE) } });
        continue;
      }
      const claimId = `fx-ws-${ws.key}-claim-${n}`;
      const claimedAt = new Date(now - (ago - 60) * MINUTE);
      if (issue.you === "offered") {
        // An award is an offer until the agent accepts it.
        await db.issueClaim.create({ data: { id: claimId, bugId, beneficiaryUserId: ownerId, agentId, status: "offered", offeredAt: new Date(now - 10 * MINUTE) } });
      } else {
        const live = issue.status === "resolved";
        await db.issueClaim.create({
          data: {
            id: claimId,
            bugId,
            beneficiaryUserId: ownerId,
            agentId,
            status: live ? "released" : "active",
            offeredAt: claimedAt,
            claimedAt,
            lastHeartbeatAt: new Date(now - 5 * MINUTE),
            deliverBy: new Date(now + (issue.you === "overdue" ? -3 * 60 : 22 * 60) * MINUTE),
            // Live work is finished: its claim was let go when it resolved.
            ...(live ? { releasedAt: new Date(now - 60 * MINUTE), releaseReason: "resolved" } : {}),
          },
        });
      }
      // The bid that won it.
      await db.issueBid.create({ data: { id: `fx-ws-${ws.key}-bid-${n}`, ...bid, claimId, awardedAt: claimedAt, createdAt: new Date(claimedAt.getTime() - 30 * MINUTE) } });
    }
  }
}
