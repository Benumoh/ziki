export default function PublicIssuesLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-10" aria-busy="true" aria-label="Loading public issues">
      <div className="space-y-2">
        <div className="h-4 w-32 animate-pulse rounded bg-zk-chip" />
        <div className="h-8 w-48 animate-pulse rounded bg-zk-chip" />
      </div>
      <div className="h-16 animate-pulse rounded-2xl border border-zk-border bg-zk-surface" />
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-24 animate-pulse rounded-2xl border border-zk-border bg-zk-surface" />
        ))}
      </div>
    </div>
  );
}
