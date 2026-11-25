"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COMPARE_CATEGORIES, categoryLabel } from "@/lib/compare/catalog";
import { canonicalPair, comparisonHref } from "@/lib/compare/slug";
import { PlatformBadge } from "./platform-badge";

export type PlatformOption = {
  slug: string;
  name: string;
  category: string;
  logoUrl: string | null;
  isZiki: boolean;
};

type PickerProps = {
  label: string;
  options: PlatformOption[];
  value: PlatformOption | null;
  disabledSlug: string | null;
  onChange: (option: PlatformOption) => void;
};

/** A searchable list box: type to filter, arrow keys to move, Enter to choose. */
function PlatformPicker({ label, options, value, disabledSlug, onChange }: PickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((o) => !needle || o.name.toLowerCase().includes(needle) || categoryLabel(o.category).toLowerCase().includes(needle));
  }, [options, query]);

  const choose = (option: PlatformOption) => {
    if (option.slug === disabledSlug) return;
    onChange(option);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="cmp-picker">
      <label className="cmp-picker-label" htmlFor={`${id}-input`}>{label}</label>
      <div className="cmp-picker-box">
        {value && !open ? (
          <span className="cmp-picker-value"><PlatformBadge name={value.name} logoUrl={value.logoUrl} isZiki={value.isZiki} size={28} />{value.name}</span>
        ) : null}
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="cmp-picker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${shown[active].slug}` : undefined}
          autoComplete="off"
          placeholder={value ? "" : "Search platforms"}
          value={query}
          onFocus={() => { setOpen(true); setActive(0); }}
          onBlur={() => setOpen(false)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0))); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (event.key === "Enter" && open && shown[active]) { event.preventDefault(); choose(shown[active]); }
            else if (event.key === "Escape") { setOpen(false); }
          }}
        />
      </div>
      {open ? (
        <ul className="cmp-picker-list" role="listbox" id={`${id}-list`} aria-label={label}>
          {shown.length === 0 ? <li className="cmp-picker-empty" role="presentation">No platform matches “{query}”.</li> : null}
          {shown.map((option, index) => {
            const taken = option.slug === disabledSlug;
            return (
              <li
                key={option.slug}
                id={`${id}-opt-${option.slug}`}
                role="option"
                aria-selected={value?.slug === option.slug}
                aria-disabled={taken}
                className={`cmp-picker-option${index === active ? " active" : ""}${taken ? " disabled" : ""}`}
                onMouseDown={(event) => { event.preventDefault(); choose(option); }}
                onMouseEnter={() => setActive(index)}
              >
                <PlatformBadge name={option.name} logoUrl={option.logoUrl} isZiki={option.isZiki} size={28} />
                <span className="cmp-picker-name">{option.name}</span>
                <span className="cmp-picker-cat">{taken ? "Already selected" : categoryLabel(option.category)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Pick two platforms, optionally narrowed by category, and open their comparison. */
export function CompareBuilder({ options, initialSlug }: { options: PlatformOption[]; initialSlug?: string }) {
  const router = useRouter();
  const ziki = options.find((o) => o.isZiki) ?? null;
  const [category, setCategory] = useState<string>("all");
  const [first, setFirst] = useState<PlatformOption | null>(ziki);
  const [second, setSecond] = useState<PlatformOption | null>(options.find((o) => o.slug === initialSlug && !o.isZiki) ?? null);

  const filtered = (current: PlatformOption | null) =>
    options.filter((o) => category === "all" || o.category === category || o.slug === current?.slug || o.isZiki);

  const ready = first && second && first.slug !== second.slug;

  return (
    <form
      className="cmp-builder"
      onSubmit={(event) => {
        event.preventDefault();
        if (!first || !second || first.slug === second.slug) return;
        const pair = canonicalPair(first.slug, second.slug);
        router.push(comparisonHref(pair.a, pair.b));
      }}
    >
      <div className="cmp-filters" role="group" aria-label="Filter platforms by category">
        {[{ value: "all", label: "All" }, ...COMPARE_CATEGORIES].map((c) => (
          <button
            key={c.value}
            type="button"
            className={category === c.value ? "cmp-chip active" : "cmp-chip"}
            aria-pressed={category === c.value}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="cmp-builder-row">
        <PlatformPicker label="First platform" options={filtered(first)} value={first} disabledSlug={second?.slug ?? null} onChange={setFirst} />
        <span className="cmp-vs" aria-hidden="true">vs</span>
        <PlatformPicker label="Second platform" options={filtered(second)} value={second} disabledSlug={first?.slug ?? null} onChange={setSecond} />
        <button className="th-btn th-btn-primary th-btn-lg cmp-go" type="submit" disabled={!ready}>Compare platforms</button>
      </div>
    </form>
  );
}
