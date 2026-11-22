import { z } from "zod";

/** The forms on the public pages that collect leads (#how-it-works-leads). */
export const LEAD_SOURCES = ["how-it-works:hero", "how-it-works:middle", "how-it-works:end"] as const;

/** What a lead form sends: an email always, a name and what they want done when the form asks. */
export const leadSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Enter your email").max(254).email("Enter a valid email"),
  name: z.string().trim().max(100, "Keep your name under 100 characters").optional().transform((value) => value || undefined),
  goal: z.string().trim().max(1000, "Keep it under 1000 characters").optional().transform((value) => value || undefined),
  source: z.enum(LEAD_SOURCES),
});

export type LeadInput = z.infer<typeof leadSchema>;
