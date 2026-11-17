import { SkeletonPage } from "@/components/ui/skeleton";

export default function LoadingCreateVideo() {
  return (
    <div className="mx-auto w-full max-w-5xl pb-10" aria-busy="true" aria-label="Create a video">
      <SkeletonPage label="Loading video studio…">
        <div className="h-8 w-64 max-w-full rounded bg-zk-border motion-safe:animate-pulse" />
      </SkeletonPage>
    </div>
  );
}
