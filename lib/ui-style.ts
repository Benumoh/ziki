/**
 * The app's shared look (#app-look), taken from the analytics design the app now follows: one place for the section
 * title style, the spacing and the toolbar controls, so every page reads alike.
 *
 * - Section titles are 16px, regular weight, near-black, with an optional 14px gray line under them.
 * - Panels are white with a thin line and 12px corners; inside, 20px padding and 16px between blocks.
 * - Toolbar controls (Filter, New …, period pickers) are quiet: white, a thin line, 9px corners, 14px gray text.
 */

/** A section's title: 16px, regular, slightly tight. */
export const SECTION_TITLE = "m-0 text-[16px] font-normal leading-6 tracking-[-0.1px] text-zk-text";

/** The gray line under a section title. */
export const SECTION_SUB = "m-0 text-[14px] leading-5 text-zk-muted";

/** A white panel: a thin line, 12px corners, 20px padding. */
export const PANEL = "rounded-xl border border-zk-border bg-zk-surface p-5";

/** The space between blocks inside a panel, and between panels. */
export const GAP = "gap-4";

/** A toolbar control: a quiet white button with a thin line, an optional icon, and gray text. */
export const TOOL_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer list-none items-center gap-1.5 rounded-[9px] border border-zk-border bg-zk-surface px-3 text-[14px] font-normal text-zk-text2 transition hover:bg-zk-chip [&::-webkit-details-marker]:hidden [&>svg]:text-[#6c6c6c]";

/** A toolbar control while it is on (a filter is picked): the same, in the accent. */
export const TOOL_BUTTON_ON = "border-zk-accent/40 bg-zk-tint text-zk-accent [&>svg]:text-zk-accent";
