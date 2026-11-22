import { Bar, SkeletonPage } from "@/components/ui/skeleton";

export default function OrgMilestonesLoading() {
  return (
    <SkeletonPage label="Loading milestones…">
      <div className="space-y-2">
        <Bar className="h-3 w-28" />
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-3 rounded-panel border border-zk-border bg-zk-surface p-6">
        <Bar className="h-4 w-32" />
        <div className="flex gap-3">
          <Bar className="h-9 w-64 max-w-full" />
          <Bar className="h-9 w-28 rounded-lg" />
        </div>
      </div>
      <div className="divide-y divide-zk-divider rounded-panel border border-zk-border bg-zk-surface">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-6 py-4">
            <Bar className="h-4 w-40" />
            <Bar className="h-7 w-40 rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
