import { describe, expect, it } from "vitest";
import {
  isProjectFirstPath,
  orgForumPath,
  orgForumPostPath,
  projectForumPath,
  projectForumPostPath,
  projectRef,
  scopedForumPath,
  scopedForumPostPath,
} from "./project-paths";

describe("project-paths forum routing", () => {
  it("does not treat /<org>/forum as a legacy project-first path", () => {
    expect(isProjectFirstPath("/my-org/forum")).toBe(false);
  });

  it("builds organisation forum paths", () => {
    expect(orgForumPath("acme")).toBe("/acme/forum");
    expect(orgForumPostPath("acme", "post-123")).toBe("/acme/forum/post-123");
  });

  it("builds project forum paths", () => {
    const ref = projectRef("acme", "core-api");
    expect(projectForumPath(ref)).toBe("/acme/core-api/forum");
    expect(projectForumPostPath(ref, "post-456")).toBe("/acme/core-api/forum/post-456");
  });

  it("builds scoped forum paths dynamically", () => {
    expect(scopedForumPath("platform")).toBe("/forum");
    expect(scopedForumPath("org", "acme")).toBe("/acme/forum");
    expect(scopedForumPath("project", "acme", "core-api")).toBe("/acme/core-api/forum");

    expect(scopedForumPostPath("platform", "p-1")).toBe("/forum/p-1");
    expect(scopedForumPostPath("org", "p-1", "acme")).toBe("/acme/forum/p-1");
    expect(scopedForumPostPath("project", "p-1", "acme", "core-api")).toBe("/acme/core-api/forum/p-1");
  });
});
