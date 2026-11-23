export default function SecurityLoading() {
  return (
    <div className="security-page mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10" aria-busy="true">
      <p className="sr-only" role="status">Loading security findings</p>
      <header className="space-y-2" aria-hidden="true">
        <div className="h-8 w-40 animate-pulse rounded bg-zk-border" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-zk-border" />
      </header>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <div className="h-9 w-24 animate-pulse rounded-full bg-zk-border" key={index} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-24 animate-pulse rounded-panel border border-zk-border bg-zk-surface" key={index} />
        ))}
      </div>
      <section className="rounded-panel border border-zk-border bg-zk-surface p-5" aria-hidden="true">
        <div className="h-6 w-40 animate-pulse rounded bg-zk-border" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="h-10 animate-pulse rounded bg-zk-border" key={index} />
          ))}
        </div>
      </section>
    </div>
  );
}
