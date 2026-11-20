import { LocalTime } from "@/components/local-time";

/** An edit within this long of filing is part of filing it, not an update. */
const SAME_MOMENT_MS = 60_000;

/** Whether the issue changed after it was opened, so "Updated" says something "Opened" doesn't (#456). */
export function wasUpdatedAfterOpening(openedAt: Date, updatedAt: Date): boolean {
  return updatedAt.getTime() - openedAt.getTime() > SAME_MOMENT_MS;
}

/**
 * When the issue was opened and last changed, in the Status box (#456): two
 * labelled lines, each humanized with the full stamp in its tooltip.
 */
export function IssueDates({ openedAt, updatedAt }: { openedAt: Date; updatedAt: Date }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-zk-muted">Opened</dt>
      <dd className="m-0 text-zk-text2">
        <LocalTime date={openedAt} />
      </dd>
      {wasUpdatedAfterOpening(openedAt, updatedAt) ? (
        <>
          <dt className="text-zk-muted">Updated</dt>
          <dd className="m-0 text-zk-text2">
            <LocalTime date={updatedAt} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}
