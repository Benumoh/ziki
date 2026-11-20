/**
 * Default criticality / human-approval guidelines (#human-approval-gate).
 * Shared between server logic and client settings forms.
 */
export const DEFAULT_HUMAN_APPROVAL_GUIDELINES = [
  "Changes in the areas below require human approval before moving forward or merging. Normal bug fixes, typo/copy fixes, and tests that preserve existing behavior do NOT require human approval.",
  "",
  "Requires human approval:",
  "- UI, visual design, layout, navigation, or default tab/screen changes",
  "- Functional product direction or core user-flow changes",
  "- Authentication, login, permissions, billing, or security-model changes",
].join("\n");

export function effectiveHumanApprovalGuidelines(stored: string | null | undefined): string {
  const trimmed = stored?.trim();
  return trimmed ? trimmed : DEFAULT_HUMAN_APPROVAL_GUIDELINES;
}
