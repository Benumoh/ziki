export default function DiscoverLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6" aria-busy="true" aria-label="Loading projects">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-zk-chip" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-lg bg-zk-chip" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-12 animate-pulse rounded-2xl border border-zk-border bg-zk-surface" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-48 animate-pulse rounded-panel border border-zk-border bg-zk-surface" />
        ))}
      </div>
    </div>
  );
}
