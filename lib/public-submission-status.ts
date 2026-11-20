import type { Status, IdeaStatus, Substatus } from "@prisma/client";
import { stateLabel, statusLabel } from "@/lib/labels";

const IDEA_LABEL: Record<IdeaStatus, string> = { open: "Awaiting review", converted: "Converted to an issue", rejected: "Not proceeding", archived: "Archived" };
export function publicSubmissionStatus(idea: { status: IdeaStatus; issue: { status: Status; substatus: Substatus | null } | null }): string {
  return idea.issue ? (idea.issue.substatus ? stateLabel(idea.issue.substatus) : statusLabel[idea.issue.status]) : IDEA_LABEL[idea.status];
}
