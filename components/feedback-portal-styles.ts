// Feedback entry points follow the existing app's controls and theme tokens.
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent focus-visible:ring-offset-2 focus-visible:ring-offset-zk-bg";
export const feedbackPrimaryAction = `inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-full bg-electric-blue-strong px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
export const feedbackSecondaryAction = `inline-flex min-h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-sm font-medium text-zk-text transition hover:bg-zk-chip disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
export const feedbackTextLink = `inline-flex min-h-8 items-center gap-1.5 rounded-sm text-sm font-medium text-zk-accent hover:underline ${focus}`;

export const feedbackBackLink = `inline-flex min-h-8 items-center gap-1.5 rounded-sm text-sm font-medium text-zk-text hover:text-zk-text2 hover:underline ${focus}`;
