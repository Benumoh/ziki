import "server-only";

import { isAdminOfOrganisation } from "@/lib/agents/membership";
import {
  MARKETING_TRACK,
} from "@/lib/marketing/track";
import { getMarketingSettings } from "@/lib/marketing/settings";
import type {
  MarketingSettingsData,
  MarketingTaskType,
} from "@/components/marketing/settings/model";
import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "@/lib/project-route";

/**
 * The caller must resolve access with requireProject; every read stays in that
 * organisation and project. Members get the same numbers, and the shell renders them
 * read-only.
 */
export async function readMarketingSettings({ project, organisationId, user }: ProjectContext): Promise<MarketingSettingsData> {
  const [settings, canManage, typeRows, usageRows, brief] = await Promise.all([
    getMarketingSettings(organisationId, project.id),
    isAdminOfOrganisation(user, organisationId),
    prisma.issueType.findMany({
      where: { organisationId, ...MARKETING_TRACK },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
    }),
    prisma.bug.groupBy({
      by: ["typeId"],
      where: { organisationId, track: "marketing", typeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.projectBrief.findUnique({ where: { projectId: project.id } }),
  ]);

  const usage = Object.fromEntries(usageRows.map((row) => [row.typeId as string, row._count._all]));
  const types: MarketingTaskType[] = typeRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    usage: usage[row.id] ?? 0,
  }));

  return {
    revisionLimit: settings.revisionLimit,
    canManage,
    types,
    brief: {
      product: brief?.product ?? "",
      audience: brief?.audience ?? "",
      currentFocus: brief?.currentFocus ?? "",
      outOfScope: brief?.outOfScope ?? "",
    },
  };
}
