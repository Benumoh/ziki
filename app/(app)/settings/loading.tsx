import { Bar, CardSkeleton, SkeletonPage } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <SkeletonPage label="Loading settings…">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <div className="space-y-2">
          <Bar className="h-3 w-28" />
          <Bar className="h-8 w-40" />
          <Bar className="h-3 w-64" />
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-full rounded-panel border border-zk-border bg-zk-surface p-3 sm:max-w-[280px]">
            <div className="space-y-2">
              <Bar className="h-12 w-full rounded-xl" />
              <Bar className="h-12 w-full rounded-xl" />
              <Bar className="h-12 w-full rounded-xl" />
              <Bar className="h-12 w-full rounded-xl" />
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <CardSkeleton rows={4} />
            <CardSkeleton rows={3} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
