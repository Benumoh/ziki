import { z } from "zod";

/**
 * Reward settings (#one-payment). What an issue pays is no setting: its funded price, shared by role
 * (lib/coins/issue-shares.ts). What is left to set is the people-facing part: the ranking goal and the earning
 * guidelines a project shows its contributors. Safe to import from client components.
 */

/** The ranking goal, in $, when none is saved (shown in Ziks: 5,000). */
export const DEFAULT_TARGET = 5;
/** The largest goal, in $, a super admin can save. */
export const TARGET_MAX = 1_000_000;

const guidelines = z.string().trim().max(2000).optional().nullable().default(null);

/** Site-wide: the ranking goal and the guidelines projects show when they set none. */
export const platformRewardConfigSchema = z.object({
  target: z.coerce.number().min(1).max(TARGET_MAX).default(DEFAULT_TARGET),
  guidelines,
});
export type PlatformRewardConfig = z.infer<typeof platformRewardConfigSchema>;

export function defaultPlatformRewards(): PlatformRewardConfig {
  return { target: DEFAULT_TARGET, guidelines: null };
}

/** A saved platform config, or the defaults when it is missing or unreadable. Old saved point amounts are ignored. */
export function parsePlatformRewardConfig(raw: unknown): PlatformRewardConfig {
  if (!raw || typeof raw !== "object") return defaultPlatformRewards();
  const result = platformRewardConfigSchema.safeParse(raw);
  return result.success ? result.data : defaultPlatformRewards();
}

export function parsePlatformRewardConfigFromFormData(formData: FormData): PlatformRewardConfig {
  const rawTarget = formData.get("target");
  const target = rawTarget === null || rawTarget === "" ? DEFAULT_TARGET : Number(rawTarget);
  return platformRewardConfigSchema.parse({
    target: Number.isFinite(target) ? target : DEFAULT_TARGET,
    guidelines: String(formData.get("rewardGuidelines") ?? "").trim() || null,
  });
}

/** A project's: the earning guidelines it shows contributors (extra ways to earn, what it values). */
export const projectRewardConfigSchema = z.object({ guidelines });
export type ProjectRewardConfig = z.infer<typeof projectRewardConfigSchema>;

/** A project's saved config, with missing fields from `base` (the platform's). */
export function parseProjectRewardConfig(raw: unknown, base?: ProjectRewardConfig | null): ProjectRewardConfig {
  const fallback = base ?? { guidelines: null };
  if (!raw || typeof raw !== "object") return fallback;
  const result = projectRewardConfigSchema.safeParse({ ...fallback, ...(raw as object) });
  return result.success ? result.data : fallback;
}

/** What a project inherits from the platform when it sets nothing. */
export function projectDefaultsFromPlatform(platform: PlatformRewardConfig): ProjectRewardConfig {
  return { guidelines: platform.guidelines };
}
