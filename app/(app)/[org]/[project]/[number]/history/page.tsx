import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { canDeleteTicket } from "@/lib/ticket-deletion";
import { organisationAccessFor } from "@/lib/organisation-access";
import { formatIssueNumber } from "@/lib/issue-number";
import { issueHref, issuePath } from "@/lib/issue-ref";
import { findProjectIssue, parseIssueNumber } from "@/lib/project-issue";
import { buildVersions } from "@/lib/issue-revisions";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { TextDiffView } from "@/components/text-diff-view";
import { wordDiff } from "@/lib/text-diff";

type Props = {
  params: Promise<{ org: string; project: string; number: string }>;
};

export const metadata = { title: "Edit history" };

/**
 * Every version of an issue's title and description (#303). Visible to
 * anyone who can see the issue, on the same rule as the issue page.
 */
export default async function IssueHistoryPage({ params }: Props) {
  const { org, project, number: rawNumber } = await params;
  const user = await requireUser();
  // #project-urls: the issue under this project's slug in the viewer's
  // organisation. A number that lives in another project redirects there.
  const number = parseIssueNumber(rawNumber);
  const lookup = number === null ? null : await findProjectIssue(org, project, number);
  if (lookup?.kind === "moved") permanentRedirect(issuePath(lookup.issue.ref, lookup.issue.number, "/history"));
  if (lookup?.kind !== "found") notFound();
  // The role in the issue's organisation, not in whichever one the viewer is working in.
  const access = await organisationAccessFor(user.id, lookup.issue.organisationId, user.role);

  const bug = await prisma.bug.findUnique({
    where: { id: lookup.issue.id },
    select: {
      id: true,
      number: true,
      project: { select: { slug: true, organisation: { select: { slug: true } } } },
      title: true,
      description: true,
      createdAt: true,
      isDeleted: true,
      reporter: { select: { name: true } },
      revisions: {
        orderBy: { editedAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          editedAt: true,
          editedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!bug || (bug.isDeleted && !canDeleteTicket(user.role, access.membershipRole))) notFound();

  const versions = buildVersions(
    {
      title: bug.title,
      description: bug.description,
      createdAt: bug.createdAt,
      reporterName: bug.reporter.name,
    },
    bug.revisions,
  );
  const newestFirst = [...versions].reverse();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={issueHref(bug)} className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline">
          Back to issue
        </Link>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text break-words">
          Edit history{" "}
          <span className="font-bold text-zk-muted">
            · {formatIssueNumber(bug.number)} {bug.title}
          </span>
        </h1>
        <p className="mt-1 text-sm text-zk-text2">
          {versions.length === 1
            ? "This issue has not been edited."
            : `${versions.length} versions of the title and description, newest first.`}
        </p>
      </div>

      <ol className="space-y-4">
        {newestFirst.map((version) => {
          const previous = versions[version.number - 2];
          const titleChanged = previous && previous.title !== version.title;
          const title = titleChanged ? wordDiff(previous.title, version.title) : null;
          return (
            <li
              key={version.number}
              className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6"
              aria-labelledby={`version-${version.number}`}
            >
              <h2 id={`version-${version.number}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-bold text-zk-text">
                  {version.number === 1 ? "Original report" : `Version ${version.number}`}
                </span>
                {version.isCurrent ? (
                  <span className="rounded-full bg-zk-ok-bg px-2 py-0.5 text-xs font-bold text-zk-ok-fg">
                    Current
                  </span>
                ) : null}
                <span className="text-zk-text2">
                  {version.number === 1 ? "by" : "edited by"} {version.author}
                </span>
                <LocalTime className="text-xs text-zk-muted" date={version.at} />
              </h2>

              {previous ? (
                <div className="mt-4 space-y-3">
                  {title ? (
                    <p className="text-sm text-zk-text2">
                      <span className="font-medium">Title: </span>
                      <del className="rounded-sm bg-zk-bad-bg px-1 text-zk-bad-fg">
                        {title.removed.map((s, i) =>
                          s.changed ? (
                            <span key={i} className="bg-zk-bad-fg/20">
                              {s.text}
                            </span>
                          ) : (
                            <span key={i}>{s.text}</span>
                          ),
                        )}
                      </del>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> changed to </span>
                      <ins className="rounded-sm bg-zk-ok-bg px-1 text-zk-ok-fg no-underline">
                        {title.added.map((s, i) =>
                          s.changed ? (
                            <span key={i} className="bg-zk-ok-fg/20">
                              {s.text}
                            </span>
                          ) : (
                            <span key={i}>{s.text}</span>
                          ),
                        )}
                      </ins>
                    </p>
                  ) : null}
                  <TextDiffView before={previous.description} after={version.description} />
                </div>
              ) : null}

              <details className="group mt-4" open={!previous}>
                <summary className="cursor-pointer text-xs font-bold text-zk-accent hover:underline">
                  {previous ? "Show this version as it read" : "As reported"}
                </summary>
                <div className="mt-2 rounded-xl border border-zk-divider p-3">
                  {previous ? <p className="font-bold text-zk-text">{version.title}</p> : null}
                  <RichText content={version.description} />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
