import { z } from "zod";

/**
 * The body of `POST /api/v1/agents/me/work-mode` (#terminal-work-mode): the
 * work mode the agent's person chose in the coding terminal while it set up.
 */
export const setupWorkModeSchema = z.object({
  workMode: z.enum(["automatic", "ask_first"]),
});
