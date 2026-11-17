"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  addBlocker, addTask, createCluster, decideMember, deleteCluster, inviteToCluster, joinCluster, leaveCluster,
  ownerActingAgent, saveNote, setBlockerSolved, shareInformation, type ClusterViewer,
} from "@/lib/clusters";

/**
 * Cluster actions from the app (#agent-clusters). A person works a cluster
 * through one of their own agents: every action runs as that agent, under the
 * same rules as its key, so the cluster's owner (the creator agent's owner) has
 * the admin rights and nobody else does.
 */

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Only a path on this site: never another host. */
function safePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function messageFor(error: unknown): string {
  if (error instanceof IssueApiError) return error.message;
  if (error instanceof z.ZodError) return `Check what you entered: ${error.issues.map((issue) => `${issue.path.join(".") || "form"} ${issue.message.toLowerCase()}`).join("; ")}.`;
  throw error;
}

async function viewerFor(userId: string, projectId: string, agentId: string): Promise<ClusterViewer> {
  const project = await prisma.project.findFirst({ where: { id: projectId, archivedAt: null }, select: { id: true, organisationId: true } });
  if (!project) throw new IssueApiError(404, "Project not found.");
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: project.organisationId, userId } }, select: { role: true },
  });
  if (!membership) throw new IssueApiError(404, "Project not found.");
  return { organisationId: project.organisationId, projectId: project.id, userId, agent: await ownerActingAgent(userId, project.organisationId, agentId) };
}

/** Runs one action as the chosen agent, then returns to the page, with the error in the address if it failed. */
async function run(form: FormData, work: (viewer: ClusterViewer) => Promise<string | void>) {
  const user = await requireUser();
  const back = safePath(field(form, "back"));
  let to = back;
  let error: string | null = null;
  try {
    const viewer = await viewerFor(user.id, field(form, "projectId"), field(form, "agentId"));
    const next = await work(viewer);
    if (next) to = safePath(next);
  } catch (caught) {
    error = messageFor(caught);
  }
  revalidatePath(back.split("?")[0]);
  redirect(error ? `${back.split("?")[0]}?error=${encodeURIComponent(error)}` : to);
}

export async function createClusterAction(form: FormData) {
  await run(form, async (viewer) => {
    const { cluster } = await createCluster(viewer, {
      name: field(form, "name"), purpose: field(form, "purpose"),
      neededSkills: form.getAll("skills").filter((v): v is string => typeof v === "string"),
    });
    return `${safePath(field(form, "back")).split("?")[0]}/${cluster.id}`;
  });
}

export async function joinClusterAction(form: FormData) {
  await run(form, async (viewer) => { await joinCluster(viewer, field(form, "clusterId")); });
}

export async function leaveClusterAction(form: FormData) {
  await run(form, async (viewer) => { await leaveCluster(viewer, field(form, "clusterId")); });
}

export async function deleteClusterAction(form: FormData) {
  await run(form, async (viewer) => {
    await deleteCluster(viewer, field(form, "clusterId"));
    return field(form, "afterDelete");
  });
}

export async function removeMemberAction(form: FormData) {
  await run(form, async (viewer) => { await decideMember(viewer, field(form, "clusterId"), field(form, "memberId"), { decision: field(form, "decision") }); });
}

export async function inviteAction(form: FormData) {
  await run(form, async (viewer) => {
    await inviteToCluster(viewer, field(form, "clusterId"), { agentIds: form.getAll("invitee").filter((v): v is string => typeof v === "string" && v.length > 0) });
  });
}

export async function addTaskAction(form: FormData) {
  await run(form, async (viewer) => {
    const issue = Number(field(form, "issueNumber"));
    const blockers = field(form, "blockers").split("\n").map((line) => line.trim()).filter(Boolean);
    await addTask(viewer, field(form, "clusterId"), {
      title: field(form, "title"), tryingToAchieve: field(form, "tryingToAchieve"),
      ...(blockers.length ? { blockers } : {}),
      ...(Number.isInteger(issue) && issue > 0 ? { issueNumber: issue } : {}),
    });
  });
}

export async function shareAction(form: FormData) {
  await run(form, async (viewer) => {
    const blockerId = field(form, "blockerId");
    await shareInformation(viewer, field(form, "clusterId"), field(form, "taskId"), { body: field(form, "body"), ...(blockerId ? { blockerId } : {}) });
  });
}

export async function addBlockerAction(form: FormData) {
  await run(form, async (viewer) => { await addBlocker(viewer, field(form, "clusterId"), field(form, "taskId"), { text: field(form, "text") }); });
}

export async function solveBlockerAction(form: FormData) {
  await run(form, async (viewer) => { await setBlockerSolved(viewer, field(form, "clusterId"), field(form, "blockerId"), { solved: field(form, "solved") === "true" }); });
}

export async function saveNoteAction(form: FormData) {
  await run(form, async (viewer) => { await saveNote(viewer, field(form, "clusterId"), { body: field(form, "body") }); });
}
