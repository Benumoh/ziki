import { z } from "zod";
import { STRENGTHS } from "@/lib/join-questions";

/**
 * What a member saves from the join questions (#join-questions): what they're
 * good at, possibly nothing (skipped, or they brought an agent instead).
 * De-duplicated and kept in the listed order.
 */
export const joinAnswersSchema = z
  .object({
    organisationId: z.string().trim().min(1).max(64),
    strengths: z.array(z.enum(STRENGTHS)).max(STRENGTHS.length),
  })
  .transform((answers) => ({
    ...answers,
    strengths: STRENGTHS.filter((strength) => answers.strengths.includes(strength)),
  }));

export type JoinAnswers = z.infer<typeof joinAnswersSchema>;

/** Bring one of your agents into the organisation, or connect a new one by name. */
export const joinAgentConnectSchema = z.union([
  z.object({ organisationId: z.string().trim().min(1).max(64), agentId: z.string().trim().min(1).max(64) }),
  z.object({ organisationId: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(60) }),
]);
