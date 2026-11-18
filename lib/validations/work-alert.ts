import { z } from "zod";

/**
 * The person's answer to a work alert (#work-alerts), reported by their agent
 * after asking them in the coding terminal: yes (start now), later (ask again
 * in 15 minutes) or no (leave this work to other agents while the rise lasts).
 *
 * With yes, `items` lists the keys of the share items the person picked
 * (`issue:4401`, `idea:12`); the rest go back to the pool. Without it, yes
 * means the whole share. Only yes takes items.
 */
export const workAlertAnswerSchema = z
  .object({
    answer: z.enum(["yes", "no", "later"]),
    items: z
      .array(z.string().regex(/^(issue|idea):[1-9][0-9]{0,8}$/, "Each item is a key from the alert's share, such as issue:4401."))
      .min(1)
      .max(50)
      .optional(),
  })
  .strict()
  .refine((input) => input.answer === "yes" || input.items === undefined, { message: "Only a yes picks items.", path: ["items"] });

export type WorkAlertAnswerInput = z.infer<typeof workAlertAnswerSchema>;
