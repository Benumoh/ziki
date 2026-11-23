"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { pickFirstThing } from "@/lib/join-first-thing";
import type { FirstThing } from "@/lib/join-questions";
import { joinAnswersSchema } from "@/lib/validations/join-questions";

export type JoinAnswersResult = { ok: true; firstThing: FirstThing | null } | { error: string };

/**
 * A joiner saves their join questions (#join-questions) on their own
 * membership of the organisation, and gets the first real thing to do back.
 * Closing the card early saves what was answered so far, so it isn't asked
 * again on another device. Only the person themselves, and only where they are a member.
 * It revalidates nothing, so the open card isn't redrawn; the Members page reads fresh anyway.
 */
export async function saveJoinAnswersAction(input: unknown): Promise<JoinAnswersResult> {
  const user = await requireUser();
  const parsed = joinAnswersSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick one of the answers shown." };
  const { organisationId, joinReason, strengths, weeklyTime } = parsed.data;

  const membership = await prisma.membership.findFirst({
    where: { organisationId, userId: user.id, organisation: { archivedAt: null } },
    select: { id: true },
  });
  if (!membership) return { error: "You're not a member of this organisation." };

  await prisma.membership.update({
    where: { id: membership.id },
    data: { joinReason, strengths, weeklyTime, joinAnsweredAt: new Date() },
  });

  try {
    return { ok: true, firstThing: await pickFirstThing(organisationId, user.id, joinReason, strengths) };
  } catch (error) {
    // The answers are saved either way; the card then only says where replies arrive.
    console.error("[join-questions] first thing failed", error);
    return { ok: true, firstThing: null };
  }
}
