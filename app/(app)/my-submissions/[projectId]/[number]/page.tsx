import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My submission", robots: { index: false, follow: false } };
export default async function MySubmissionPage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
  const user = await requireUser();
  const { projectId, number } = await params;
  if (!/^[1-9]\d{0,9}$/.test(number)) notFound();
  const row = await prisma.publicSubmission.findFirst({
    where: { userId: user.id, idea: { projectId, number: Number(number), source: "public", isDeleted: false } },
    select: { idea: { select: { number: true, title: true, description: true, status: true, createdAt: true, updatedAt: true,
      project: { select: { name: true, organisation: { select: { name: true } } } }, issue: { select: { status: true, substatus: true } },
    } } },
  });
  if (!row) notFound();
  const { idea } = row;
  return <div className="mx-auto w-full max-w-[920px] space-y-5 pb-10"><Link href="/my-submissions" className="text-sm font-semibold text-zk-accent hover:underline">← My submissions</Link>
    <p className="text-sm text-zk-muted">{idea.project.organisation.name} / {idea.project.name}</p>
    <h1 className="text-[28px] font-extrabold text-zk-text"><span className="text-zk-muted">#{idea.number}</span> {idea.title}</h1>
    <span className="inline-flex rounded-full bg-zk-tint px-3 py-1 text-sm font-semibold text-zk-accent">{publicSubmissionStatus(idea)}</span>
    <p className="text-xs text-zk-muted">Submitted <LocalTime date={idea.createdAt} /> · Updated <LocalTime date={idea.updatedAt} /></p>
    <section className="rounded-2xl border border-zk-border bg-zk-surface p-6"><h2 className="font-bold text-zk-text">Your report</h2><RichText content={idea.description} className="mt-3 text-sm text-zk-text" /></section>
  </div>;
}
