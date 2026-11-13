import { cleanEnv } from "@/lib/env-clean";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { runPlatformSweeps } from "@/lib/cron/runner";
import { logger } from "@/lib/logger";

const DEFAULT_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 10_000;

let cronIntervalTimer: NodeJS.Timeout | null = null;
let initialTimeoutTimer: NodeJS.Timeout | null = null;
let isRunning = false;

export function shouldRunInProcessCron(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (!isAgentPlatformEnabled()) return false;
  const flag = cleanEnv(env.ENABLE_IN_PROCESS_CRON);
  if (flag === "0" || flag === "false") return false;
  // On Vercel each function instance is short-lived; Vercel Cron (vercel.json) runs this instead.
  if (env.VERCEL === "1" && flag !== "1" && flag !== "true") return false;
  if (env.NODE_ENV === "production") return true;
  return flag === "1" || flag === "true";
}

async function executeSweepCycle() {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await runPlatformSweeps();
    if ("skipped" in result) {
      logger.info(`[cron-scheduler] Sweeps skipped: ${result.reason}`);
    } else {
      const { offers, claims } = result.sweeps;
      logger.info(
        `[cron-scheduler] Sweeps completed at ${result.timestamp} (offers expired=${offers.expired ?? 0}, claims released=${claims.released ?? 0})`,
      );
    }
  } catch (err) {
    logger.error("[cron-scheduler] Error during background sweep cycle:", err);
  } finally {
    isRunning = false;
  }
}

export function startPlatformCron(options?: {
  intervalMs?: number;
  initialDelayMs?: number;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = options?.env ?? process.env;
  if (!shouldRunInProcessCron(env)) return;
  if (cronIntervalTimer || initialTimeoutTimer) return;

  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const initialDelayMs = options?.initialDelayMs ?? INITIAL_DELAY_MS;

  logger.info(
    `[cron-scheduler] Starting in-process platform cron runner (every ${intervalMs / 1000}s, initial in ${initialDelayMs / 1000}s)...`,
  );

  initialTimeoutTimer = setTimeout(() => {
    initialTimeoutTimer = null;
    void executeSweepCycle();
  }, initialDelayMs);

  cronIntervalTimer = setInterval(() => {
    void executeSweepCycle();
  }, intervalMs);

  if (typeof initialTimeoutTimer.unref === "function") {
    initialTimeoutTimer.unref();
  }
  if (typeof cronIntervalTimer.unref === "function") {
    cronIntervalTimer.unref();
  }
}

export function stopPlatformCron(): void {
  if (initialTimeoutTimer) {
    clearTimeout(initialTimeoutTimer);
    initialTimeoutTimer = null;
  }
  if (cronIntervalTimer) {
    clearInterval(cronIntervalTimer);
    cronIntervalTimer = null;
  }
  isRunning = false;
}
