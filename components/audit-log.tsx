"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useId, useState } from "react";
import type { UndoAuditActionResult } from "@/app/actions/audit";
import { LocalTime } from "@/components/local-time";
import { useToast } from "@/components/ui/toast";

/** One agent audit event, already filtered for the viewer on the server (#447). */
export type AuditLogRow = {
  id: string;
  createdAt: Date | string;
  agentName: string;
  action: string;
  /** Human-readable target, e.g. "#42 Login button overlaps". */
  target: string | null;
  /** Link for the target issue, when there is one. */
  issueHref: string | null;
  agentId: string;
  bugId: string | null;
  payload: unknown;
  undoneAt: Date | string | null;
};

type UndoAction = (
  prev: UndoAuditActionResult | undefined,
  formData: FormData,
) => Promise<UndoAuditActionResult>;

/** Renders an audit payload as JSON, falling back to its string form if it can't be serialized. */
function formatPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "(no payload)";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/** One audit event: its summary, expandable payload, and the admin-only Undo action. */
function AuditLogEntry({
  row,
  isAdminOfOrganisation,
  onUndo,
}: {
  row: AuditLogRow;
  isAdminOfOrganisation?: boolean;
  onUndo?: UndoAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const detailsId = useId();
  const toast = useToast();

  /** Sends the undo and shows the server's message when it is refused. */
  const handleUndo = async () => {
    const formData = new FormData();
    formData.append("auditEventId", row.id);
    startTransition(async () => {
      const result = await onUndo?.(undefined, formData);
      if (result && !result.ok) toast(result.error, "error");
    });
  };

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <LocalTime date={row.createdAt} className="text-xs text-zk-muted" />
        <span className="font-bold text-zk-text">{row.agentName}</span>
        <span className="text-zk-text2">{row.action}</span>
        {row.target &&
          (row.issueHref ? (
            <Link href={row.issueHref} className="font-semibold text-zk-accent underline-offset-2 hover:underline">
              {row.target}
            </Link>
          ) : (
            <span className="text-zk-text2">{row.target}</span>
          ))}
        {row.undoneAt && (
          <span className="rounded-full bg-zk-chip px-2 py-0.5 text-xs font-bold text-zk-muted">Undone</span>
        )}
        {isAdminOfOrganisation && !row.undoneAt ? (
          <button
            type="button"
            disabled={pending}
            onClick={handleUndo}
            className="ml-auto text-xs font-bold text-zk-bad-fg hover:underline disabled:opacity-50"
          >
            {pending ? "Undoing…" : "Undo"}
          </button>
        ) : null}
        <button
          type="button"
          className="ml-auto min-h-10 text-xs font-bold text-zk-accent hover:underline"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      </div>
      {open && (
        <dl id={detailsId} className="mt-2 space-y-1 rounded-xl bg-zk-tint p-3 text-xs text-zk-text2">
          <div>
            <dt className="inline font-bold text-zk-text">Event id: </dt>
            <dd className="inline font-mono">{row.id}</dd>
          </div>
          <div>
            <dt className="inline font-bold text-zk-text">Agent id: </dt>
            <dd className="inline font-mono">{row.agentId}</dd>
          </div>
          {row.bugId && (
            <div>
              <dt className="inline font-bold text-zk-text">Issue id: </dt>
              <dd className="inline font-mono">{row.bugId}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-bold text-zk-text">Undone: </dt>
            <dd className="inline">
              {row.undoneAt ? <LocalTime date={row.undoneAt} /> : "No"}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-zk-text">Payload</dt>
            <dd>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                {formatPayload(row.payload)}
              </pre>
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

/** Compact audit rows, each collapsed until its "Show more" button is pressed. */
export function AuditLog({
  rows,
  isAdminOfOrganisation,
  onUndo,
}: {
  rows: ReadonlyArray<AuditLogRow>;
  isAdminOfOrganisation?: boolean;
  onUndo?: UndoAction;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-zk-muted">No agent activity yet.</p>;
  }
  return (
    <ul className="divide-y divide-zk-divider">
      {rows.map((row) => (
        <AuditLogEntry key={row.id} row={row} isAdminOfOrganisation={isAdminOfOrganisation} onUndo={onUndo} />
      ))}
    </ul>
  );
}
