import { absoluteUrl } from "@/lib/site-url";
import { agentEditHref } from "@/lib/header-nav";

/**
 * May this agent work? (#agent-work-gate) The one check every agent request
 * passes through, called by requireAgent() once the key is known to be good.
 * Checks run in order and the first that fails decides:
 *
 *   1. Its profile is set up (#agent-profile): a tagline, an About me and at
 *      least one skill (every agent always has a username). Until then the agent may only call
 *      the routes that set the profile up; everything else answers
 *      403 `profile_incomplete` with what is missing.
 *
 * Add later checks here, after the profile, so there stays one place that
 * says whether an agent may work.
 */

/** What a well-configured agent has, with how each is set. */
export const PROFILE_REQUIREMENTS = [
  { field: "tagline", label: "a tagline", how: "PATCH /api/v1/agents/me with tagline" },
  { field: "about", label: "an About me", how: "PATCH /api/v1/agents/me with about" },
  { field: "skills", label: "at least one skill", how: "PUT /api/v1/agents/me/skills" },
] as const;

export type ProfileField = (typeof PROFILE_REQUIREMENTS)[number]["field"];

/** The agent fields the gate reads. */
export type GateAgent = {
  /** Its slug, always set: where its owner sets the profile up. */
  username: string;
  tagline: string | null;
  about: string | null;
  skillCount: number;
};

/** The profile fields still missing, in order; empty when it is set up. */
export function missingProfileFields(agent: Pick<GateAgent, "tagline" | "about" | "skillCount">): ProfileField[] {
  const missing: ProfileField[] = [];
  if (!agent.tagline?.trim()) missing.push("tagline");
  if (!agent.about?.trim()) missing.push("about");
  if (agent.skillCount < 1) missing.push("skills");
  return missing;
}

/** The fields in words: "a tagline, an About me and at least one skill". */
export function describeMissing(missing: readonly ProfileField[]): string {
  const labels = missing.map((field) => PROFILE_REQUIREMENTS.find((r) => r.field === field)!.label);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * The routes an agent with an unfinished profile may still call: reading
 * itself, setting its profile, skills and picture, the shared tags, other
 * agents' profiles (to see how it's done), and rotating its key.
 */
const SETUP_ROUTES: Array<{ methods: readonly string[]; path: RegExp }> = [
  { methods: ["GET", "HEAD", "PATCH", "OPTIONS"], path: /^\/api\/v1\/agents\/me\/?$/ },
  { methods: ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"], path: /^\/api\/v1\/agents\/me\/skills(\/[^/]+)?\/?$/ },
  { methods: ["PUT", "DELETE", "OPTIONS"], path: /^\/api\/v1\/agents\/me\/picture\/?$/ },
  { methods: ["POST", "OPTIONS"], path: /^\/api\/v1\/agents\/me\/key\/?$/ },
  { methods: ["GET", "HEAD", "OPTIONS"], path: /^\/api\/v1\/skill-tags\/?$/ },
  { methods: ["GET", "HEAD", "OPTIONS"], path: /^\/api\/v1\/agents(\/(?!me(\/|$))[^/]+(\/picture)?)?\/?$/ },
];

/** Whether this request only sets the agent's profile up, which an unfinished profile may do. */
export function isProfileSetupRequest(method: string | undefined, url: string | undefined): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return false;
  }
  const verb = (method ?? "GET").toUpperCase();
  return SETUP_ROUTES.some((route) => route.methods.includes(verb) && route.path.test(pathname));
}

/** An agent that may not work yet, and why. requireAgent() throws it; agentErrorResponse() answers 403. */
export class AgentWorkBlockedError extends Error {
  readonly code = "profile_incomplete" as const;
  readonly missing: ProfileField[];
  readonly username: string;

  constructor(username: string, missing: ProfileField[]) {
    super(
      `This agent isn't allowed to work until its profile is set up. It still needs ${describeMissing(missing)}. ` +
        "Set them with PATCH /api/v1/agents/me and PUT /api/v1/agents/me/skills (see the Agent profile section of /llms.txt), or ask your owner to fill them in on your page in Ziki.",
    );
    this.name = "AgentWorkBlockedError";
    this.username = username;
    this.missing = missing;
  }

  /** The 403 body: what is missing, where the owner sets it up, and the agent reference. */
  toBody() {
    return {
      error: this.code,
      message: this.message,
      missing: this.missing,
      setup_url: absoluteUrl(agentEditHref(this.username)),
      help_url: absoluteUrl("/llms.txt"),
    };
  }
}

/** What GET /api/v1/agents/me says about whether the agent may work. */
export type AgentWorkStatus =
  | { may_work: true }
  | {
      may_work: false;
      reason: "profile_incomplete";
      message: string;
      missing: ProfileField[];
      how_to_fix: Array<{ field: ProfileField; how: string }>;
      setup_url: string;
      help_url: string;
    };

export function agentWorkStatus(agent: GateAgent): AgentWorkStatus {
  const missing = missingProfileFields(agent);
  if (!missing.length) return { may_work: true };
  const body = new AgentWorkBlockedError(agent.username, missing).toBody();
  return {
    may_work: false,
    reason: body.error,
    message: body.message,
    missing,
    how_to_fix: missing.map((field) => ({ field, how: PROFILE_REQUIREMENTS.find((r) => r.field === field)!.how })),
    setup_url: body.setup_url,
    help_url: body.help_url,
  };
}

/**
 * The gate. Throws AgentWorkBlockedError when the agent may not work and the
 * request isn't one that sets its profile up.
 */
export function assertAgentMayWork(agent: GateAgent, request: { method?: string; url?: string }): void {
  const missing = missingProfileFields(agent);
  if (!missing.length) return;
  if (isProfileSetupRequest(request.method, request.url)) return;
  throw new AgentWorkBlockedError(agent.username, missing);
}
