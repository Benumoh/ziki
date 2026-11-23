/** Shared pieces of the /org tabs: a heading with helper text, and a page's messages. */

export const orgCard = "rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6";
export const orgListCard = "overflow-hidden rounded-panel border border-zk-border bg-zk-surface";
export const orgListHeading =
  "border-b border-zk-border bg-zk-tint px-4 py-3 text-base font-semibold text-zk-text sm:px-6";

export function OrgPageHeader({
  title,
  children,
  actions,
  heading: Heading = "h2",
}: {
  title: string;
  /** One or two sentences on what this tab is for. */
  children: React.ReactNode;
  actions?: React.ReactNode;
  heading?: "h1" | "h2";
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Heading className="text-xl font-bold tracking-tight text-zk-text">{title}</Heading>
        <p className="max-w-2xl text-sm text-zk-text2">{children}</p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/** Shown to members who can read a tab but not change it. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-zk-border bg-zk-tint px-3 py-2 text-sm text-zk-text2">
      {children}
    </p>
  );
}

/** The `?error=` and `?notice=` a server action redirected back with. */
export function OrgMessages({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-zk-border bg-zk-ok-bg px-3 py-2 text-sm text-zk-ok-fg">
          {notice}
        </p>
      ) : null}
    </>
  );
}

/** One value of a `searchParams` entry, or "". */
export function oneParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A read-only list of names, for members who can see a tab's labels but not change them. */
export function ReadOnlyNameList({
  label,
  items,
  empty,
}: {
  label: string;
  items: { id: string; name: string; inactive?: boolean; hint?: string | null }[];
  empty: string;
}) {
  return (
    <ul aria-label={label} className={`${orgListCard} divide-y divide-zk-border`}>
      {items.length === 0 ? (
        <li className="px-4 py-6 text-sm text-zk-muted sm:px-6">{empty}</li>
      ) : (
        items.map((item) => (
          <li key={item.id} className="px-4 py-3 sm:px-6">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
              {item.name}
              {item.inactive ? <span className="text-xs font-normal text-zk-muted">Inactive</span> : null}
            </p>
            {item.hint ? <p className="mt-0.5 text-xs text-zk-muted">{item.hint}</p> : null}
          </li>
        ))
      )}
    </ul>
  );
}
