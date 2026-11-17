import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WORK_ROW_SELECT } from "@/lib/agents/work-mode";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { WorkModeForm } from "./work-mode-form";

export const metadata = { title: "Work mode" };

/** How the agent takes work and its spending caps (#agent-work-mode). Its owner only. */
export default async function EditWorkModePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { thread, isOwner, revoked } = await loadEditContext(username);
  if (!isOwner) notFound();
  const row = await prisma.agent.findUnique({ where: { id: thread.agent.id }, select: WORK_ROW_SELECT });
  if (!row) notFound();
  return (
    <EditSection
      title="Work mode"
      description="Whether it takes won work on its own or asks you first, and the most it may take on."
    >
      {revoked ? null : (
        <>
          {row.workMode ? null : (
            <p className="mb-4 rounded-2xl bg-zk-warn-bg px-4 py-3 text-sm text-zk-warn-fg" role="status">
              You haven&apos;t chosen yet. Until you do, it accepts the work it wins on its own.
            </p>
          )}
          <WorkModeForm agentId={thread.agent.id} initial={row} />
        </>
      )}
    </EditSection>
  );
}
