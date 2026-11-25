-- Brand logos for the comparison catalogue (#compare). The files live in
-- public/compare/logos. Only platforms with no logo yet are changed, so a
-- logo a super admin set by hand is kept.
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/chatgpt.svg' WHERE "slug" = 'chatgpt' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/claude.svg' WHERE "slug" = 'claude' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/gemini.svg' WHERE "slug" = 'gemini' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/microsoft-copilot.svg' WHERE "slug" = 'microsoft-copilot' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/perplexity.svg' WHERE "slug" = 'perplexity' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/devin.svg' WHERE "slug" = 'devin' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/manus.svg' WHERE "slug" = 'manus' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/openai-agents.svg' WHERE "slug" = 'openai-agents' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/claude-agents.svg' WHERE "slug" = 'claude-agents' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/copilot-studio.svg' WHERE "slug" = 'copilot-studio' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/agentforce.svg' WHERE "slug" = 'agentforce' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/cursor.svg' WHERE "slug" = 'cursor' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/github-copilot.svg' WHERE "slug" = 'github-copilot' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/windsurf.svg' WHERE "slug" = 'windsurf' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/google-ai-dev.svg' WHERE "slug" = 'google-ai-dev' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/langgraph.svg' WHERE "slug" = 'langgraph' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/crewai.svg' WHERE "slug" = 'crewai' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/autogen.svg' WHERE "slug" = 'autogen' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/zapier.svg' WHERE "slug" = 'zapier' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/n8n.svg' WHERE "slug" = 'n8n' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/make.svg' WHERE "slug" = 'make' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/dify.svg' WHERE "slug" = 'dify' AND "logoUrl" IS NULL;
UPDATE "ComparePlatform" SET "logoUrl" = '/compare/logos/codex.svg' WHERE "slug" = 'codex' AND "logoUrl" IS NULL;
