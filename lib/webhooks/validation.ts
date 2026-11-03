import { z } from "zod";

export const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
}).strict();

export type WebhookValidationFailure = {
  status: 400;
  body: {
    error: "invalid_request";
    message: string;
    field?: string;
  };
};

/** Maps the first webhook schema error to the field-level API error contract. */
export function webhookValidationFailure(error: z.ZodError): WebhookValidationFailure {
  const issue = error.issues[0];
  const field = issue?.code === "unrecognized_keys"
    ? issue.keys.join(", ")
    : issue?.path.map(String).join(".");

  return {
    status: 400,
    body: {
      error: "invalid_request",
      message: issue?.message ?? "Invalid webhook request.",
      ...(field ? { field } : {}),
    },
  };
}
