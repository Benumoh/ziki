import { describe, expect, it } from "vitest";
import { createBugSchema, signupSchema, updateBugSchema } from "@/lib/validations/issue";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { safeHref } from "@/lib/rich-text";
import { agentProfileUpdateSchema, agentSkillsReplaceSchema } from "@/lib/validations/agent-profile";

/** Invalid payloads and unsafe input are rejected before they reach the database or the page. */
const valid = { title: "Login button broken", description: "Clicking sign in does nothing on mobile." };

describe("issue payloads", () => {
  it("accepts a valid report", () => {
    expect(createBugSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a title or description out of bounds", () => {
    expect(createBugSchema.safeParse({ ...valid, title: "ab" }).success).toBe(false);
    expect(createBugSchema.safeParse({ ...valid, title: "a".repeat(201) }).success).toBe(false);
    expect(createBugSchema.safeParse({ ...valid, description: "too short" }).success).toBe(false);
  });

  it("rejects fields a client may not set: status at creation, a severity, an invalid status update", () => {
    expect(createBugSchema.safeParse({ ...valid, status: "closed" }).success).toBe(false);
    expect(createBugSchema.safeParse({ ...valid, severity: "high" }).success).toBe(false);
    expect(updateBugSchema.safeParse({ status: "nonsense" }).success).toBe(false);
  });

  it("rejects proof links that aren't GitHub URLs", () => {
    expect(createBugSchema.safeParse({ ...valid, proofLinks: "ftp://files.example.com/shot.png" }).success).toBe(false);
    expect(createBugSchema.safeParse({ ...valid, proofLinks: "https://example.com/screenshot.png" }).success).toBe(false);
  });
});

describe("passwords", () => {
  it("rejects a password over 72 bytes, which bcrypt would silently truncate", () => {
    const long = "x".repeat(72) + "1";
    expect(signupSchema.safeParse({ name: "Dana Dev", email: "dana@zendor.dev", password: long, confirmPassword: long }).success).toBe(false);
  });
});

describe("unsafe URLs", () => {
  it("never redirects off-site or back into an auth route after sign-in", () => {
    for (const target of ["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.example", "javascript:alert(1)", "/login", "/bugs/../login"]) {
      expect(safeCallbackUrl(target)).toBe("/home");
    }
    expect(safeCallbackUrl("/issues/new")).toBe("/issues/new");
  });

  it("renders only http(s) and mailto links", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("java\u0000script:alert(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
  });
});

describe("agent profiles", () => {
  const skill = { tag: "Postgres", summary: "Query plans.", description: "EXPLAIN ANALYZE first." };

  it("refuses a username that isn't a handle, is reserved, or is out of bounds", () => {
    expect(agentProfileUpdateSchema.safeParse({ username: "ada-claude" }).success).toBe(true);
    for (const username of ["Ada Claude", "-ada", "ab", "a".repeat(31), "me", "pairing"]) {
      expect(agentProfileUpdateSchema.safeParse({ username }).success, username).toBe(false);
    }
  });

  it("caps the tagline and About me, and refuses an empty or unknown update", () => {
    expect(agentProfileUpdateSchema.safeParse({ tagline: "a".repeat(121) }).success).toBe(false);
    expect(agentProfileUpdateSchema.safeParse({ about: "a".repeat(2001) }).success).toBe(false);
    expect(agentProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(agentProfileUpdateSchema.safeParse({ rating: 5 }).success).toBe(false);
  });

  it("refuses a skills list with a tag twice, over 20 skills, or text over its limit", () => {
    expect(agentSkillsReplaceSchema.safeParse({ skills: [skill] }).success).toBe(true);
    expect(agentSkillsReplaceSchema.safeParse({ skills: [skill, { ...skill, tag: "postgres" }] }).success).toBe(false);
    expect(agentSkillsReplaceSchema.safeParse({ skills: Array.from({ length: 21 }, (_, n) => ({ ...skill, tag: `Tag ${n}` })) }).success).toBe(false);
    expect(agentSkillsReplaceSchema.safeParse({ skills: [{ ...skill, summary: "a".repeat(121) }] }).success).toBe(false);
  });
});
