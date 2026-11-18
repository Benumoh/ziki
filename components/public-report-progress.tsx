import type { Status, Substatus } from "@prisma/client";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";

export function PublicReportProgress({ title, number, state, summary, description, createdAt, updatedAt, issue, inactive = false }: {
  title: string; number: string; state: string; summary: string | null; description: string | null;
  createdAt: Date; updatedAt: Date;
  issue: { status: Status; substatus: Substatus | null } | null;
  inactive?: boolean;
}) {
  // Only production deployment completes the customer-facing resolution step.
  const resolved = issue?.status === "resolved" && (issue.substatus === "on_prod" || issue.substatus === "published");
  const current = resolved ? 2 : issue || inactive ? 1 : 0;
  const steps = ["Received", inactive ? state : "Under review", "Resolved"];
  return (
    <div className="space-y-5">
      <section aria-label="Report progress" className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
        <h2 className="text-xl font-bold text-zk-text"><span className="text-zk-muted">{number}</span> {title}</h2>
        <p className="mt-3 text-sm text-zk-text2"><span className="rounded-full bg-zk-tint px-3 py-1 font-semibold text-zk-accent">{state}</span><span className="ml-3">Submitted <LocalTime date={createdAt} /></span></p>
        <ol className="mt-8 flex" aria-label="Report timeline">
          {steps.map((label, index) => (
            <li key={index} aria-current={index === current ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-3 text-center text-xs sm:text-sm">
              {index < 2 ? <span aria-hidden className={`absolute left-1/2 right-[-50%] top-4 h-0.5 ${index < current ? "bg-zk-accent" : "bg-zk-border"}`} /> : null}
              <span aria-hidden className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 font-bold ${index <= current ? "border-zk-accent bg-zk-accent text-white" : "border-zk-border bg-zk-surface text-zk-muted"}`}>{index < current || resolved && index === current ? "✓" : index + 1}</span>
              <span className={index <= current ? "font-semibold text-zk-text" : "text-zk-muted"}>{label}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
        <h2 className="font-bold text-zk-text">Latest update</h2>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm text-zk-text2"><p>{resolved ? "The project reports that this change is live in production." : issue ? `Current project status: ${state}.` : inactive ? `This report is ${state.toLowerCase()}.` : "Your report has been received and is awaiting review."}</p><LocalTime date={updatedAt} /></div>
      </section>
      <section className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-7">
        <h2 className="font-bold text-zk-text">Your report</h2>
        {summary ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zk-text2">{summary}</p> : null}
        {description ? <details className="mt-4 border-t border-zk-divider pt-4"><summary className="cursor-pointer text-sm font-semibold text-zk-text">Steps and details</summary><RichText content={description} className="mt-3 text-sm text-zk-text" /></details> : null}
      </section>
    </div>
  );
}
