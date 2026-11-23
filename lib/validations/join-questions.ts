import { z } from "zod";
import { JOIN_REASONS, STRENGTHS, WEEKLY_TIMES } from "@/lib/join-questions";

/**
 * What a joiner saves from the join questions (#join-questions). Every answer
 * may be left out (skipped); strengths are de-duplicated and kept in the
 * listed order, and "Just looking" carries none.
 */
export const joinAnswersSchema = z
  .object({
    organisationId: z.string().trim().min(1).max(64),
    joinReason: z.enum(JOIN_REASONS).nullable(),
    strengths: z.array(z.enum(STRENGTHS)).max(STRENGTHS.length),
    weeklyTime: z.enum(WEEKLY_TIMES).nullable(),
  })
  .transform((answers) => ({
    ...answers,
    strengths: answers.joinReason === "looking" ? [] : STRENGTHS.filter((strength) => answers.strengths.includes(strength)),
  }));

export type JoinAnswers = z.infer<typeof joinAnswersSchema>;
