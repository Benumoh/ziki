import { prisma } from "@/lib/prisma";
import { canFundIssue } from "@/lib/coins/fund";
import { SETTLE_FIELDS, budgetBalance, lockPrice, priceStage } from "@/lib/coins/budget";
import { isPayer } from "@/lib/coins/payers";
import { suggestedBudget } from "@/lib/coins/budget-view";
import { escrowBalance, lockBug, walletBalance } from "@/lib/coins/ledger";
import { feePercent } from "@/lib/coins/math";
import { IssueFundingCard } from "./issue-funding-card";

/**
 * The Ziks behind an issue (#price-lock), on the issue page inside the Reward panel. Everyone sees where its price
 * stands; the person who pays for it (its reporter, or a payer: an owner, or an admin an owner lets pay, #payers) is asked to fund it once it is priced. A
 * settled price the project's budget covers is locked as the page opens, so nobody waits for the next sweep. Draws
 * nothing for a finished issue that holds nothing.
 */
export async function FundIssueSection({ bugId, userId }: { bugId: string; userId: string }) {
  const select = {
    organisationId: true, reporterId: true, status: true, isDeleted: true, payoutReleasedAt: true, projectId: true,
    ...SETTLE_FIELDS,
    project: { select: { slug: true, organisation: { select: { slug: true } } } },
  } as const;
  let bug = await prisma.bug.findUnique({ where: { id: bugId }, select });
  if (!bug || bug.isDeleted) return null;
  const finished = bug.status === "closed" || bug.status === "resolved" || Boolean(bug.payoutReleasedAt);

  const now = new Date();
  const before = priceStage(bug, now);
  // Settled, or locked but short (its price was raised): the budget covers it now if it can.
  const short = before.stage === "locked" && before.price > (await escrowBalance(prisma, bugId));
  if (!finished && (before.stage === "settled" || short)) {
    const locked = await prisma
      .$transaction(async (tx) => {
        await lockBug(tx, bugId);
        return lockPrice(tx, bugId, now);
      })
      .catch(() => null);
    if (locked?.locked) bug = (await prisma.bug.findUnique({ where: { id: bugId }, select })) ?? bug;
  }

  const stage = priceStage(bug, now);
  const held = Math.max(0, await escrowBalance(prisma, bugId));
  if (finished && held === 0) return null;

  const [mayFund, mayFundProject] = finished ? [false, false] : await Promise.all([canFundIssue(userId, bug), isPayer(prisma, userId, bug.organisationId)]);
  const price = stage.stage === "estimating" ? null : stage.price;
  const asking = mayFund && price !== null && (stage.stage === "settled" || stage.stage === "locked") && price > held;

  const [balance, available, suggested] = asking
    ? await Promise.all([walletBalance(prisma, userId), budgetBalance(prisma, bug.projectId), mayFundProject ? suggestedBudget(bug.projectId, price - held) : Promise.resolve(0)])
    : [0, 0, 0];

  return (
    <IssueFundingCard
      bugId={bugId}
      projectId={bug.projectId}
      stage={stage.stage}
      price={price}
      estimates={stage.stage === "estimating" ? { have: stage.have, need: stage.need } : { have: bug.rewardEstimateCount, need: bug.rewardEstimateCount }}
      settlesInMs={stage.stage === "settling" ? stage.settlesAt.getTime() - now.getTime() : null}
      held={held}
      canFund={mayFund}
      canFundProject={mayFundProject}
      balance={balance}
      available={Math.max(0, available)}
      suggested={suggested}
      feePercent={feePercent()}
      budgetHref={`/${bug.project.organisation.slug}/${bug.project.slug}/budget`}
    />
  );
}
