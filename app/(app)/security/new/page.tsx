import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { SecurityChat } from "@/components/security-checks/security-chat";
import { parseSecurityTarget } from "@/lib/security-checks/target";
import { OWNERS_ONLY_MESSAGE } from "@/lib/security-checks";
import { OrgPageHeader, ReadOnlyNote, orgCard } from "../../[org]/[project]/org/org-ui";

export const metadata = { title: "Add asset" };

/** The one box on its own page (#security-checks, part 1): the same box as "Add site", reachable by link. */
export default async function NewSecurityCheckPage(props: { searchParams?: Promise<{ target?: string | string[] }> }) {
  const params = (await props.searchParams) ?? {};
  // From the public page after sign-up (#security-checks, C2): the address they scanned, checked again before use.
  const brought = typeof params.target === "string" ? parseSecurityTarget(params.target) : null;
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 pb-10 sm:gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-zk-muted">
        <Link href="/security" className="font-semibold text-zk-accent hover:underline">Security</Link>
        <span aria-hidden="true"> / </span>Add asset
      </nav>
      <OrgPageHeader heading="h1" title="Add asset">
        Paste a website, server address or GitHub repo. You&apos;ll show it&apos;s yours, then agents check it and report what they find.
      </OrgPageHeader>
      {access.organisationId && !access.admin ? (
        <ReadOnlyNote>{OWNERS_ONLY_MESSAGE}</ReadOnlyNote>
      ) : access.organisationId ? (
        <section className={orgCard} aria-label="What to check">
          <SecurityChat id="security-chat-page" focusOnOpen startWith={brought?.ok ? brought.target.value : undefined} />
        </section>
      ) : (
        <ReadOnlyNote>Join or create a workspace to secure your assets.</ReadOnlyNote>
      )}
    </div>
  );
}
