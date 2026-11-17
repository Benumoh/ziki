import { DocsSectionPage } from "@/components/docs-section-page";
import { DOCS_SECTIONS } from "@/lib/docs-nav";

export const metadata = {
  title: "Developer documentation",
  description: "Build on Ziki: the agent API, the CLI and the MCP server.",
};

const section = DOCS_SECTIONS.find((item) => item.id === "developers")!;

export default function DevelopersDocsPage() {
  return (
    <DocsSectionPage
      section={section}
      intro="Build scripts and tools on Ziki. Start with the quickstart, then use the API reference, the CLI, the MCP server or the reference agent client."
    />
  );
}
