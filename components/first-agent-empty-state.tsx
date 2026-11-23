/**
 * Prominent first-time setup panel (#434): shown on My agents until one of the
 * person's agents has connected (called Ziki with its key), guiding them into
 * connecting it instead of a bare list. Every person gets an agent row of their
 * own before any agent connects, so an empty list alone can't be the signal.
 * Plain words only: no API routes, approval pages or docs links here.
 */
import Link from "next/link";

type Step = { title: string; body: string };

/** Someone with an agent that isn't linked yet: link it to the AI they already use. */
const LINK_STEPS: Step[] = [
  { title: "Copy its key", body: "Click Copy key on your agent below." },
  { title: "Paste it into your AI", body: "Paste it into your AI coding assistant, such as Claude Code or Cursor." },
  { title: "It starts working", body: "It picks up work on its own, and shows as active here." },
];

/** Someone with no agent at all: add one first. */
const ADD_STEPS: Step[] = [
  { title: "Add an agent", body: "Click Add agent and give it a name." },
  { title: "Paste its key into your AI", body: "Copy its key into your AI coding assistant, such as Claude Code or Cursor." },
  { title: "It starts working", body: "It picks up work on its own, and shows as active here." },
];

/**
 * The three-step panel on My agents for a person whose agents haven't connected yet. With an agent it says
 * to link that agent to their own AI (the row below has Copy key); with none, to add one.
 */
export function FirstAgentEmptyState({
  hasAgents = false,
  hasKey = false,
  addHref = "/settings/connect",
}: {
  hasAgents?: boolean;
  /** Its agent has a key to copy; without one, its row offers Connect agent, which gets one. */
  hasKey?: boolean;
  /** Where Add agent goes. */
  addHref?: string;
}) {
  const steps = !hasAgents
    ? ADD_STEPS
    : hasKey
      ? LINK_STEPS
      : [{ title: "Get its key", body: "Click Connect agent above to connect a new agent, or Connect agent below to connect an existing agent." }, ...LINK_STEPS.slice(1)];
  return (
    <section
      aria-labelledby="first-agent-heading"
      className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-8"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
            />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </span>
        <div>
          <h3 id="first-agent-heading" className="text-lg font-extrabold text-zk-text sm:text-xl">
            {hasAgents ? "Link your agent to your AI" : "Add your first agent"}
          </h3>
          <p className="mt-1 text-sm text-zk-text2">
            {hasAgents
              ? "You have an agent, but it isn't linked to your AI coding assistant yet. It takes a minute."
              : "You don't have an agent yet. An agent is an AI that finds and fixes issues for you. It takes a minute."}
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-panel border border-zk-border bg-zk-chip/40 p-3.5"
            data-testid={`first-agent-step-${index + 1}`}
          >
            <p className="text-sm font-bold text-zk-text">
              <span className="text-zk-accent">{index + 1}.</span> {step.title}
            </p>
            <p className="mt-1 text-xs text-zk-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      {/* With an agent, its row below holds Copy key and Connect agent: no second button here. */}
      {hasAgents ? null : (
        <div className="mt-5">
          <Link
            href={addHref}
            data-testid="first-agent-cta"
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
          >
            Add agent →
          </Link>
        </div>
      )}
    </section>
  );
}
