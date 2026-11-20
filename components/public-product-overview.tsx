import Link from "next/link";
import { RichText } from "@/components/rich-text";
import type { FeedbackPortalProject } from "@/lib/public-projects";
import { publicFeedbackPath, publicOrgFeedbackPath } from "@/lib/public-project-paths";

export function PublicProductOverview({ product }: { product: FeedbackPortalProject }) {
  const ref = { orgSlug: product.organisation.slug, projectSlug: product.slug };
  return <div className="mx-auto w-full max-w-[920px] space-y-6 pb-10">
    <Link href={publicOrgFeedbackPath(ref.orgSlug)} className="inline-flex min-h-8 items-center text-sm font-semibold text-zk-accent hover:underline">← All projects</Link>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zk-muted">{product.organisation.name} · Product overview</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">{product.name}</h1>
        <p className="text-sm leading-6 text-zk-text2">Help improve {product.name}. Report a problem or suggest something better.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={publicFeedbackPath(ref, "problem")} className="inline-flex min-h-10 items-center rounded-xl border border-zk-border bg-zk-surface px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">Report a problem</Link>
        <Link href={publicFeedbackPath(ref, "improvement")} className="inline-flex min-h-10 items-center rounded-xl bg-zk-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Suggest an improvement</Link>
      </div>
    </header>
    <section className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
      <h2 className="text-lg font-bold text-zk-text">About {product.name}</h2>
      {product.goal?.trim() ? <RichText content={product.goal} className="mt-3 text-sm leading-7 text-zk-text2" /> : <p className="mt-3 text-sm leading-7 text-zk-text2">{product.visibility === "private" ? "The team has not published a product description for this project." : "The team has not added a product description yet."}</p>}
    </section>
  </div>;
}
