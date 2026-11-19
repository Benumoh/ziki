"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { selectOrganisationAction } from "@/app/(app)/organisations/actions";
import { avatarTone } from "@/lib/avatar";

/** An organisation's mark: its initial on a soft tile, the same colour every time for the same name. */
function OrganisationMark({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-bold ${avatarTone(name)} ${
        size === "sm" ? "h-6 w-6 rounded-[7px] text-[12px]" : "h-5 w-5 rounded-md text-[10.5px]"
      }`}
    >
      {initial}
    </span>
  );
}

export type OrganisationProject = {
  id: string;
  name: string;
  slug: string;
};

/** An organisation the viewer belongs to and can open from the header. */
export type OrganisationOption = {
  id: string;
  name: string;
  slug: string;
  projects?: OrganisationProject[];
};

export type ExternalProjectChoice = {
  id: string;
  name: string;
  slug: string;
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
};

function visibleName(option: OrganisationOption, shared: boolean): string {
  return shared ? `${option.name} (${option.slug})` : option.name;
}

/**
 * The active organisation in the header. The closed control is only as wide as
 * the current name. Choosing another one submits selectOrganisationAction, the same
 * switch the organisations page uses. The accessible name includes the organisation
 * name on screen (WCAG 2.5.3); there is no aria-label to replace it.
 */
export function OrganisationSwitcher({
  organisationOptions,
  activeOrganisationId,
  externalProjects = [],
  className = "",
  fullWidth = false,
  tone = "default",
}: {
  organisationOptions: OrganisationOption[];
  activeOrganisationId: string | null;
  externalProjects?: ExternalProjectChoice[];
  className?: string;
  fullWidth?: boolean;
  /** "chrome" paints the control for navy chrome. "bar" is the borderless switcher in the app top bar. */
  tone?: "default" | "chrome" | "bar";
}) {
  const chrome = tone === "chrome";
  const bar = tone === "bar";
  const listId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const params = useParams();
  const currentOrgSlug = params?.org ? String(params.org) : null;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onEarnRoute = pathname === "/earn" || (pathname === "/discover" && searchParams?.get("from") === "earn");

  const externalOrg = currentOrgSlug
    ? externalProjects.find((p) => p.organisationSlug === currentOrgSlug)
    : null;

  const counts = new Map<string, number>();
  for (const option of organisationOptions) {
    const key = option.name.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const shared = (name: string) => (counts.get(name.toLocaleLowerCase()) ?? 0) > 1;

  const selected: OrganisationOption | undefined =
    (currentOrgSlug ? organisationOptions.find((w) => w.slug === currentOrgSlug) : null) ??
    (externalOrg
      ? {
          id: externalOrg.organisationId,
          name: externalOrg.organisationName,
          slug: externalOrg.organisationSlug,
          projects: externalProjects
            .filter((p) => p.organisationSlug === externalOrg.organisationSlug)
            .map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        }
      : null) ??
    organisationOptions.find((option) => option.id === activeOrganisationId) ??
    organisationOptions[0] ??
    (externalProjects.length > 0
      ? {
          id: externalProjects[0].organisationId,
          name: externalProjects[0].organisationName,
          slug: externalProjects[0].organisationSlug,
          projects: externalProjects
            .filter((p) => p.organisationSlug === externalProjects[0].organisationSlug)
            .map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        }
      : undefined);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // No organisation yet. On the earner's way in (#earnings: the Earn page, and Discover opened from it) the
  // way back is the Earn page; everywhere else, as before, the organisations page.
  if (!selected) {
    return (
      <Link
        href={onEarnRoute ? "/earn" : "/organisations"}
        className={`inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
          chrome
            ? "border border-surface-border bg-[#132347] text-porcelain hover:bg-[#1a2d57]"
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        } ${fullWidth ? "w-full" : ""} ${className}`}
      >
        {onEarnRoute ? "Earn" : "Organisations"}
      </Link>
    );
  }

  const selectedLabel = visibleName(selected, shared(selected.name));

  function choose(id: string) {
    setOpen(false);
    if (id === selected?.id) return;
    const form = formRef.current;
    const input = form?.elements.namedItem("organisationId");
    if (!form || !(input instanceof HTMLInputElement)) return;
    input.value = id;
    form.requestSubmit();
  }

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "w-full" : "w-max max-w-44"} ${className}`}>
      <form ref={formRef} action={selectOrganisationAction}>
        <input type="hidden" name="organisationId" defaultValue={selected.id} />
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className={`inline-flex max-w-full items-center gap-2 border font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-tint focus-visible:ring-offset-2 focus-visible:ring-offset-deep-ocean ${
            bar
              ? "h-[30px] rounded-full border-transparent bg-transparent py-0 pl-1.5 pr-1.5 text-[13px] text-zk-text hover:bg-zk-chip max-sm:pl-0 max-sm:text-base max-sm:font-semibold"
              : chrome
                ? "h-9 rounded-full border-surface-border bg-white/[0.04] py-0 pl-3 pr-2 text-sm text-porcelain hover:bg-white/[0.08]"
                : "h-9 rounded-full border-slate-200 bg-card py-0 pl-3 pr-2 text-xs text-slate-800 hover:bg-slate-50"
          } ${fullWidth ? "w-full justify-between" : ""}`}
        >
          <span className="sr-only">Active organisation, </span>
          {bar ? <OrganisationMark name={selected.name} /> : null}
          {chrome ? (
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
          ) : null}
          {/* In the header on phones only the badge shows; the name is still read out. */}
          <span className={bar ? "truncate max-sm:sr-only" : "truncate"}>{selectedLabel}</span>
          {/* The arrow sits right at the end of the name. */}
          <svg className={`h-3.5 w-3.5 shrink-0 ${bar ? "-ml-1.5 max-sm:ml-0" : ""} ${chrome ? "text-sky-tint/70" : bar ? "text-zk-muted" : "text-slate-400"}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {open ? (
          <div
            className={`absolute left-0 top-full z-50 mt-1 rounded-lg border p-1 shadow-sm ${
              chrome ? "border-surface-border bg-[#142343]" : bar ? "w-60 rounded-2xl border-zk-border bg-zk-surface p-1.5 shadow-[0_16px_40px_rgba(11,23,51,0.16)]" : "border-slate-200 bg-card"
            } ${fullWidth ? "w-full" : bar ? "" : "w-max min-w-full max-w-56"}`}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label="Organisations"
              className="max-h-64 overflow-y-auto"
            >
              {organisationOptions.map((option) => {
                const label = visibleName(option, shared(option.name));
                const current = option.id === selected.id;
                return (
                  <li key={option.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={current}
                      onClick={() => choose(option.id)}
                      className={`flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left ${bar ? "text-sm" : "text-xs"} ${
                        current
                          ? chrome
                            ? "bg-electric-blue/20 font-medium text-white"
                            : bar
                              ? "bg-zk-tint font-medium text-zk-accent"
                              : "bg-teal-50 font-medium text-teal-900"
                          : chrome
                            ? "text-slate-200 hover:bg-white/5"
                            : bar
                              ? "text-zk-text hover:bg-zk-chip"
                              : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {bar ? <OrganisationMark name={option.name} size="xs" /> : null}
                      <span className="truncate">{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Outside the listbox: a link, not an option. */}
            <div className={`mt-1 border-t pt-1 ${chrome ? "border-surface-border" : bar ? "border-zk-divider" : "border-slate-200"}`}>
              <Link
                href="/discover"
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${bar ? "text-sm font-medium text-zk-text hover:bg-zk-chip" : chrome ? "text-xs text-slate-200 hover:bg-white/5" : "text-xs text-slate-700 hover:bg-slate-50"}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                </svg>
                Discover Projects
              </Link>

              <Link
                href="/organisations"
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${bar ? "text-sm font-medium text-zk-text hover:bg-zk-chip" : chrome ? "text-xs text-slate-200 hover:bg-white/5" : "text-xs text-slate-700 hover:bg-slate-50"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
                Manage organisations
              </Link>

              <Link
                href="/organisations#create-organisation"
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${bar ? "text-sm font-medium text-zk-accent hover:bg-zk-chip" : chrome ? "text-xs text-sky-tint hover:bg-white/5" : "text-xs text-teal-800 hover:bg-slate-50"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add organisation
              </Link>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
