import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";

/** Pure offer-window rule shared by accepting and inbox expiry reporting. */
export const OFFER_TTL_MS = DEFAULT_PROJECT_WORKFLOW.offerWindowSeconds * 1000;

export function isOfferExpired(
  offeredAt: Date | null,
  now = Date.now(),
  windowMs = OFFER_TTL_MS,
): boolean {
  return !offeredAt || now - offeredAt.getTime() >= windowMs;
}
