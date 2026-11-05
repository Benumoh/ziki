import { z } from "zod";

/**
 * An agent's profile (#agent-profile): its @username, a one-line tagline,
 * "About me", and its skills, each a shared tag with the agent's own short
 * line and longer description.
 */

export const AGENT_USERNAME_MIN = 3;
export const AGENT_USERNAME_MAX = 30;
export const AGENT_TAGLINE_MAX = 120;
export const AGENT_ABOUT_MAX = 2000;
export const SKILL_TAG_MAX = 40;
export const AGENT_SKILL_SUMMARY_MAX = 120;
export const AGENT_SKILL_DESCRIPTION_MAX = 2000;
export const AGENT_SKILLS_MAX = 20;

/** Path words under /api/v1/agents/, which a username can't take. */
export const RESERVED_AGENT_USERNAMES = ["me", "pairing", "new", "agents", "admin", "api"] as const;

export const agentUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(AGENT_USERNAME_MIN, `A username is at least ${AGENT_USERNAME_MIN} characters.`)
  .max(AGENT_USERNAME_MAX, `A username is at most ${AGENT_USERNAME_MAX} characters.`)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, digits and dashes, starting and ending with a letter or digit.")
  .refine((value) => !(RESERVED_AGENT_USERNAMES as readonly string[]).includes(value), "That username is reserved. Pick another.");

/** Text that may be cleared: an empty string or null clears it. */
const clearable = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => (value === null ? null : value.trim() || null))
    .refine((value) => value === null || value.length <= max, `${label} is at most ${max} characters.`);

/** PATCH /api/v1/agents/me and the page's form: any of the three, at least one. */
export const agentProfileUpdateSchema = z
  .object({
    username: agentUsernameSchema.optional(),
    tagline: clearable(AGENT_TAGLINE_MAX, "The tagline").optional(),
    about: clearable(AGENT_ABOUT_MAX, "About me").optional(),
  })
  .strict()
  .refine((value) => value.username !== undefined || value.tagline !== undefined || value.about !== undefined, {
    message: "Send at least one of username, tagline and about.",
  });

export type AgentProfileUpdate = z.infer<typeof agentProfileUpdateSchema>;

export const skillTagNameSchema = z
  .string()
  .trim()
  .min(1, "Name the skill's tag.")
  .max(SKILL_TAG_MAX, `A tag is at most ${SKILL_TAG_MAX} characters.`)
  .refine((value) => tagSlug(value).length > 0, "A tag needs a letter or digit.");

export const agentSkillSchema = z
  .object({
    tag: skillTagNameSchema,
    summary: z
      .string()
      .trim()
      .min(1, "Give the skill a short description.")
      .max(AGENT_SKILL_SUMMARY_MAX, `The short description is at most ${AGENT_SKILL_SUMMARY_MAX} characters.`),
    description: z
      .string()
      .trim()
      .min(1, "Describe the skill.")
      .max(AGENT_SKILL_DESCRIPTION_MAX, `The description is at most ${AGENT_SKILL_DESCRIPTION_MAX} characters.`),
  })
  .strict();

/** PUT /api/v1/agents/me/skills: the whole list, in order. Each tag once. */
export const agentSkillsReplaceSchema = z
  .object({ skills: z.array(agentSkillSchema).max(AGENT_SKILLS_MAX, `At most ${AGENT_SKILLS_MAX} skills.`) })
  .strict()
  .refine((value) => new Set(value.skills.map((skill) => tagSlug(skill.tag))).size === value.skills.length, {
    message: "Name each tag once.",
  });

/** PUT /api/v1/agents/me/skills/{tag}: the tag comes from the path. */
export const agentSkillUpsertSchema = agentSkillSchema.omit({ tag: true });

export type AgentSkillInput = z.infer<typeof agentSkillSchema>;

/** A tag's key: lowercase, runs of anything but letters, digits, "+" and "#" become one dash. "C#" stays "c#". */
export function tagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_TAG_MAX);
}

/**
 * A username from an agent's name, the way the migration made them: lowercase,
 * runs of anything but letters and digits become one dash, no dash at either
 * end, at most 24 characters, "agent" when nothing is left.
 */
export function usernameFromName(name: string): string {
  const handle = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return handle.length >= AGENT_USERNAME_MIN && !(RESERVED_AGENT_USERNAMES as readonly string[]).includes(handle)
    ? handle
    : `${handle || "agent"}-bot`.replace(/^-/, "");
}
