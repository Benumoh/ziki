/** The field and the foot shared by the Create and Join organisation windows, so the two match. */

export const WINDOW_FIELD =
  "h-11 min-w-0 rounded-control border border-zk-border bg-zk-surface px-3.5 text-[15px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue disabled:opacity-60 aria-[invalid=true]:border-zk-bad-bd";

const FOOT_BTN =
  "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-control px-5 text-[13px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue disabled:cursor-not-allowed disabled:opacity-50";

export function WindowFooter({
  onCancel,
  submitLabel,
  submitDisabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zk-divider bg-zk-bg/60 px-6 py-4">
      <button type="button" onClick={onCancel} className={`${FOOT_BTN} text-zk-text hover:bg-zk-chip`}>
        Cancel
      </button>
      <button type="submit" disabled={submitDisabled} className={`${FOOT_BTN} bg-electric-blue-strong text-white hover:bg-zk-ink`}>
        {submitLabel}
      </button>
    </div>
  );
}
