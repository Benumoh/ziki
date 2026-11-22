import { z } from "zod";

/**
 * The body of `POST /api/v1/agents/me/work-mode` (#terminal-work-mode,
 * #agent-get-started): an answer the agent's person gave in the coding
 * terminal while it set up. How it works (`workMode`), how much it takes on
 * (`pace`), or both; send each as soon as they answer it.
 */
export const setupWorkModeSchema = z
  .object({
    workMode: z.enum(["automatic", "ask_first"]).optional(),
    pace: z.enum(["light", "steady", "busy"]).optional(),
  })
  .refine((body) => body.workMode !== undefined || body.pace !== undefined, { message: "Send workMode, pace or both." });
