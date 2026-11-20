/**
 * Try the project chat (#project-chat) from the terminal, on a brand-new product: a project in the Fresh Start
 * fixture organisation with nothing set (no app address, marketing site or GitHub repository), talked to through the
 * real assistant and its tools.
 *
 *   pnpm chat:try                       the scripted conversation: hello, then the basics one by one
 *   pnpm chat:try "hello" "it's Acme"   your own messages, in order
 *
 * Local database only, additive: it (re)creates just its own project (`chat-try-project`, slug `chat-try`) with empty
 * basics on each run and never touches other rows. Needs ZIKI_CLAUDE_API_KEY (or ZIKI_AI_PROVIDER=openrouter with
 * OPENROUTER_API_KEY) in .env. Run `pnpm db:fixtures` first if Fresh Start doesn't exist yet.
 */
import { PrismaClient } from "@prisma/client";
import { askProjectChat, type ProjectChatContext } from "@/lib/project-chat/assistant";

const ORGANISATION_ID = "fx-organisation-fresh";
const OWNER_ID = "fx-user-fresh";
const PROJECT_ID = "chat-try-project";
const PROJECT_SLUG = "chat-try";

const SCRIPT = [
  "hello",
  "It's called Acme Notes. The app is at https://app.acmenotes.io",
  "No, the marketing site is https://acmenotes.io",
  "the code is at github.com/acme-labs/notes",
];

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing to run against a non-local database (${host}).`);
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const organisation = await prisma.organisation.findUnique({ where: { id: ORGANISATION_ID }, select: { id: true } });
    if (!organisation) throw new Error("The Fresh Start organisation isn't here: run pnpm db:fixtures first.");
    // A brand-new product: nothing set but a placeholder name.
    const fresh = { name: "New product", siteUrl: null, marketingUrl: null, repoUrl: null };
    await prisma.project.upsert({
      where: { id: PROJECT_ID },
      create: { id: PROJECT_ID, organisationId: ORGANISATION_ID, slug: PROJECT_SLUG, ...fresh },
      update: fresh,
    });

    const messages = process.argv.slice(2).length ? process.argv.slice(2) : SCRIPT;
    const context: ProjectChatContext = { organisationId: ORGANISATION_ID, projectId: PROJECT_ID, userId: OWNER_ID, canEdit: true, project: { ...fresh } };
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (const message of messages) {
      turns.push({ role: "user", text: message });
      console.log(`\nYou:  ${message}`);
      const answer = await askProjectChat(turns, context);
      if (!answer.ok) {
        console.log(`Ziki (error): ${answer.error}`);
        break;
      }
      turns.push({ role: "assistant", text: answer.reply });
      for (const line of answer.activity) console.log(`      [tool] ${line}`);
      if (answer.idea) console.log(`      [idea to file] ${answer.idea}`);
      console.log(`Ziki: ${answer.reply.replace(/\n/g, "\n      ")}`);
    }

    const saved = await prisma.project.findUnique({ where: { id: PROJECT_ID }, select: { name: true, siteUrl: true, marketingUrl: true, repoUrl: true } });
    console.log("\nSaved on the project:", saved);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
