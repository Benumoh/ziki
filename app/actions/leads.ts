"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_MESSAGE, clientIpFrom, consumeAuthRateLimit } from "@/lib/rate-limit";
import { leadSchema } from "@/lib/validations/lead";

export type LeadFormState = { ok: true } | { ok: false; error: string; field?: "email" | "name" | "goal" } | undefined;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
};

/**
 * Saves a lead from a public page's form (#how-it-works-leads). One row per email: a later form from the same
 * address fills in what the earlier one left out. A filled-in `website` field is a bot (people never see it), so it
 * is thanked and dropped.
 */
export async function captureLeadAction(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  if (field(formData, "website")) return { ok: true };

  const parsed = leadSchema.safeParse({
    email: field(formData, "email") ?? "",
    name: field(formData, "name"),
    goal: field(formData, "goal"),
    source: field(formData, "source"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? "Check the form and try again.",
      field: path === "email" || path === "name" || path === "goal" ? path : undefined,
    };
  }
  const { email, name, goal, source } = parsed.data;

  // A plain getter: Next's headers object doesn't pass clientIpFrom's shape check (as in lib/user-sessions.ts).
  const requestHeaders = await headers();
  const ip = clientIpFrom({ get: (name: string) => requestHeaders.get(name) });
  const limited = await consumeAuthRateLimit("lead", { email, ip });
  if (!limited.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  try {
    await prisma.lead.upsert({
      where: { email },
      create: { email, name, goal, source },
      update: { source, ...(name ? { name } : {}), ...(goal ? { goal } : {}) },
    });
  } catch (error) {
    logger.error("[captureLeadAction] could not save a lead:", error);
    return { ok: false, error: "That didn’t go through. Try again in a moment." };
  }
  return { ok: true };
}
