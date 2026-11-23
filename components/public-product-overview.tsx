import { SECTION_TITLE } from "@/lib/ui-style";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { FeedbackPortalSidebar } from "@/components/feedback-portal-sidebar";
import { FeedbackIdeasToolbar } from "@/components/feedback-ideas-toolbar";
import { PublicFeedbackIdeas } from "@/components/public-feedback-ideas";
import { RichText } from "@/components/rich-text";
import type { FeedbackPortalProject } from "@/lib/public-projects";
import type { FeedbackIdea } from "@/lib/public-feedback-ideas";
import { publicFeedbackPath } from "@/lib/public-project-paths";
export function PublicProductOverview({ product, ideas = [], query = "", status = "" }: { product: FeedbackPortalProject; ideas?: FeedbackIdea[]; query?: string; status?: string }) {
  const ref = { orgSlug: product.organisation.slug, projectSlug: product.slug };
  const base = publicFeedbackPath(ref);
  return <div className="space-y-4 pb-6"><FeedbackPageHeader title={product.name} identity={product.name} description={`${product.organisation.name} · Product information and feedback`} /><div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0 space-y-4">
    <section className="rounded-panel border border-zk-border bg-zk-surface p-5"><h2 className={SECTION_TITLE}>About this product</h2>{product.goal?.trim() ? <RichText content={product.goal} className="mt-3 text-sm leading-6 text-zk-text2" /> : <p className="mt-3 text-sm leading-6 text-zk-text2">Learn about {product.name} and share feedback with its team. Describe a problem you have experienced or suggest an improvement to help shape the product.</p>}</section>
    <PublicFeedbackIdeas orgSlug={ref.orgSlug} ideas={ideas} title={`Feedback for ${product.name}`} viewAllHref={`/${encodeURIComponent(ref.orgSlug)}/feedback?view=ideas&project=${encodeURIComponent(ref.projectSlug)}`} toolbar={<FeedbackIdeasToolbar key={query + status} baseHref={base} query={query} status={status} />} />
  </div><FeedbackPortalSidebar orgSlug={ref.orgSlug} projectName={product.name} shareHref={base + "?view=share"} /></div></div>;
}
