"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { invalidateWorkflow } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW, workflowSettingsSchema, workflowValues } from "@/lib/workflow-config";

export type WorkflowActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const NUMERIC_FIELDS = [
  "ideaThreshold",
  "confirmationsNeeded",
  "verdictsNeeded",
  "offerWindowSeconds",
  "heartbeatMinutes",
  "deliveryMinutes",
  "maxActiveClaims",
  "volunteerWindowSeconds",
  "abandonCheckMinutes",
  "abandonThreshold",
  "closeThreshold",
  "managerVoteWeight",
  "awardThreshold",
  "acceptThreshold",
  "stakeLimit",
  "stakeInProgressLimit",
  "planReviewSeconds",
  "humanApprovalsNeeded",
] as const;

async function projectSettingsAccess(slug: string) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false as const, error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) {
    return { ok: false as const, error: "Only organisation owners and admins can change workflow settings." };
  }
  const project = await prisma.project.findFirst({
    where: { organisationId, slug },
    select: { id: true, slug: true, workflow: true },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  return { ok: true as const, user, organisationId, project };
}

/** Save one project's workflow dials (#595). Organisation owners/admins only. */
export async function updateProjectWorkflowAction(
  _previous: WorkflowActionResult | undefined,
  formData: FormData,
): Promise<WorkflowActionResult> {
  const slug = String(formData.get("slug") ?? "").trim();
  const access = await projectSettingsAccess(slug);
  if (!access.ok) return access;

  const raw: Record<string, unknown> = {
    autoMerge: formData.get("autoMerge") === "on",
    governance: formData.get("governance"),
  };
  for (const field of NUMERIC_FIELDS) {
    const rawValue = formData.get(field);
    raw[field] =
      field === "humanApprovalsNeeded" && rawValue === null
        ? DEFAULT_PROJECT_WORKFLOW.humanApprovalsNeeded
        : Number(rawValue);
  }

  const parsed = workflowSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = typeof issue.path[0] === "string" ? issue.path[0] : "";
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the workflow settings.",
      fieldErrors,
    };
  }

  const current = workflowValues(access.project.workflow);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of [...NUMERIC_FIELDS, "autoMerge", "governance"] as const) {
    if (current[field] !== parsed.data[field]) {
      changes[field] = { from: current[field], to: parsed.data[field] };
    }
  }

  if (Object.keys(changes).length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.projectWorkflow.upsert({
          where: { projectId: access.project.id },
          update: parsed.data,
          create: { projectId: access.project.id, ...parsed.data },
        });
        await tx.projectAuditEvent.create({
          data: {
            organisationId: access.organisationId,
            projectId: access.project.id,
            actorUserId: access.user.id,
            action: "workflow.updated",
            changes: changes as Prisma.InputJsonValue,
          },
        });
      });
    } catch {
      // The transaction rolled back: the old settings still apply.
      return { ok: false, error: "Couldn't save the workflow settings. Try again." };
    }
    invalidateWorkflow(access.project.id);
  }

  revalidatePath(`/projects/${encodeURIComponent(access.project.slug)}/settings`);
  return { ok: true };
}
