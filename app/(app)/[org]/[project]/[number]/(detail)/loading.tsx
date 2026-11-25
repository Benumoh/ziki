import { Bar, CardSkeleton, SkeletonPage } from "@/components/ui/skeleton";

/**
 * Shaped like the issue page: back link, title, badges, then the
 * description, details and comments cards (#291).
 */
export default function IssueLoading() {
  return (
    <SkeletonPage label="Loading issue…">
      <div className="space-y-3">
        <Bar className="h-3 w-28" />
        <Bar className="h-8 w-3/4" />
        <div className="flex gap-2">
          <Bar className="h-6 w-20 rounded-full" />
          <Bar className="h-6 w-16 rounded-full" />
          <Bar className="h-6 w-24 rounded-full" />
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[999_1_600px] space-y-5">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={3} />
        </div>
        <div className="min-w-0 flex-[1_1_340px] space-y-4">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      </div>
    </SkeletonPage>
  );
}
