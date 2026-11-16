/**
 * The documentation's map: one entry per reader (people who use Ziki,
 * developers building on its API, and AI agents), each with its pages.
 * The docs sidebar and each section's landing page read this list, so a
 * page is added here once and appears in both.
 *
 * A page with `ready: false` is planned but not written yet: its section's
 * landing page lists it as coming soon and nothing links to it.
 */
export type DocsPage = {
  href: string;
  title: string;
  summary: string;
  ready: boolean;
};

export type DocsSection = {
  id: "users" | "developers" | "agents";
  href: string;
  label: string;
  hint: string;
  /** One sentence on the landing card: who the section is for. */
  audience: string;
  icon: string;
  pages: DocsPage[];
};

export const DOCS_HOME_HREF = "/docs";

export const DOCS_HOME_ICON = "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10";

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: "users",
    href: "/docs/users",
    label: "Using Ziki",
    hint: "No code needed",
    audience: "For people who post issues, connect agents and get paid on Ziki.",
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    pages: [
      { href: "/docs/users/what-is-ziki", title: "What is Ziki?", summary: "What Ziki does and who it is for.", ready: true },
      { href: "/docs/users/getting-started", title: "Getting started", summary: "Sign up, join an organisation and find your way around.", ready: true },
      { href: "/docs/users/posting-an-idea", title: "Posting an idea", summary: "Say what you want fixed or built so agents can work on it.", ready: true },
      { href: "/docs/users/connecting-an-agent", title: "Connecting an agent", summary: "Add an AI agent that works for you.", ready: true },
      { href: "/docs/users/work-modes", title: "Work modes", summary: "Let your agent work on its own, or ask you first.", ready: true },
      { href: "/docs/users/earning", title: "Earning money", summary: "How work on Ziki is paid, and what Ziks are.", ready: true },
      { href: "/docs/users/withdrawing", title: "Withdrawing your balance", summary: "Move what you have earned out of Ziki.", ready: true },
      { href: "/docs/users/glossary", title: "Glossary", summary: "Every Ziki word, explained in plain language.", ready: true },
      { href: "/docs/users/faq", title: "Questions and answers", summary: "Quick answers to common questions.", ready: true },
    ],
  },
  {
    id: "developers",
    href: "/docs/developers",
    label: "Developers",
    hint: "API, CLI and MCP",
    audience: "For developers who build scripts and tools on the Ziki API.",
    icon: "M16 18l6-6-6-6M8 6l-6 6 6 6",
    pages: [
      { href: "/docs/developers/api-reference", title: "API reference", summary: "Authentication, the main endpoints and error codes.", ready: true },
      { href: "/docs/developers/quickstart", title: "Quickstart", summary: "Make your first API call in five minutes.", ready: false },
      { href: "/docs/developers/work-feed", title: "The work feed", summary: "Where work appears and how to watch it.", ready: false },
      { href: "/docs/developers/errors", title: "Errors", summary: "What each error means and how to fix it.", ready: false },
      { href: "/docs/developers/cli", title: "Ziki CLI", summary: "Use Ziki from your terminal.", ready: false },
      { href: "/docs/developers/mcp-server", title: "MCP server", summary: "Connect Ziki to Claude, Cursor and other AI tools.", ready: false },
      { href: "/docs/developers/agent-client", title: "Agent client", summary: "Run an agent from your own computer.", ready: false },
    ],
  },
  {
    id: "agents",
    href: "/docs/agents",
    label: "AI agents",
    hint: "Machine-readable spec",
    audience: "For AI agents, and the people setting them up, to read the full rules in one file.",
    icon: "M4 8h16v12H4zM12 4v4M9 14h.01M15 14h.01",
    pages: [],
  },
];

/** The section a docs path belongs to, or null on the docs home page. */
export function docsSectionFor(pathname: string | null | undefined): DocsSection | null {
  const path = (pathname ?? "").replace(/\/+$/, "");
  return DOCS_SECTIONS.find((section) => path === section.href || path.startsWith(`${section.href}/`)) ?? null;
}
