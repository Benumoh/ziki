import { TOOL_BUTTON } from "@/lib/ui-style";
// Navigation links mirror Button's primary styling; actual actions use Button.
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const feedbackPrimaryAction = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-control bg-electric-blue-strong px-4 text-sm font-semibold text-white shadow-none transition-colors hover:bg-zk-ink ${focus}`;
export const feedbackSecondaryAction = `${TOOL_BUTTON} ${focus}`;
export const feedbackTextLink = `inline-flex min-h-8 items-center gap-1.5 rounded-sm text-sm font-medium text-zk-accent hover:underline ${focus}`;
export const feedbackBackLink = `inline-flex min-h-8 items-center gap-1.5 rounded-sm text-sm font-medium text-zk-text hover:underline ${focus}`;
