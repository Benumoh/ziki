import { prisma } from "@/lib/prisma";
import { fundIssue } from "@/lib/coins/fund";
import { dollarsToZiks } from "@/lib/coins/math";
import { localDatabaseUrl } from "../env";

/**
 * Prices and funds an issue (#price-lock), so a scenario can award it: every issue is funded before it is awarded.
 * The price is the issue's own reward, as if three agents had estimated it a few minutes ago (so it has settled), and
 * the sandbox organisation's owner funds it from Ziks given to them for it, exactly as the issue page's "Just this
 * issue" does. Funding locks the price. Local databases only, like the rest of the scenarios; the sandbox's rebuild
 * removes these rows with its issues (cli/setup.ts).
 */
export async function priceAndFund(issueId: string): Promise<number> {
  localDatabaseUrl();
  const bug = await prisma.bug.update({
    where: { id: issueId },
    data: { rewardEstimateCount: 3, rewardEstimatedAt: new Date(Date.now() - 2 * 60_000) },
    select: { organisationId: true, reward: true },
  });
  const price = dollarsToZiks(Number(bug.reward));
  const owner = await prisma.membership.findFirstOrThrow({ where: { organisationId: bug.organisationId, role: "owner" }, select: { userId: true } });
  await prisma.coinEntry.create({ data: { account: "wallet", userId: owner.userId, kind: "purchase", amount: price, sourceKey: `cli-grant:${issueId}` } });
  await fundIssue(owner.userId, issueId, price, `cli-fund-${issueId}`);
  return price;
}
