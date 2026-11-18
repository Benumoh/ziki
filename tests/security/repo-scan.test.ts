import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  securityCheckItem: { findUnique: vi.fn() },
  securityCodeRead: { count: vi.fn(), create: vi.fn() },
  project: { findMany: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/github/client", () => ({ githubClientFor: vi.fn(), installationIdForRepo: vi.fn(), githubApiUrl: () => "", GitHubError: class extends Error {} }));

import { readCodeForPart } from "@/lib/security-checks/code-access";
import { filesToRead, packagesIn } from "@/lib/security-checks/repo-scan";
import type { RepoReader } from "@/lib/security-checks/repo-reader";

describe("repo quick scan: which packages and files it reads (#security-repo-scan)", () => {
  it("reads exact versions from lockfiles and manifests, and skips ranges it can't pin", () => {
    expect(packagesIn("package-lock.json", JSON.stringify({ packages: { "": {}, "node_modules/a": { version: "1.2.3" }, "node_modules/b/node_modules/c": { version: "0.1.0" } } })))
      .toEqual([{ ecosystem: "npm", name: "a", version: "1.2.3", from: "package-lock.json" }, { ecosystem: "npm", name: "c", version: "0.1.0", from: "package-lock.json" }]);
    expect(packagesIn("package.json", JSON.stringify({ dependencies: { exact: "2.0.0", caret: "^3.1.0", loose: ">=1 <2" } })).map((p) => `${p.name}@${p.version}`)).toEqual(["exact@2.0.0", "caret@3.1.0"]);
    expect(packagesIn("requirements.txt", "Django==4.2.1\nrequests>=2\n# flask==1.0\n").map((p) => `${p.ecosystem}:${p.name}@${p.version}`)).toEqual(["PyPI:django@4.2.1"]);
    expect(packagesIn("go.mod", "module x\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n")).toEqual([expect.objectContaining({ ecosystem: "Go", name: "github.com/gin-gonic/gin", version: "1.9.0" })]);
    expect(packagesIn("package-lock.json", "not json")).toEqual([]);
  });

  it("opens lockfiles, workflows and config files, never vendored or example files, within its limit", () => {
    const picked = filesToRead([
      { path: "package-lock.json", size: 100 },
      { path: ".github/workflows/ci.yml", size: 50 },
      { path: "config/settings.json", size: 40 },
      { path: "node_modules/x/settings.json", size: 40 },
      { path: "config/settings.example.json", size: 40 },
      { path: "huge.json", size: 10_000_000 },
    ]);
    expect(picked).toEqual({ lockfiles: ["package-lock.json"], workflows: [".github/workflows/ci.yml"], configs: ["config/settings.json"] });
  });
});

describe("agents read a repo only through a part they hold (#security-repo-scan)", () => {
  const held = { agentId: "agentA", status: "checking", kind: "check", check: { status: "checking", organisationId: "org1", target: { kind: "repo", value: "acme/secret" } } };
  const reader = (overrides: Partial<RepoReader> = {}): RepoReader => ({
    meta: async () => ({ status: "ok", private: true, pushedAt: null, defaultBranch: "main" }),
    tree: async () => ({ files: [{ path: "src/app.ts", size: 10 }], truncated: false }),
    file: async (path) => (path === "src/app.ts" ? "export const a = 1;" : null),
    dependabotAlerts: async () => null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.securityCheckItem.findUnique.mockResolvedValue(held);
    db.securityCodeRead.count.mockResolvedValue(0);
    // The workspace connected acme/secret through the App.
    db.project.findMany.mockResolvedValue([{ repoUrl: "https://github.com/acme/secret", githubInstallationId: "42" }]);
  });

  it("serves the file list and files of a connected private repo through the App, and records every read", async () => {
    const open = vi.fn(async () => reader());
    expect(await readCodeForPart("agentA", "item1", null, { reader: open })).toEqual({ files: [{ path: "src/app.ts", size: 10 }], truncated: false });
    expect(await readCodeForPart("agentA", "item1", "src/app.ts", { reader: open })).toEqual({ path: "src/app.ts", text: "export const a = 1;" });
    expect(open).toHaveBeenCalledWith("acme", "secret", { installationId: "42" });
    expect(db.securityCodeRead.create.mock.calls.map(([args]) => args.data.path)).toEqual(["", "src/app.ts"]);
  });

  it("refuses an agent that doesn't hold the part, or a part that's over", async () => {
    await expect(readCodeForPart("agentB", "item1", null, { reader: async () => reader() })).rejects.toMatchObject({ status: 404 });
    db.securityCheckItem.findUnique.mockResolvedValue({ ...held, status: "done" });
    await expect(readCodeForPart("agentA", "item1", null, { reader: async () => reader() })).rejects.toMatchObject({ status: 409, code: "not_held" });
  });

  it("doesn't open a private repo the workspace never connected", async () => {
    db.project.findMany.mockResolvedValue([]);
    const open = vi.fn(async (_o: string, _n: string, access: { installationId: string | null }) => reader({ meta: async () => (access.installationId ? { status: "ok", private: true, pushedAt: null, defaultBranch: "main" } : { status: "not_found" }) }));
    await expect(readCodeForPart("agentA", "item1", null, { reader: open })).rejects.toMatchObject({ status: 409, code: "not_readable" });
    expect(open).toHaveBeenCalledWith("acme", "secret", { installationId: null });
  });

  it("refuses paths that climb out of the repo, and stops at the per-part read limit", async () => {
    await expect(readCodeForPart("agentA", "item1", "../etc/passwd", { reader: async () => reader() })).rejects.toMatchObject({ status: 400 });
    db.securityCodeRead.count.mockResolvedValue(1500);
    await expect(readCodeForPart("agentA", "item1", "src/app.ts", { reader: async () => reader() })).rejects.toMatchObject({ status: 429 });
    expect(db.securityCodeRead.create).not.toHaveBeenCalled();
  });
});
