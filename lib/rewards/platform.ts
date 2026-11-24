import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { defaultPlatformRewards, parsePlatformRewardConfig, type PlatformRewardConfig } from "./config";

type Db = PrismaClient | Prisma.TransactionClient;
const PLATFORM_SETTINGS_ID = "default";

/** The site-wide reward settings. A missing or unreadable row gives the defaults, so nothing stalls on a config miss. */
export async function getPlatformRewardConfig(db: Db): Promise<PlatformRewardConfig> {
  try {
    const row = await db.platformSettings.findUnique({ where: { id: PLATFORM_SETTINGS_ID }, select: { rewardConfig: true } });
    return parsePlatformRewardConfig(row?.rewardConfig);
  } catch {
    return defaultPlatformRewards();
  }
}

export async function savePlatformRewardConfig(db: Db, config: PlatformRewardConfig, updatedById: string | null): Promise<PlatformRewardConfig> {
  const parsed = parsePlatformRewardConfig(config);
  const rewardConfig = parsed as Prisma.InputJsonValue;
  await db.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    create: { id: PLATFORM_SETTINGS_ID, rewardConfig, updatedById },
    update: { rewardConfig, updatedById },
  });
  return parsed;
}
