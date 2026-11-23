"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { ZIKS_LOAN, takeZiksLoan } from "@/lib/coins/loan";
import { prisma } from "@/lib/prisma";

/** "Borrow 2,000 Ziks" (16 Nov call): a one-time overdraft for Security payments, only on the person's own click. */
export async function borrowZiks(): Promise<{ error?: string }> {
  const user = await requireUser();
  const taken = await takeZiksLoan(prisma, user.id);
  if (!taken) return { error: `You can borrow ${ZIKS_LOAN.toLocaleString("en-US")} Ziks once, before your first purchase. Buy Ziks on your Ziks page.` };
  revalidatePath("/coins");
  return {};
}
