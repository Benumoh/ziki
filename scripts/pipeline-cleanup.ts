/**
 * Pipeline cleanup (#pipeline-cleanup): lists the open issues that left the
 * pipeline (rejected, or marked a duplicate, two or more days ago) and, with
 * --apply, closes them.
 *
 *   pnpm db:pipeline-cleanup                         # dry run, every project
 *   pnpm db:pipeline-cleanup --project desktop       # dry run, one project (slug)
 *   pnpm db:pipeline-cleanup --days 2 --apply        # close them
 *
 * Operator-run against the database in DATABASE_URL. The dry run changes nothing.
 */
import { prisma } from "../lib/prisma";
import { findPipelineCandidates, PIPELINE_GRACE_DAYS, sweepPipelineCleanup, type PipelineCandidate } from "../lib/pipeline-cleanup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function line(c: PipelineCandidate): string {
  const why = c.reason === "duplicate"
    ? `duplicate of #${c.duplicateOfNumber ?? "?"}`
    : `rejected (${c.rejects} reject / ${c.confirms} confirm)`;
  const since = c.since.toISOString().slice(0, 10);
  return `  #${String(c.number).padEnd(6)} ${c.project.slug.padEnd(14)} ${why.padEnd(32)} since ${since}  ${c.title.slice(0, 70)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const graceDays = Number(arg("days") ?? PIPELINE_GRACE_DAYS);
  const slug = arg("project");
  const project = slug ? await prisma.project.findFirst({ where: { slug }, select: { id: true, name: true } }) : null;
  if (slug && !project) throw new Error(`No project with slug "${slug}".`);

  if (apply) {
    if (graceDays !== PIPELINE_GRACE_DAYS || slug) {
      throw new Error(`--apply closes every project's issues after ${PIPELINE_GRACE_DAYS} days; drop --project and --days.`);
    }
    let total = 0;
    for (;;) {
      const res = await sweepPipelineCleanup({ mode: "on" });
      total += res.closed;
      console.log(`Closed ${res.closed} (duplicate ${res.byReason.duplicate}, rejected ${res.byReason.rejected}), skipped ${res.skipped}.`);
      if (!res.closed) break;
    }
    console.log(`Done: ${total} issue(s) closed.`);
    return;
  }

  const counts = { duplicate: 0, rejected: 0 };
  console.log(`DRY RUN: nothing is closed. Open issues rejected or marked duplicate ${graceDays}+ day(s) ago${project ? ` in ${project.name}` : ""}:\n`);
  let cursor: string | null = null;
  do {
    const page = await findPipelineCandidates({ graceDays, projectId: project?.id, cursor, take: 500 });
    for (const c of page.candidates) {
      counts[c.reason]++;
      console.log(line(c));
    }
    cursor = page.cursor;
  } while (cursor);
  console.log(`\nWould close ${counts.duplicate + counts.rejected}: ${counts.duplicate} duplicate, ${counts.rejected} rejected.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
