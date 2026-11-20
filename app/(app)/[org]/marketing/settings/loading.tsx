const card = "rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6";
const bone = "rounded bg-zk-border motion-safe:animate-pulse";

/** The marketing settings while the task types and revision limit load. */
export default function LoadingMarketingSettings() {
  return (
    <div className="flex flex-col gap-5 pb-10" aria-busy="true" aria-label="Marketing settings">
      <p role="status" className="sr-only">
        Loading marketing settings…
      </p>
      <div className={`${bone} h-3 w-56`} aria-hidden="true" />
      <div className={`${bone} h-8 w-64`} aria-hidden="true" />
      {[4, 3, 1].map((rows, section) => (
        <div key={section} className={`${card} space-y-3`} aria-hidden="true">
          <div className={`${bone} h-5 w-40`} />
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className={`${bone} h-10 w-full`} />
          ))}
        </div>
      ))}
    </div>
  );
}
