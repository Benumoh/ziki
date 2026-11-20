import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { feedbackPrimaryAction, feedbackBackLink } from "@/components/feedback-portal-styles";
import Link from "next/link";
import { RichText } from "@/components/rich-text";
import type { FeedbackPortalProject } from "@/lib/public-projects";
import { publicFeedbackPath, publicOrgFeedbackPath } from "@/lib/public-project-paths";

export function PublicProductOverview({ product }: { product: FeedbackPortalProject }) {
  const ref = { orgSlug: product.organisation.slug, projectSlug: product.slug };
  return <div className="mx-auto -mt-1 w-full max-w-[920px] sm:-mt-4 space-y-3 pb-6">
    <Link href={publicOrgFeedbackPath(ref.orgSlug)} className={feedbackBackLink}>← All projects</Link>
    <FeedbackPageHeader title={product.name} identity={product.name} description={`Help improve ${product.name}. Report a problem or suggest something better.`} actions={
      <Link href={`${publicFeedbackPath(ref)}?view=share`} className={feedbackPrimaryAction}>Share feedback</Link>
    } />
    <section className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold text-zk-text">About {product.name}</h2>
      {product.goal?.trim() ? <RichText content={product.goal} className="mt-3 text-sm leading-7 text-zk-text2" /> : <p className="mt-3 text-sm leading-7 text-zk-text2">{product.visibility === "private" ? "The team has not published a product description for this project." : "The team has not added a product description yet."}</p>}
    </section>
  </div>;
}
