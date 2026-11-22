import { Bar, SkeletonPage } from "@/components/ui/skeleton";

export default function AdminUsersLoading() {
  return (
    <SkeletonPage label="Loading users…">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-80 max-w-full" />
        </div>
        <Bar className="h-9 w-full sm:w-64" />
      </div>
      <div className="divide-y divide-zk-divider rounded-panel border border-zk-border bg-zk-surface">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-40" />
              <Bar className="h-3 w-56" />
            </div>
            <Bar className="h-5 w-16 rounded-md" />
            <Bar className="h-8 w-32 rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
