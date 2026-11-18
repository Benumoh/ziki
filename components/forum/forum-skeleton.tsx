import React from "react";
import { Bar, SkeletonPage } from "@/components/ui/skeleton";

export function ForumListSkeleton() {
  return (
    <SkeletonPage label="Loading discussions…">
      <div className="w-full flex flex-col gap-4">
        {/* Top bar with track pills & new post button placeholder */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-1 pb-1">
          <div className="flex items-center gap-1 bg-zk-chip/60 p-1 rounded-lg border border-zk-border w-64 h-8">
            <Bar className="h-6 w-16 rounded-md" />
            <Bar className="h-6 w-20 rounded-md" />
            <Bar className="h-6 w-20 rounded-md" />
          </div>
          <Bar className="h-8 w-24 rounded-lg self-end md:self-auto" />
        </div>

        {/* Sub-filter bar placeholder */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2 border-b border-zk-border">
          <div className="flex items-center gap-2">
            <Bar className="h-7 w-28 rounded-full" />
            <Bar className="h-7 w-20 rounded-full" />
            <Bar className="h-7 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Bar className="h-7 w-48 rounded-lg" />
            <Bar className="h-7 w-20 rounded-lg" />
            <Bar className="h-7 w-24 rounded-lg" />
          </div>
        </div>

        {/* Main Workbench Grid: Left Sidebar + Right Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
          {/* Sidebar Skeleton */}
          <div className="bg-zk-surface border border-zk-border rounded-xl p-3 flex flex-col gap-3">
            <Bar className="h-3 w-20 mb-1" />
            <Bar className="h-8 w-full rounded-lg" />
            <div className="pt-2 border-t border-zk-border flex flex-col gap-2">
              <Bar className="h-3 w-28 mb-1" />
              <Bar className="h-7 w-full rounded-lg" />
              <Bar className="h-7 w-full rounded-lg" />
            </div>
            <div className="pt-2 border-t border-zk-border flex flex-col gap-2">
              <Bar className="h-3 w-24 mb-1" />
              <Bar className="h-10 w-full rounded-lg" />
            </div>
          </div>

          {/* Cards Area Skeleton */}
          <div className="bg-zk-surface border border-zk-border rounded-xl p-4 md:p-5 flex flex-col gap-3 min-w-0">
            {/* Subheader bar */}
            <div className="flex items-center justify-between pb-2 border-b border-zk-border">
              <div className="flex items-center gap-2">
                <Bar className="h-5 w-44" />
                <Bar className="h-4 w-32" />
              </div>
              <Bar className="h-4 w-24" />
            </div>

            {/* Discussion card skeletons */}
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-zk-border bg-zk-bg/30 p-3.5 flex flex-col gap-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bar className="h-5 w-5 rounded-full" />
                      <Bar className="h-4 w-28" />
                      <Bar className="h-4 w-16" />
                    </div>
                    <Bar className="h-4 w-12 rounded-full" />
                  </div>
                  <Bar className={`h-5 ${i % 2 === 0 ? "w-4/5" : "w-2/3"}`} />
                  <div className="flex items-center gap-2 pt-1">
                    <Bar className="h-4 w-14 rounded-md" />
                    <Bar className="h-4 w-16 rounded-md" />
                    <Bar className="h-4 w-12 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

export function ForumDetailSkeleton() {
  return (
    <SkeletonPage label="Loading discussion thread…">
      <div className="w-full flex flex-col gap-4">
        {/* Top Back Action Bar */}
        <div className="flex items-center justify-between gap-3">
          <Bar className="h-8 w-36 rounded-lg" />
        </div>

        {/* Main Grid: Sidebar + Thread Details */}
        <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-6 items-stretch">
          {/* Left Detail Sidebar Skeleton */}
          <div className="bg-zk-surface border border-zk-border rounded-xl p-3.5 flex flex-col gap-3">
            <Bar className="h-4 w-24 mb-1" />
            <Bar className="h-10 w-full rounded-lg" />
            <div className="pt-2 border-t border-zk-border flex flex-col gap-2">
              <Bar className="h-3 w-28" />
              <Bar className="h-6 w-full rounded-md" />
              <Bar className="h-6 w-full rounded-md" />
            </div>
          </div>

          {/* Right Thread Detail Area Skeleton */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Header Card */}
            <div className="bg-zk-surface border border-zk-border rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bar className="h-6 w-6 rounded-full" />
                  <Bar className="h-4 w-32" />
                  <Bar className="h-4 w-16" />
                </div>
                <Bar className="h-5 w-16 rounded-full" />
              </div>
              <Bar className="h-7 w-3/4" />
              <div className="space-y-2 pt-2">
                <Bar className="h-4 w-full" />
                <Bar className="h-4 w-full" />
                <Bar className="h-4 w-4/5" />
              </div>
            </div>

            {/* Replies Skeleton */}
            <div className="space-y-3">
              <Bar className="h-5 w-32" />
              {Array.from({ length: 2 }, (_, i) => (
                <div
                  key={i}
                  className="bg-zk-surface border border-zk-border rounded-xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bar className="h-5 w-5 rounded-full" />
                      <Bar className="h-4 w-24" />
                    </div>
                    <Bar className="h-4 w-14" />
                  </div>
                  <Bar className="h-4 w-full" />
                  <Bar className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
