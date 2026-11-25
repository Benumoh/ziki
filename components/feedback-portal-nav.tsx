"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ZikiMark } from "@/components/ziki-mark";
import { Avatar } from "@/components/avatar";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { avatarTone } from "@/lib/avatar";
import { orgHomePath } from "@/lib/project-paths";
import { publicOrgFeedbackPath } from "@/lib/public-project-paths";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";
export function FeedbackPortalNav({ orgSlug, orgName, name }: { orgSlug: string | null; orgName?: string | null; name?: string | null }) {
  const path = usePathname();
  const params = useSearchParams();
  const portal = orgSlug ? publicOrgFeedbackPath(orgSlug) : "/discover";
  const active = path.startsWith("/my-submissions") ? "submissions" : params.get("view") === "ideas" || params.get("view") === "share" || params.has("idea") || path.includes("/track/") ? "feedback" : "projects";
  const tabs = [{ id: "projects", label: "Projects", href: portal }, { id: "feedback", label: "Feedback", href: orgSlug ? portal + "?view=ideas" : portal }, { id: "submissions", label: "My submissions", href: "/my-submissions" }];
  return <header className="relative z-40 border-b border-zk-border bg-zk-surface lg:sticky lg:top-0"><div className={`${PAGE_CONTAINER_CLASS} flex flex-wrap items-center gap-x-3 gap-y-2 py-3 lg:py-1.5 max-sm:gap-x-2 max-sm:py-2 sm:px-6`}>
    <div className="flex min-w-0 items-center gap-2">
      <Link href="/" aria-label="Ziki" className={`flex shrink-0 items-center rounded-full ${focus}`}><ZikiMark className="h-8 w-auto text-zk-text max-sm:h-7" /></Link>
      <span aria-hidden="true" className="h-[18px] w-px shrink-0 bg-zk-border max-sm:hidden" />
      <Link href={orgSlug ? orgHomePath(orgSlug) : "/"} aria-label={`${orgName ?? "Organisation"} main page`} className={`inline-flex h-[30px] max-w-44 items-center gap-2 rounded-full px-1.5 text-[13px] font-medium text-zk-text hover:bg-zk-chip ${focus}`}>
        <span aria-hidden="true" className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-chip text-xs font-bold ${avatarTone(orgName)}`}>{orgName?.trim().charAt(0).toUpperCase() || "?"}</span><span className="truncate">{orgName ?? "Feedback portal"}</span>
      </Link>
    </div>
    <nav aria-label="Feedback portal" className="order-3 flex w-full items-center gap-7 sm:order-none sm:ml-8 sm:w-auto">{tabs.map(tab => <Link key={tab.id} href={tab.href} aria-current={active === tab.id ? "page" : undefined} className={`relative inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md text-[14px] ${focus} ${active === tab.id ? "font-semibold text-zk-accent after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-zk-accent" : "font-medium text-zk-text2 hover:text-zk-accent"}`}>{tab.label}</Link>)}</nav>
    {name ? <Link href="/my-submissions" className={`ml-auto inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-zk-border bg-zk-surface py-0.5 pl-0.5 pr-3 text-zk-text hover:bg-zk-chip ${focus}`}><Avatar name={name} size="md" variant="solid" /><span className="max-w-40 truncate text-[13px] font-medium max-sm:sr-only">{name}</span><span className="sr-only">My submissions</span></Link> : <Link href={`/login?callbackUrl=${encodeURIComponent(path + (params.size ? "?" + params : ""))}`} className={`ml-auto inline-flex h-9 items-center rounded-control text-sm font-medium text-zk-text hover:underline ${focus}`}>Sign in</Link>}
  </div></header>;
}
