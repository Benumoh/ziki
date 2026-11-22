import Link from "next/link";

interface WhimsicalEmptyStateProps {
  title?: string;
  description?: string;
  clearHref?: string;
  createHref?: string;
  showClear?: boolean;
  showCreate?: boolean;
}

export function WhimsicalEmptyState({
  title = "It's quiet in here... No issues match this filter.",
  description = "Maybe the bugs went into hiding, or they've all been squashed! Try clearing your filters or create a new issue.",
  clearHref,
  createHref,
  showClear = true,
  showCreate = true,
}: WhimsicalEmptyStateProps) {
  return (
    <div
      data-testid="whimsical-empty-state"
      className="flex flex-col items-center justify-center rounded-panel border border-zk-border bg-zk-surface px-6 py-14 text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)]"
    >
      {/* Friendly Robot with Magnifying Glass Illustration */}
      <div className="relative mb-5 flex h-28 w-28 items-center justify-center rounded-3xl bg-zk-tint/60 text-zk-accent" aria-hidden="true">
        <svg
          width="76"
          height="76"
          viewBox="0 0 76 76"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="transition-transform duration-300 hover:scale-105"
        >
          {/* Antenna */}
          <line x1="38" y1="12" x2="38" y2="20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="38" cy="9" r="4" fill="#2E6FEF" />

          {/* Robot Head */}
          <rect x="18" y="20" width="40" height="32" rx="12" fill="var(--zk-surface, #ffffff)" stroke="currentColor" strokeWidth="2.5" />
          
          {/* Ears */}
          <rect x="13" y="31" width="5" height="10" rx="2" fill="currentColor" />
          <rect x="58" y="31" width="5" height="10" rx="2" fill="currentColor" />

          {/* Happy Eyes */}
          <path d="M26 33C27.5 30.5 30.5 30.5 32 33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M44 33C45.5 30.5 48.5 30.5 50 33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />

          {/* Friendly Smile */}
          <path d="M33 41C35 44 41 44 43 41" stroke="#2E6FEF" strokeWidth="2.5" strokeLinecap="round" />

          {/* Robot Body hints */}
          <path d="M25 52V58C25 61 29 63 38 63C47 63 51 61 51 58V52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />

          {/* Magnifying Glass */}
          <g transform="translate(14, 12)">
            <circle cx="44" cy="24" r="9" fill="var(--zk-surface, #ffffff)" stroke="#2E6FEF" strokeWidth="2.5" />
            <circle cx="44" cy="24" r="6" fill="#2E6FEF" fillOpacity="0.12" />
            <line x1="50.5" y1="30.5" x2="59" y2="39" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            {/* Sparkle inside glass */}
            <path d="M44 20V22M44 26V28M41 24H43M45 24H47" stroke="#2E6FEF" strokeWidth="1.5" strokeLinecap="round" />
          </g>

          {/* Playful Floating Stars */}
          <circle cx="12" cy="18" r="1.5" fill="#2E6FEF" opacity="0.6" />
          <circle cx="66" cy="22" r="2" fill="#2E6FEF" opacity="0.5" />
          <circle cx="16" cy="56" r="1.5" fill="#2E6FEF" opacity="0.4" />
        </svg>
      </div>

      <h3 className="text-lg font-bold text-zk-text sm:text-xl">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm text-zk-muted">
        {description}
      </p>

      {/* Action buttons, only those given a link. */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {showClear && clearHref ? (
          <Link
            href={clearHref}
            className="inline-flex h-10 items-center justify-center rounded-control bg-electric-blue-strong px-5 text-sm font-bold text-white transition-all hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            Clear filters
          </Link>
        ) : null}
        {showCreate && createHref ? (
          <Link
            href={createHref}
            className="inline-flex h-10 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text transition-colors hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
          >
            Create a new issue
          </Link>
        ) : null}
      </div>
    </div>
  );
}
