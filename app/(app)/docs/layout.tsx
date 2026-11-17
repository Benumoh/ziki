import { DocsSidebar } from "@/components/docs-sidebar";

/** Every docs page: the sidebar beside the page, stacked above it on small screens. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 py-2 sm:gap-6 min-[1100px]:grid-cols-[240px_minmax(0,1fr)]">
      <DocsSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
