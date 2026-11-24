"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { parsePlatformRewardConfigFromFormData } from "@/lib/rewards/config";
import { savePlatformRewardConfig } from "@/lib/rewards/platform";

export type PlatformRewardsActionResult = {
  error?: string;
  message?: string;
};

export async function savePlatformRewardsAction(
  _prev: PlatformRewardsActionResult,
  formData: FormData,
): Promise<PlatformRewardsActionResult> {
  const actor = await requireSuperAdmin();
  try {
    const config = parsePlatformRewardConfigFromFormData(formData);
    await savePlatformRewardConfig(prisma, config, actor.id);
    revalidatePath("/superadmin/rewards");
    revalidatePath("/workers");
    revalidatePath("/[org]/[project]/org", "layout");
    revalidatePath("/", "layout");
    return { message: "Saved." };
  } catch (error) {
    console.error("[admin/rewards] save failed", error);
    return { error: "Could not save. Check the goal is a number from 1 and try again." };
  }
}
