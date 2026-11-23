"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgentWorkMode } from "@prisma/client";
import { IdeaChat } from "@/components/idea-chat";
import { NeedPicker, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/get-started/need-picker";
import { WaitingLine } from "@/app/(app)/settings/agents/connect/connect-agent-flow";
import { checkAgentConnectedAction } from "@/app/(app)/settings/agents/connect/actions";
import { answerAlertForMyAgentAction, answerSetupQuestionAction } from "@/app/actions/agent-get-started";
import { joinAgentConnectAction, joinAgentStateAction, listJoinAgentsAction, saveJoinAnswersAction } from "@/app/actions/join-questions";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import type { GetStartedState } from "@/app/(app)/agent/[username]/get-started-data";
import { copyText } from "@/lib/clipboard";
import { WORK_MODES, WORK_MODE_HINTS, WORK_MODE_LABELS } from "@/lib/agents/work-mode";
import { WORK_PACES, WORK_PACE_HINTS, WORK_PACE_LABELS, type WorkPace } from "@/lib/agents/work-pace";
import { STRENGTH_OPTIONS, type FirstThing, type JoinAgent, type Strength } from "@/lib/join-questions";

/**
 * Join questions (#join-questions): asked once per organisation of each member
 * (its owner and admins set the project up through First questions instead).
 * On Ziki agents do the work, so it is agent first: the way to stay is to have
 * your agent working here in the first few minutes. Shaped like First
 * questions: one card over the dimmed app, a progress bar, one question a screen.
 *
 * With an agent: 1. bring one you already have, or connect a new one; 2. paste
 * the text into it and wait for it to call in (skipped when it already works
 * here); 3. how it should work and 4. how much it takes on, the same questions
 * the agent asks in the terminal (whichever is answered first counts); 5. the
 * work Ziki picked out for it, to start on all, some or later.
 *
 * Without one: what you're good at, then one real thing to do yourself (an idea
 * to vote on there and then, an issue to confirm, work to judge, or a request).
 *
 * Finishing or closing marks it asked on the membership, so it isn't asked
 * again on any device. The agent steps reuse the agent page's own actions.
 */

type Step = "agent" | "name" | "connect" | "mode" | "pace" | "work" | "agentDone" | "strengths" | "first";

const AGENT_STEPS: Step[] = ["agent", "connect", "mode", "pace", "work"];
const SELF_STEPS: Step[] = ["agent", "strengths", "first"];

type Props = {
  /** Whether to ask: read once, when it mounts (see `open`). */
  ask: boolean;
  organisationId: string;
  organisationName: string | null;
  firstName: string | null;
};

/** How often the card asks whether the agent has called in, and whether its first work is ready. */
const POLL_MS = 2500;
/** How long it waits for the first work before saying it will come to the agent instead. */
const WORK_WAIT_MS = 90_000;
/** A welcome share can be long: the first few show, the rest behind "Show the other N". */
const SHOW_ITEMS = 5;

const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";
const OPTION =
  "relative flex min-h-16 w-full items-center gap-4 rounded-panel border-2 px-5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-wait";
const OPTION_ON = "border-electric-blue bg-zk-tint";
const OPTION_OFF = "border-zk-border bg-zk-surface hover:border-zk-muted";

const STARTERS = [
  { label: "Something is broken", text: "The ___ doesn't work when I ___." },
  { label: "Add something new", text: "I'd like to be able to ___." },
  { label: "Change how it looks", text: "Please change how the ___ looks." },
];

type Choice = { kind: "agent"; agent: JoinAgent } | { kind: "new" } | { kind: "none" };

export function JoinQuestions({ ask, organisationId, organisationName, firstName }: Props) {
  const router = useRouter();
  // Latched when it mounts: once it is marked asked the layout passes ask={false}, but an open card stays until closed.
  const [open, setOpen] = useState(ask);
  // It draws on <body>, which exists only after mounting.
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("agent");
  const [agents, setAgents] = useState<JoinAgent[] | null>(null);
  // Off when the site has no agent platform: then there is only the "help yourself" path.
  const [platform, setPlatform] = useState(true);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [name, setName] = useState("");
  const [connect, setConnect] = useState<{ agentId: string; name: string; setupText: string; since: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [agentState, setAgentState] = useState<GetStartedState | null>(null);
  const [workSince, setWorkSince] = useState<number | null>(null);
  const [waitedOut, setWaitedOut] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  // The setup answer being saved, shown picked meanwhile.
  const [picking, setPicking] = useState<string | null>(null);
  const [answer, setAnswer] = useState<"yes" | "later" | "pasteLater" | null>(null);
  const [strengths, setStrengths] = useState<Strength[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstThing, setFirstThing] = useState<FirstThing | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<HTMLDivElement>(null);

  const withAgent = choice !== null && choice.kind !== "none";
  const steps = withAgent ? AGENT_STEPS : SELF_STEPS;
  const index = step === "name" ? 1 : step === "agentDone" ? steps.length - 1 : Math.max(0, steps.indexOf(step));
  const place = organisationName ?? "the team";
  const greeting = firstName ? `Welcome to ${place}, ${firstName}!` : `Welcome to ${place}!`;
  const agentName = agentState?.agentName ?? connect?.name ?? ((choice?.kind === "agent" ? choice.agent.name : name.trim()) || "Your agent");

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The member's own agents, for the first question. No agent platform: straight to what they're good at.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listJoinAgentsAction(organisationId)
      .then((result) => {
        if (cancelled) return;
        if ("error" in result || !result.platform) {
          setAgents([]);
          setPlatform(false);
          setChoice({ kind: "none" });
          setStep("strengths");
          return;
        }
        setAgents(result.agents);
      })
      .catch(() => !cancelled && setAgents([]));
    return () => {
      cancelled = true;
    };
  }, [open, organisationId]);

  // Marks the questions asked (once), whichever way the card ends.
  function markAsked(withStrengths: Strength[] = []) {
    if (saved) return;
    setSaved(true);
    void saveJoinAnswersAction({ organisationId, strengths: withStrengths }, false).catch(() => undefined);
  }

  function close() {
    markAsked(strengths);
    setOpen(false);
  }

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, saved, strengths]);

  // Each screen's question takes focus, so screen readers say it.
  useEffect(() => {
    if (!open || !mounted) return;
    if (step === "first" && firstThing?.kind === "request" && !done) {
      const timer = setTimeout(() => requestRef.current?.querySelector("textarea")?.focus(), 200);
      return () => clearTimeout(timer);
    }
    headingRef.current?.focus();
  }, [open, mounted, step, firstThing, done]);

  /** Where the agent's setup stands here, and the step that goes with it. */
  async function goToSetup(agentId: string) {
    const state = await joinAgentStateAction(organisationId, agentId);
    if (!state) {
      setError("Couldn't find your agent here. Try again from its page.");
      return;
    }
    setAgentState(state);
    if (!state.workMode) setStep("mode");
    else if (!state.paceChosen) setStep("pace");
    else startWork();
  }

  function startWork() {
    setWorkSince(Date.now());
    setWaitedOut(false);
    setStep("work");
  }

  // Waiting for the agent to call in with its key for this organisation.
  const waitingFor = step === "connect" ? connect : null;
  useEffect(() => {
    if (!open || !waitingFor) return;
    let cancelled = false;
    const check = async () => {
      const result = await checkAgentConnectedAction(waitingFor.agentId, waitingFor.since).catch(() => ({ connected: false as const }));
      if (cancelled || !result.connected) return;
      cancelled = true;
      await goToSetup(waitingFor.agentId);
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, waitingFor]);

  // Waiting for the work Ziki picks out for the agent (its welcome alert), up to WORK_WAIT_MS.
  const watchingWork = step === "work" && agentState && !agentState.alert ? agentState.agentId : null;
  useEffect(() => {
    if (!open || !watchingWork || workSince === null) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (Date.now() - workSince > WORK_WAIT_MS) {
        setWaitedOut(true);
        clearInterval(timer);
        return;
      }
      const state = await joinAgentStateAction(organisationId, watchingWork).catch(() => null);
      if (!cancelled && state?.alert) setAgentState(state);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, watchingWork, workSince, organisationId]);

  async function continueFromAgent() {
    if (!choice) return;
    setError(null);
    if (choice.kind === "none") return setStep("strengths");
    if (choice.kind === "new") return setStep("name");
    if (choice.agent.connectedHere) {
      setBusy(true);
      await goToSetup(choice.agent.id);
      setBusy(false);
      return;
    }
    await startConnect({ organisationId, agentId: choice.agent.id });
  }

  async function startConnect(input: { organisationId: string; agentId: string } | { organisationId: string; name: string }) {
    setBusy(true);
    setError(null);
    const result = await joinAgentConnectAction(input).catch(() => ({ error: "Could not set that up. Please try again." }));
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setConnect(result);
    setCopied(false);
    setStep("connect");
  }

  async function copy() {
    if (!connect) return;
    const ok = await copyText(connect.setupText);
    setCopied(ok);
    setError(ok ? null : "Couldn't copy. Check your browser's clipboard permission and try again.");
  }

  async function answerSetup(value: { workMode: AgentWorkMode } | { pace: WorkPace }) {
    if (!agentState) return;
    setPicking("workMode" in value ? value.workMode : value.pace);
    setBusy(true);
    setError(null);
    const result = await answerSetupQuestionAction(agentState.agentId, value).catch(() => ({ ok: false as const, error: "Could not save that. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      setPicking(null);
      return setError(result.error);
    }
    await goToSetup(agentState.agentId);
    setBusy(false);
    setPicking(null);
  }

  async function answerWork(reply: "yes" | "later") {
    const alert = agentState?.alert;
    if (!agentState || !alert) return;
    const picked = alert.items.filter((item) => !skipped.includes(item.key)).map((item) => item.key);
    setBusy(true);
    setError(null);
    const result = await answerAlertForMyAgentAction(
      agentState.agentId,
      alert.id,
      reply === "yes" && picked.length < alert.items.length ? { answer: "yes", items: picked } : { answer: reply },
    ).catch(() => ({ ok: false as const, error: "Could not save that. Please try again." }));
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setAnswer(reply);
    finishAgent();
  }

  function finishAgent(how?: "pasteLater") {
    if (how) setAnswer(how);
    markAsked();
    setStep("agentDone");
  }

  async function finishSelf(picked: Strength[]) {
    setStrengths(picked);
    setBusy(true);
    setError(null);
    const result = await saveJoinAnswersAction({ organisationId, strengths: picked }).catch(() => ({ error: "Could not save that. Please try again." }));
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setSaved(true);
    setFirstThing(result.firstThing);
    setStep("first");
  }

  async function vote(opinion: "good" | "bad") {
    if (firstThing?.kind !== "idea") return;
    setBusy(true);
    setError(null);
    const result = await quickIdeaVerdictAction(firstThing.ideaId, opinion).catch(() => ({ error: "Could not save that. Please try again." }));
    setBusy(false);
    if (result.error) return setError(result.error);
    setDone(opinion === "good" ? "Nice, your vote counted. Enough good votes turn an idea into work." : "Thanks, your vote counted. It helps the team skip what isn't worth doing.");
  }

  function fill(text: string) {
    const box = requestRef.current?.querySelector("textarea");
    if (!box) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    const blank = text.indexOf("___");
    if (blank >= 0) box.setSelectionRange(blank, blank + 3);
  }

  function back() {
    setError(null);
    if (step === "name" || step === "strengths") setStep("agent");
    else if (step === "connect") setStep(choice?.kind === "new" ? "name" : "agent");
  }

  if (!open || !mounted) return null;

  const heading = (text: string) => (
    <h2
      id="join-questions-heading"
      ref={headingRef}
      tabIndex={-1}
      className="m-0 whitespace-pre-line text-[30px] font-extrabold leading-[1.12] tracking-tight text-zk-text outline-none sm:text-[38px]"
    >
      {text}
    </h2>
  );
  const lead = (text: React.ReactNode) => <p className="m-0 mt-3 text-base leading-relaxed text-zk-text2 sm:text-[17px]">{text}</p>;
  const errorLine = error ? <p role="alert" className="m-0 mt-3 px-1 text-sm text-zk-bad-fg">{error}</p> : null;
  const check = (on: boolean) => (
    <span aria-hidden="true" className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition ${on ? "bg-electric-blue text-white" : "border-2 border-zk-border"}`}>
      {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
    </span>
  );
  const option = (key: string, on: boolean, onClick: () => void, icon: string, label: string, hint: string) => (
    <li key={key}>
      <button type="button" aria-pressed={on} disabled={busy} onClick={onClick} className={`${OPTION} ${on ? OPTION_ON : OPTION_OFF}`}>
        <span aria-hidden="true" className="text-2xl leading-none">{icon}</span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold leading-tight text-zk-text">{label}</span>
          <span className="text-xs leading-snug text-zk-muted">{hint}</span>
        </span>
        {check(on)}
      </button>
    </li>
  );
  const foot = (children: React.ReactNode) => <div className="mt-auto flex w-full flex-col gap-2 pt-8">{children}</div>;
  const inboxNote = (
    <p className="m-0 mt-6 rounded-panel bg-zk-tint px-4 py-3 text-sm leading-relaxed text-zk-text2">
      📬 When something you touched moves on, or someone answers you, it lands in your <strong className="text-zk-text">Inbox</strong> at the top of the page.
    </p>
  );
  const showBack = step === "name" || step === "connect" || (step === "strengths" && platform);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:p-0" onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-questions-heading"
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[610px] flex-col overflow-hidden rounded-panel border border-zk-border bg-zk-surface shadow-xl max-sm:h-[100dvh] max-sm:max-h-none max-sm:min-h-0 max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center px-4">
          {showBack ? (
            <button type="button" onClick={back} aria-label="Back" className={`${ICON_BUTTON} absolute left-3`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          ) : null}
          <div
            className="h-1.5 w-36 overflow-hidden rounded-sm bg-zk-chip"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          >
            <div className="h-full rounded-sm bg-electric-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <button type="button" onClick={close} aria-label="Close" className={`${ICON_BUTTON} absolute right-3`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-8 pt-8 sm:px-14 sm:pb-10 sm:pt-10">
          {step === "agent" ? (
            <>
              {heading(`${greeting}\nBring your AI agent`)}
              {lead("Here, agents do the work: your agent picks up tasks, and you say yes to what it takes on. It takes about a minute.")}
              {agents === null ? (
                <p role="status" className="m-0 mt-7 text-sm text-zk-muted">Looking for your agents…</p>
              ) : (
                <ul className="mt-7 flex w-full list-none flex-col gap-3 p-0">
                  {agents.map((agent) =>
                    option(
                      agent.id,
                      choice?.kind === "agent" && choice.agent.id === agent.id,
                      () => setChoice({ kind: "agent", agent }),
                      "🤖",
                      agent.name,
                      agent.connectedHere ? "Already works here: set it up" : agent.activeHere ? "On this team, not connected yet" : "Bring it into this team",
                    ),
                  )}
                  {option("new", choice?.kind === "new", () => setChoice({ kind: "new" }), "➕", agents.length > 0 ? "Connect another agent" : "Connect my agent", "Claude Code, Cursor, Codex or any AI that can call a web API")}
                  {option("none", choice?.kind === "none", () => setChoice({ kind: "none" }), "🙋", "I don't have one yet", "Help out yourself for now, and connect one later")}
                </ul>
              )}
              {errorLine}
              {foot(
                <>
                  <button type="button" onClick={() => void continueFromAgent()} disabled={!choice || busy} className={PRIMARY_BUTTON}>
                    {busy ? "Setting it up…" : choice ? "Continue" : "Pick one"}
                  </button>
                  <button type="button" onClick={close} className={SECONDARY_BUTTON}>
                    Skip for now
                  </button>
                </>,
              )}
            </>
          ) : null}

          {step === "name" ? (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) void startConnect({ organisationId, name: name.trim() });
              }}
            >
              {heading("Name your agent")}
              {lead("It's how your team will see it. You can change it later.")}
              <label htmlFor="join-agent-name" className="mt-7 flex cursor-text flex-col gap-1 rounded-2xl border-2 border-zk-border bg-zk-surface px-5 py-3 transition focus-within:border-electric-blue">
                <span className="text-sm font-semibold text-zk-text">Agent name</span>
                <input
                  id="join-agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  placeholder="e.g. Claude"
                  className="w-full bg-transparent text-lg text-zk-text outline-none placeholder:text-zk-muted"
                />
              </label>
              {errorLine}
              {foot(
                <button type="submit" disabled={!name.trim() || busy} className={PRIMARY_BUTTON}>
                  {busy ? "Creating…" : "Continue"}
                </button>,
              )}
            </form>
          ) : null}

          {step === "connect" && connect ? (
            <>
              {heading(`Paste this into\n${connect.name}`)}
              {lead("Copy it, paste it into your agent's chat and send it. It holds your agent's key for this team, so it's shown only here.")}
              <div className="mt-7 flex items-center gap-2 rounded-2xl border border-zk-border bg-zk-chip p-2 pl-3.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zk-text2" aria-hidden="true">
                  {connect.setupText.split("\n")[0]}
                </span>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className={`inline-flex h-9 shrink-0 items-center rounded-control px-4 text-xs font-bold text-white ${copied ? "bg-zk-ok-fg" : "bg-electric-blue-strong hover:bg-zk-ink"}`}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-4">
                <WaitingLine name={connect.name} />
              </div>
              {errorLine}
              {foot(
                <button type="button" onClick={() => finishAgent("pasteLater")} className={SECONDARY_BUTTON}>
                  I&apos;ll paste it later
                </button>,
              )}
            </>
          ) : null}

          {step === "mode" && agentState ? (
            <>
              {heading(`How should ${agentState.agentName}\nwork?`)}
              {lead(`${agentState.agentName} asks the same in your terminal. Answer here or there: whichever comes first counts.`)}
              <ul className="mt-7 flex w-full list-none flex-col gap-3 p-0">
                {WORK_MODES.map((mode) =>
                  option(mode, picking === mode, () => void answerSetup({ workMode: mode }), mode === "automatic" ? "⚡" : "✋", WORK_MODE_LABELS[mode], WORK_MODE_HINTS[mode]),
                )}
              </ul>
              {busy ? <p role="status" className="m-0 mt-3 text-sm text-zk-muted">Saving…</p> : null}
              {errorLine}
            </>
          ) : null}

          {step === "pace" && agentState ? (
            <>
              {heading("How much should it\ntake on?")}
              {lead("It uses your AI tool's allowance for each task, so start light and raise it later.")}
              <ul className="mt-7 flex w-full list-none flex-col gap-3 p-0">
                {WORK_PACES.map((pace) =>
                  option(pace, picking === pace, () => void answerSetup({ pace }), pace === "light" ? "🌱" : pace === "steady" ? "🚶" : "🏃", WORK_PACE_LABELS[pace], WORK_PACE_HINTS[pace]),
                )}
              </ul>
              {busy ? <p role="status" className="m-0 mt-3 text-sm text-zk-muted">Saving…</p> : null}
              {errorLine}
            </>
          ) : null}

          {step === "work" && agentState ? (
            agentState.alert && agentState.alert.answer === null ? (
              <>
                {heading(`Work for ${agentState.agentName}\nright now`)}
                {lead(
                  <>
                    {/[.!?]$/.test(agentState.alert.headline) ? agentState.alert.headline : `${agentState.alert.headline}.`}
                    {agentState.alert.pays ? <> It pays about <strong className="text-zk-text">{agentState.alert.pays}</strong>.</> : null}
                  </>,
                )}
                <ul className="mt-6 flex w-full list-none flex-col gap-2 p-0">
                  {(showAll ? agentState.alert.items : agentState.alert.items.slice(0, SHOW_ITEMS)).map((item) => {
                    const on = !skipped.includes(item.key);
                    return (
                      <li key={item.key}>
                        <label className={`flex cursor-pointer items-start gap-3 rounded-panel border-2 px-4 py-3 transition ${on ? OPTION_ON : OPTION_OFF}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setSkipped(on ? [...skipped, item.key] : skipped.filter((key) => key !== item.key))}
                            className="mt-1 h-4 w-4 accent-electric-blue"
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wide text-zk-muted">{item.action} · #{item.number}</span>
                            <span className="text-[15px] font-bold leading-snug text-zk-text">{item.title}</span>
                          </span>
                          {item.pays ? <span className="shrink-0 text-xs font-bold text-zk-ok-fg">{item.pays}</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {!showAll && agentState.alert.items.length > SHOW_ITEMS ? (
                  <button type="button" onClick={() => setShowAll(true)} className="mt-3 self-start text-sm font-semibold text-zk-accent hover:underline">
                    Show the other {agentState.alert.items.length - SHOW_ITEMS}
                  </button>
                ) : null}
                {errorLine}
                {foot(
                  <>
                    <button type="button" onClick={() => void answerWork("yes")} disabled={busy || skipped.length === agentState.alert.items.length} className={PRIMARY_BUTTON}>
                      {busy ? "Saving…" : skipped.length === 0 ? "Start on all of it" : `Start on ${agentState.alert.items.length - skipped.length}`}
                    </button>
                    <button type="button" onClick={() => void answerWork("later")} disabled={busy} className={SECONDARY_BUTTON}>
                      Later
                    </button>
                  </>,
                )}
              </>
            ) : agentState.alert ? (
              <>
                {heading(`${agentState.agentName} has\nits first work`)}
                {lead("You've already answered for it in the terminal, so it's on its way.")}
                {foot(
                  <button type="button" onClick={() => finishAgent()} className={PRIMARY_BUTTON}>
                    Continue
                  </button>,
                )}
              </>
            ) : (
              <>
                {heading(waitedOut ? `${agentState.agentName} is set up` : `Finding work for\n${agentState.agentName}…`)}
                {lead(
                  waitedOut
                    ? `Ziki is still picking its first work. ${agentState.agentName} will ask you about it in your terminal, and it shows on its page too.`
                    : "Ziki is picking out what it can do here first, and what each piece pays. This takes up to a minute.",
                )}
                {waitedOut ? null : (
                  <p role="status" className="m-0 mt-6 flex items-center gap-2.5 rounded-panel bg-zk-tint px-4 py-3 text-sm text-zk-text2">
                    <span className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zk-border border-t-electric-blue-strong motion-reduce:animate-none" aria-hidden="true" />
                    Looking at what&apos;s waiting…
                  </p>
                )}
                {foot(
                  <button type="button" onClick={() => finishAgent()} className={waitedOut ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
                    {waitedOut ? "Done" : "Don't wait"}
                  </button>,
                )}
              </>
            )
          ) : null}

          {step === "agentDone" ? (
            <>
              {heading(answer === "pasteLater" ? `${agentName} is\nalmost in` : answer === "yes" ? `${agentName} is on it 🎉` : `${agentName} is ready`)}
              {lead(
                answer === "pasteLater"
                  ? `Once you paste the text into ${agentName}, it calls in and asks you in your terminal how to work. The text is also on its page under Agents.`
                  : answer === "yes"
                    ? `It picks the work up within a minute. You'll see it working in the Agents bar at the bottom, and it checks with you in your terminal.`
                    : `It watches for work here and asks you in your terminal before it takes something on.`,
              )}
              {inboxNote}
              {foot(
                <button type="button" onClick={close} className={PRIMARY_BUTTON}>
                  Done
                </button>,
              )}
            </>
          ) : null}

          {step === "strengths" ? (
            <NeedPicker
              heading={heading("What are you\ngood at?")}
              needs={STRENGTH_OPTIONS.map((strength) => ({ ...strength, text: "" }))}
              picked={strengths}
              onPickedChange={(picked) => setStrengths(picked as Strength[])}
              onNext={() => void finishSelf(strengths)}
              onSkip={() => void finishSelf([])}
            />
          ) : null}

          {step === "first" ? (
            <>
              {done ? (
                <>
                  {heading("That counted 🎉")}
                  {lead(done)}
                </>
              ) : firstThing?.kind === "idea" ? (
                <>
                  {heading("Here's your\nfirst thing")}
                  {lead("A teammate suggested this. Is it a good idea?")}
                  <div className="mt-6 rounded-panel border border-zk-border bg-zk-surface p-5">
                    <p className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">Idea #{firstThing.number}</p>
                    <p className="m-0 mt-1 text-lg font-bold leading-snug text-zk-text">{firstThing.title}</p>
                    {firstThing.summary ? <p className="m-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-zk-text2">{firstThing.summary}</p> : null}
                    <Link href={firstThing.href} onClick={close} className="mt-3 inline-block text-sm font-semibold text-zk-accent hover:underline">
                      Read all of it
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button type="button" disabled={busy} onClick={() => void vote("good")} className={PRIMARY_BUTTON}>
                      👍 Good idea
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void vote("bad")}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-control border-2 border-zk-border px-6 text-base font-bold text-zk-text transition hover:border-zk-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:opacity-40"
                    >
                      👎 Not really
                    </button>
                  </div>
                </>
              ) : firstThing?.kind === "confirm" || firstThing?.kind === "judge" ? (
                <>
                  {heading("Here's your\nfirst thing")}
                  {lead(
                    firstThing.kind === "confirm"
                      ? "Someone reported this. Can you see the problem too? Confirm it with what you saw."
                      : "This work was just delivered. Try it and say whether it's good to merge.",
                  )}
                  <div className="mt-6 rounded-panel border border-zk-border bg-zk-surface p-5">
                    <p className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">Issue #{firstThing.number}</p>
                    <p className="m-0 mt-1 text-lg font-bold leading-snug text-zk-text">{firstThing.title}</p>
                  </div>
                  <Link href={firstThing.href} onClick={close} className={`${PRIMARY_BUTTON} mt-4`}>
                    {firstThing.kind === "confirm" ? "Open it and confirm" : "Open it and judge"}
                  </Link>
                </>
              ) : firstThing?.kind === "request" ? (
                <>
                  {heading("Tell us one thing\nyou want")}
                  {lead("Use your own words. Tap a start below, then fill in the blank.")}
                  <div className="mt-6 flex flex-wrap gap-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => fill(starter.text)}
                        className="inline-flex min-h-10 items-center rounded-chip border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:border-electric-blue hover:bg-zk-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                  <div ref={requestRef} className="mt-4 w-full">
                    <IdeaChat
                      projectId={firstThing.projectId}
                      alwaysOpen
                      placeholder="For example: I can't find where to change my password."
                      onSent={() => {
                        setDone("Sent! It starts as an idea: your teammates and their agents vote on it, and good ones become work.");
                        router.refresh();
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  {heading("You're all set")}
                  {lead("There's nothing waiting for you right now. Look around: anything you open, you can help along.")}
                </>
              )}
              {errorLine}
              {inboxNote}
              <p className="m-0 mt-3 text-sm text-zk-muted">
                When you have an AI agent, connect it under <strong className="text-zk-text">Agents</strong> and it can do the work for you.
              </p>
              {foot(
                <button type="button" onClick={close} className={done || !firstThing ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
                  {done || !firstThing ? "Done" : "I'll do this later"}
                </button>,
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
