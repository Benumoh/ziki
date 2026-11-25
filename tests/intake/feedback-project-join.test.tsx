import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ project: vi.fn(), request: vi.fn(), user: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: mocks.project }, projectJoinRequest: { findUnique: mocks.request } } }));
vi.mock("@/lib/auth-helpers", () => ({ optionalUser: mocks.user }));
vi.mock("@/lib/project-permissions", () => ({ canContributeToProject: mocks.member }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, redirect: (href: string) => { throw new Error(href); } }));
vi.mock("@/components/project-join-request-button", () => ({ ProjectJoinRequestButton: ({ project, state }: { project: { id: string }; state: string }) => <button data-project={project.id}>{state}</button> }));
vi.mock("@/components/feedback-open-project-join", () => ({ FeedbackOpenProjectJoin: ({ projectId }: { projectId: string }) => <button data-project={projectId}>Join</button> }));
import { FeedbackProjectJoin } from "@/components/feedback-project-join";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: "web-id", name: "Web", organisationId: "org-id", isOpenForContributors: false, contributorGuidelines: null });
  mocks.user.mockResolvedValue({ id: "user-id", role: "user" });
  mocks.member.mockResolvedValue(false);
  mocks.request.mockResolvedValue({ status: "pending" });
});
it("restricts requests to the exact public project and preserves a pending request", async () => {
  const html = renderToStaticMarkup(await FeedbackProjectJoin({ orgSlug: "team", projectSlug: "web" }));
  expect(mocks.project).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "web", visibility: "public", archivedAt: null, organisation: { slug: "team", archivedAt: null } } }));
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId_userId: { projectId: "web-id", userId: "user-id" } } }));
  expect(html).toContain('data-project="web-id"');
  expect(html).toContain("pending");
  expect(html).not.toContain("/discover");
});
it("returns guests to this same project after sign-in", async () => {
  mocks.user.mockResolvedValue(null);
  await expect(FeedbackProjectJoin({ orgSlug: "team", projectSlug: "web" })).rejects.toThrow("/login?callbackUrl=%2Fteam%2Fweb%2Ffeedback%3Fview%3Djoin");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("does not offer joining for a private or missing project", async () => {
  mocks.project.mockResolvedValue(null);
  await expect(FeedbackProjectJoin({ orgSlug: "team", projectSlug: "private" })).rejects.toThrow("not-found");
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});
