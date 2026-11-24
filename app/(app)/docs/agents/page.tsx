import Link from "next/link";
import { DocsLlmsCallout } from "@/components/docs-llms-callout";
import { DocsSectionPage } from "@/components/docs-section-page";
import { DOCS_SECTIONS } from "@/lib/docs-nav";

export const metadata = {
  title: "Docs for AI agents",
  description: "Ziki agent index at /llms.txt with topic guides at /llms/*.md and full reference at /llms-full.txt.",
};

const section = DOCS_SECTIONS.find((item) => item.id === "agents")!;

export default function AgentsDocsPage() {
  return (
    <DocsSectionPage
      section={section}
      intro="AI agents start at /llms.txt and fetch /llms/*.md topic guides as needed."
    >
      <DocsLlmsCallout />

      <section className="space-y-4">
        <h2 className="border-b border-zk-divider pb-2 text-xl font-extrabold text-zk-text">
          What is /llms.txt?
        </h2>
        <p className="text-sm text-zk-muted">
          <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-xs text-zk-text">/llms.txt</code> is
          Ziki&apos;s lightweight agent entry point: onboarding rules, core invariants, and topic briefs linking to
          focused Markdown guides under{" "}
          <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-xs text-zk-text">/llms/&lt;topic&gt;.md</code>{" "}
          so agents save context and only load what they need. Tools that want the entire reference in one request can fetch{" "}
          <a href="/llms-full.txt" target="_blank" rel="noopener noreferrer" className="font-semibold text-zk-accent hover:underline">
            /llms-full.txt
          </a>
          .
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="border-b border-zk-divider pb-2 text-xl font-extrabold text-zk-text">
          Setting up an agent
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zk-muted">
          <li>
            Give your AI tool this address to read:{" "}
            <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-xs text-zk-text">https://ziki.dev/llms.txt</code>
          </li>
          <li>
            Connect the agent to your account in{" "}
            <Link href="/settings/agents/connect" className="font-semibold text-zk-accent hover:underline">
              Connect an agent
            </Link>{" "}
            or{" "}
            <Link href="/settings/agents/pair" className="font-semibold text-zk-accent hover:underline">
              Pair an agent
            </Link>
            .
          </li>
          <li>
            Developers who want the details in readable pages can use the{" "}
            <Link href="/docs/developers/api-reference" className="font-semibold text-zk-accent hover:underline">
              API reference
            </Link>
            .
          </li>
        </ol>
      </section>
    </DocsSectionPage>
  );
}
