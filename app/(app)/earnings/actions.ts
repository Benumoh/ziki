"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { MAX_WEEKLY_GOAL, parseWeeklyGoal } from "@/lib/earnings";
import { formatZik, ziksFor } from "@/lib/coins/math";

export type GoalResult = { error?: string; saved?: boolean };

/** Sets the person's own weekly goal on Your earnings (#earnings). Only their own. */
export async function setWeeklyGoalAction(_prev: GoalResult, formData: FormData): Promise<GoalResult> {
  const user = await requireUser();
  const goal = parseWeeklyGoal(formData.get("goal"));
  if (goal === null) return { error: `Enter an amount in Ziks, up to ${formatZik(ziksFor(MAX_WEEKLY_GOAL))}.` };
  await prisma.user.update({ where: { id: user.id }, data: { weeklyEarningsGoal: goal } });
  revalidatePath("/earnings");
  return { saved: true };
}
