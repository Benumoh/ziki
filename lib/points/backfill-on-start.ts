import { cleanEnv } from "@/lib/env-clean";
import type { BackfillResult } from "./backfill";

/**
 * Production containers award missing ledger rows when the server starts (#435, #539).
 * The same sourceKey the live award path uses makes a second start a no-op.
 * The work is not awaited: the health check must be able to pass while a large
 * first run is still writing.
 */
export function shouldBackfillOnStart(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NEXT_PHASE === "phase-production-build") return false;
  const flag = cleanEnv(env.BACKFILL_POINTS_ON_START);
  if (flag === "0" || flag === "false") return false;
  // On Vercel every cold start would rerun it; run it once by hand there instead (docs/deploy-vercel.md).
  if (env.VERCEL === "1" && flag !== "1" && flag !== "true") return false;
  if (env.NODE_ENV === "production") return true;
  return flag === "1" || flag === "true";
}

export function startPointsBackfill(run: () => Promise<BackfillResult> = backfillDeployedLedger): void {
  if (!shouldBackfillOnStart()) return;
  console.log("[points] Backfilling the ledger.");
  void run()
    .then((result) => {
      console.log(
        `[points] Backfill finished: ${result.bugs} tickets, ${result.written} written, ${result.existing} already awarded.`,
      );
    })
    .catch((error: unknown) => {
      console.error(
        "[points] Backfill failed. The server keeps running; the next start tries again.",
        error,
      );
    });
}

async function backfillDeployedLedger(): Promise<BackfillResult> {
  const { prisma } = await import("@/lib/prisma");
  const { backfillPoints } = await import("./backfill");
  return backfillPoints(prisma);
}
