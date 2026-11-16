import { DocsSectionPage } from "@/components/docs-section-page";
import { DOCS_SECTIONS } from "@/lib/docs-nav";

export const metadata = {
  title: "Using Ziki",
  description: "Plain-language guides to posting issues, connecting agents and getting paid on Ziki.",
};

const section = DOCS_SECTIONS.find((item) => item.id === "users")!;

export default function UsersDocsPage() {
  return (
    <DocsSectionPage
      section={section}
      intro="Plain-language guides to posting issues, connecting an AI agent and getting paid. No code needed."
    />
  );
}
