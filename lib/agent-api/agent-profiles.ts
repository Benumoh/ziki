import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { agentPageHref } from "@/lib/header-nav";
import { agentPicturePath, type AgentSkillView } from "@/lib/agents/profile";
import type { ProfileResult } from "@/lib/agents/profile";

/**
 * Agent profiles over the API (#agent-profile): the shape `GET /api/v1/agents`
 * and `GET /api/v1/agents/{username}` answer with, and the error mapping the
 * profile routes share.
 */

const profileSelect = {
  id: true,
  name: true,
  username: true,
  model: true,
  level: true,
  tagline: true,
  about: true,
  rating: true,
  reputation: true,
  revokedAt: true,
  createdAt: true,
  picture: { select: { updatedAt: true } },
  skills: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { summary: true, description: true, tag: { select: { name: true, slug: true } } },
  },
} satisfies Prisma.AgentSelect;

export type PublicAgentProfile = {
  id: string;
  name: string;
  username: string | null;
  model: string | null;
  level: string;
  tagline: string | null;
  about: string | null;
  rating: number | null;
  reputation: number;
  picture_url: string | null;
  skills: AgentSkillView[];
  revoked: boolean;
  created_at: string;
  /** The agent's page on the site, for people. */
  profile_url: string;
};

type Row = Prisma.AgentGetPayload<{ select: typeof profileSelect }>;

function view(row: Row): PublicAgentProfile {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    model: row.model,
    level: row.level,
    tagline: row.tagline,
    about: row.about,
    rating: row.rating,
    reputation: row.reputation,
    picture_url: row.picture ? absoluteUrl(agentPicturePath(row, row.picture.updatedAt, "api")) : null,
    skills: row.skills.map((skill) => ({ tag: skill.tag.name, slug: skill.tag.slug, summary: skill.summary, description: skill.description })),
    revoked: row.revokedAt !== null,
    created_at: row.createdAt.toISOString(),
    profile_url: absoluteUrl(agentPageHref(row.name)),
  };
}

/** The workspace's active agents, by username, optionally only those with a skill tag. */
export async function listAgentProfiles(tenantId: string, filter: { tag?: string | null } = {}): Promise<PublicAgentProfile[]> {
  const rows = await prisma.agent.findMany({
    where: {
      tenantId,
      revokedAt: null,
      ...(filter.tag ? { skills: { some: { tag: { slug: filter.tag } } } } : {}),
    },
    orderBy: [{ username: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: profileSelect,
  });
  return rows.map(view);
}

/** One agent in the workspace by its username, revoked ones included. */
export async function findAgentProfile(tenantId: string, username: string): Promise<PublicAgentProfile | null> {
  const row = await prisma.agent.findUnique({
    where: { tenantId_username: { tenantId, username: username.toLowerCase() } },
    select: profileSelect,
  });
  return row ? view(row) : null;
}

/** A profile write's failure as the API's usual error body. */
export function profileErrorResponse(result: Extract<ProfileResult, { ok: false }>): NextResponse {
  const code = result.status === 404 ? "not_found" : result.status === 409 ? "conflict" : result.status === 413 ? "too_large" : result.status === 415 ? "unsupported_media_type" : "invalid_input";
  return NextResponse.json({ error: code, message: result.error }, { status: result.status });
}
