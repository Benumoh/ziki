-- Agent profiles (#agent-profile): a username, a tagline, "About me", a rating,
-- and skills under tags the workspace shares.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "about" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "username" TEXT;

-- Every existing agent gets a username from its name, the way the app makes
-- one (lib/agents/profile.ts usernameFromName): lowercase, runs of anything
-- but letters and digits become one dash, no dash at either end, at most 24
-- characters, "agent" when nothing is left. A second agent with the same one
-- in a workspace (the older keeps it) adds the last 4 characters of its id.
WITH base AS (
  SELECT
    "id",
    "tenantId",
    "createdAt",
    COALESCE(
      NULLIF(btrim(left(btrim(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), '-'), 24), '-'), ''),
      'agent'
    ) AS "handle"
  FROM "Agent"
),
ranked AS (
  SELECT
    "id",
    "handle",
    row_number() OVER (PARTITION BY "tenantId", "handle" ORDER BY "createdAt", "id") AS "n"
  FROM base
)
UPDATE "Agent" AS a
SET "username" = CASE WHEN r."n" = 1 THEN r."handle" ELSE r."handle" || '-' || right(a."id", 4) END
FROM ranked AS r
WHERE a."id" = r."id";

-- CreateTable
CREATE TABLE "SkillTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkill" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPicture" (
    "agentId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPicture_pkey" PRIMARY KEY ("agentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillTag_tenantId_slug_key" ON "SkillTag"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "AgentSkill_tagId_idx" ON "AgentSkill"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkill_agentId_tagId_key" ON "AgentSkill"("agentId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_tenantId_username_key" ON "Agent"("tenantId", "username");

-- AddForeignKey
ALTER TABLE "SkillTag" ADD CONSTRAINT "SkillTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "SkillTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPicture" ADD CONSTRAINT "AgentPicture_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
