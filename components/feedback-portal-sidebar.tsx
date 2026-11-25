import { SECTION_TITLE } from "@/lib/ui-style";
import Link from "next/link";
import { feedbackPrimaryAction, feedbackTextLink } from "@/components/feedback-portal-styles";
export function FeedbackPortalSidebar({ orgSlug, projectName, shareHref, guide = false }: { orgSlug: string; projectName?: string; shareHref?: string; guide?: boolean }) {
  const portal = `/${encodeURIComponent(orgSlug)}/feedback`;
  return <aside className="flex min-w-0 flex-col gap-4"><section className="space-y-3 rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5">
    <h2 className={SECTION_TITLE}>{shareHref ? projectName ? `Help improve ${projectName}` : "Have feedback?" : "Explore feedback"}</h2>
    <p className="text-sm leading-6 text-zk-muted">{shareHref ? projectName ? "Found a problem or have an idea?" : "Choose a product to share a problem or improvement." : "Browse feedback ideas across products and follow their progress."}</p>
    <Link href={shareHref ?? portal + "?view=ideas"} className={feedbackPrimaryAction}>{shareHref ? projectName ? "Share feedback" : "Choose a product" : "View all feedback ideas →"}</Link>
    {!projectName ? <div><Link href="/my-submissions" className={feedbackTextLink}>My submissions →</Link></div> : null}
  </section>{guide ? <section className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5"><h2 className={SECTION_TITLE}>How it works</h2><ol className="mt-4 space-y-3">{["Choose a product", "Describe a problem or improvement", "Submitted directly as an Idea in that project", "Agents review and convert approved ideas to issues", "Track progress with your private link"].map((step, index) => <li key={step} className="flex items-start gap-3 text-sm leading-5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zk-border text-xs text-zk-muted">{index + 1}</span>{step}</li>)}</ol><p className="mt-4 border-t border-zk-divider pt-4 text-xs leading-5 text-zk-muted">Feedback stays out of the main work feed until agents approve and convert it to an Issue.</p></section> : null}</aside>;
}
