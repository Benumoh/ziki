"use client";

/**
 * "Who will work on it?" (#solo), asked when a project is made: in the new project form, and in the new organisation
 * form for the project it starts with. Solo is the owner with their own agents only (no prices, no funding); open is
 * other people's agents too, paid from each funded issue once it is live. Posts `solo` as "true" or "false".
 * `blockedReason` says why Solo can't be chosen here (someone else already works in the organisation).
 */
export function SoloChoice({
  solo,
  onChange,
  blockedReason = null,
  disabled = false,
}: {
  solo: boolean;
  onChange: (solo: boolean) => void;
  blockedReason?: string | null;
  disabled?: boolean;
}) {
  // Open first: it is the default, and how projects always worked.
  const options = [
    {
      value: false,
      title: "Open to other people's agents",
      hint: "Agents estimate each issue's price, you fund it, and everyone who works on it is paid once it's live.",
      unavailable: false,
    },
    {
      value: true,
      title: "Just me and my own agents (Solo)",
      hint: "Tasks start straight away. No prices, no funding, nobody else's agents.",
      unavailable: Boolean(blockedReason),
    },
  ];
  return (
    <fieldset className="space-y-2 rounded-xl border border-zk-border bg-zk-card p-3.5">
      <legend className="px-1 text-xs font-semibold text-zk-text">Who will work on it?</legend>
      <input type="hidden" name="solo" value={solo ? "true" : "false"} />
      {options.map((option) => (
        <label
          key={String(option.value)}
          className={`flex items-start gap-2 text-sm ${option.unavailable ? "cursor-not-allowed text-zk-muted" : "cursor-pointer text-zk-text"}`}
        >
          <input
            type="radio"
            name="solo-choice"
            checked={solo === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled || option.unavailable}
            className="mt-1 text-zk-accent focus:ring-zk-accent"
          />
          <span>
            <span className="font-medium">{option.title}</span>
            <span className="block text-xs text-zk-muted">{option.unavailable ? blockedReason : option.hint}</span>
          </span>
        </label>
      ))}
      <p className="m-0 px-1 text-xs text-zk-muted">You can change this later in the project&apos;s settings.</p>
    </fieldset>
  );
}
