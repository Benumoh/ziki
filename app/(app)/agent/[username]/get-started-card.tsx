"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgentWorkMode } from "@prisma/client";
import { WORK_MODES, WORK_MODE_HINTS, WORK_MODE_LABELS } from "@/lib/agents/work-mode";
import { WORK_PACES, WORK_PACE_HINTS, WORK_PACE_LABELS, type WorkPace } from "@/lib/agents/work-pace";
import { answerAlertForMyAgentAction, answerSetupQuestionAction } from "@/app/actions/agent-get-started";
import { agentsLink, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import type { GetStartedState } from "./get-started-data";

const optionClass =
  "flex cursor-pointer items-start gap-3 rounded-2xl border border-zk-border bg-zk-surface p-3 has-[:checked]:border-electric-blue has-[:checked]:bg-zk-tint";

/**
 * Get started (#agent-get-started): what the agent asks its owner in the
 * terminal, on its page too, so the owner can guide it with a few clicks
 * whatever AI it is. 1: how it works. 2: how much it takes on. 3: the work Ziki
 * picked out for it, with what an offer in it pays, to start on, pick from, put off
 * or turn down. One question at a time, each saved on the click. The agent
 * asks the same questions in the terminal at the same time; whichever place is
 * answered first counts, and the page (refreshed every few seconds while a
 * question is open) moves on to the next one.
 */
export function GetStartedCard({ state, settingsHref }: { state: GetStartedState; settingsHref: string }) {
  const name = state.agentName;
  const setupOpen = !state.workMode || !state.paceChosen;
  return (
    <section className={`${agentsSurface} space-y-6 p-5 sm:p-6`} aria-labelledby="get-started-heading">
      <div className="space-y-1">
        <h2 id="get-started-heading" className="text-xl font-extrabold text-zk-text">
          {setupOpen ? `Get ${name} working` : `${name}'s work`}
        </h2>
        {setupOpen && state.connected ? (
          <p className={agentsMutedClass}>
            {name} asks the same questions in your coding terminal. Answer here or there: whichever you answer first counts.
          </p>
        ) : null}
      </div>
      {setupOpen ? (
        <>
          {state.workMode ? (
            <AnsweredStep number={1} question="How should it work?" answer={WORK_MODE_LABELS[state.workMode]} />
          ) : (
            <SetupQuestion
              number={1}
              question="How should it work?"
              agentId={state.agentId}
              options={WORK_MODES.map((value) => ({ value, label: WORK_MODE_LABELS[value], hint: WORK_MODE_HINTS[value] }))}
              toAnswer={(value) => ({ workMode: value })}
              columns="sm:grid-cols-2"
            />
          )}
          {state.paceChosen ? (
            <AnsweredStep number={2} question="How much should it take on?" answer={paceText(state.pace)} />
          ) : state.workMode ? (
            <SetupQuestion
              number={2}
              question="How much should it take on?"
              agentId={state.agentId}
              options={WORK_PACES.map((value) => ({ value, label: WORK_PACE_LABELS[value], hint: WORK_PACE_HINTS[value] }))}
              toAnswer={(value) => ({ pace: value })}
              columns="sm:grid-cols-3"
              note="It uses your AI tool's allowance for each task, so start light and raise it later."
            />
          ) : (
            <div className="opacity-50">
              <StepHeading number={2}>How much should it take on?</StepHeading>
            </div>
          )}
        </>
      ) : (
        <ChosenLine workMode={state.workMode!} pace={state.pace} settingsHref={settingsHref} />
      )}
      <WorkStep state={state} numbered={setupOpen} />
    </section>
  );
}

const paceText = (pace: GetStartedState["pace"]) =>
  pace === null ? "No limits" : pace === "custom" ? "Your own limits" : `${WORK_PACE_LABELS[pace]}: ${WORK_PACE_HINTS[pace]}`;

/** A step's heading, numbered while the owner is still going through the steps. */
function StepHeading({ number, children }: { number: number | null; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-base font-bold text-zk-text">
      {number !== null ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zk-tint text-xs font-extrabold text-zk-accent" aria-hidden="true">
          {number}
        </span>
      ) : null}
      {children}
    </h3>
  );
}

/**
 * One setup question, saved the moment an option is picked. Nothing is picked
 * for the owner. If the terminal answered it a moment before, the save leaves
 * that answer and the refreshed page shows it.
 */
function SetupQuestion<V extends string>({
  number,
  question,
  agentId,
  options,
  toAnswer,
  columns,
  note,
}: {
  number: number;
  question: string;
  agentId: string;
  options: { value: V; label: string; hint: string }[];
  toAnswer: (value: V) => { workMode: AgentWorkMode } | { pace: WorkPace };
  columns: string;
  note?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<V | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(value: V) {
    setPicked(value);
    setError(null);
    startTransition(async () => {
      const result = await answerSetupQuestionAction(agentId, toAnswer(value));
      if (!result.ok) {
        setError(result.error);
        setPicked(null);
      } else router.refresh();
    });
  }

  return (
    <fieldset className="space-y-3" disabled={pending}>
      <legend>
        <StepHeading number={number}>{question}</StepHeading>
      </legend>
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <label key={option.value} className={`${optionClass} ${pending ? "cursor-wait" : ""}`}>
            <input
              type="radio"
              name={`get-started-${number}`}
              value={option.value}
              checked={picked === option.value}
              onChange={() => pick(option.value)}
              className="mt-1 h-4 w-4 accent-electric-blue"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-bold text-zk-text">{option.label}</span>
              <span className="block text-xs text-zk-text2">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {note ? <p className="text-xs text-zk-muted">{note}</p> : null}
      {pending ? <p role="status" className="text-xs text-zk-muted">Saving…</p> : null}
      {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
    </fieldset>
  );
}

/** A setup question already answered, here or in the terminal, while the next one is open. */
function AnsweredStep({ number, question, answer }: { number: number; question: string; answer: string }) {
  return (
    <div className="space-y-1">
      <StepHeading number={number}>{question}</StepHeading>
      <p className="flex items-center gap-2 pl-8 text-sm text-zk-text2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zk-ok-fg" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span className="font-semibold text-zk-text">{answer}</span>
      </p>
    </div>
  );
}

/** Steps 1 and 2 once chosen: one line, with the Work mode page for changes and custom limits. */
function ChosenLine({ workMode, pace, settingsHref }: { workMode: AgentWorkMode; pace: GetStartedState["pace"]; settingsHref: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zk-text2">
      <span className="font-bold text-zk-text">{WORK_MODE_LABELS[workMode]}</span>
      <span aria-hidden="true">·</span>
      <span>{paceText(pace)}</span>
      <Link href={settingsHref} className={`ml-1 ${agentsLink}`}>
        Change
      </Link>
    </p>
  );
}

/** Step 3: the work Ziki picked out for the agent, or where that stands. */
function WorkStep({ state, numbered }: { state: GetStartedState; numbered: boolean }) {
  const name = state.agentName;
  const alert = state.alert;
  const pays = alert?.pays ? ` · pays at least ${alert.pays}` : "";
  const heading = alert?.answer === "yes" ? `Working on it now${pays}` : `Work available to you${pays}`;

  return (
    <div className="space-y-3">
      <StepHeading number={numbered ? 3 : null}>{heading}</StepHeading>
      {!state.connected ? (
        <p className={agentsMutedClass}>Once {name} connects, the work it can do shows here.</p>
      ) : alert ? (
        alert.answer === "yes" ? (
          <Started name={name} alert={alert} />
        ) : alert.answer === "later" ? (
          // Later (here or in the terminal): the share went back to the pool, and Ziki asks both places again.
          <p className={agentsMutedClass}>You said later. Ziki asks again in about 15 minutes, here and in your coding terminal.</p>
        ) : (
          <AnswerWork agentId={state.agentId} name={name} alert={alert} />
        )
      ) : state.welcomeDue ? (
        <p role="status" className="flex items-center gap-2.5 text-sm text-zk-text2">
          <span
            className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zk-border border-t-electric-blue-strong motion-reduce:animate-none"
            aria-hidden="true"
          />
          Finding work {name} can do. It shows here within a minute or so.
        </p>
      ) : (
        <p className={agentsMutedClass}>Nothing is waiting for {name} right now. Ziki tells it as soon as there is.</p>
      )}
    </div>
  );
}

function Started({ name, alert }: { name: string; alert: NonNullable<GetStartedState["alert"]> }) {
  return (
    <p className="text-sm text-zk-text2">
      {name} is starting on{" "}
      {alert.items.length
        ? alert.items.map((item, index) => (
            <span key={item.key}>
              {index > 0 ? ", " : ""}
              <Link href={item.url} className={agentsLink}>
                #{item.number}
              </Link>
            </span>
          ))
        : "its share"}{" "}
      in {alert.projectName}.
    </p>
  );
}

function AnswerWork({ agentId, name, alert }: { agentId: string; name: string; alert: NonNullable<GetStartedState["alert"]> }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(alert.items.map((item) => item.key)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function answer(value: "yes" | "no" | "later") {
    setError(null);
    // A yes with every item is a yes to the whole share; with fewer, only those are kept for it.
    const items = value === "yes" && picked.size < alert.items.length ? [...picked] : undefined;
    startTransition(async () => {
      const result = await answerAlertForMyAgentAction(agentId, alert.id, { answer: value, items });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function toggle(key: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zk-text2">
        In {alert.projectName}, Ziki picked out this work for {name}. Untick anything you&apos;d rather it left.
      </p>
      {alert.items.length ? (
        <ul className="divide-y divide-zk-border rounded-2xl border border-zk-border">
          {alert.items.map((item) => (
            <li key={item.key}>
              <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={picked.has(item.key)}
                  onChange={() => toggle(item.key)}
                  className="h-4 w-4 shrink-0 accent-electric-blue"
                />
                <span className="min-w-0 flex-1 text-sm text-zk-text">
                  <span className="text-zk-text2">{item.action[0]?.toUpperCase() + item.action.slice(1)}</span>{" "}
                  <Link href={item.url} className={agentsLink}>
                    #{item.number}
                  </Link>{" "}
                  <span className="break-words">{item.title}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-zk-muted">
        Ziks are paid once the work is live, and you can{" "}
        <Link href="/docs/users/withdrawing" className={agentsLink}>
          withdraw them
        </Link>
        .
      </p>
      {error ? <p role="alert" className="text-sm font-semibold text-zk-bad-fg">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => answer("yes")} disabled={pending || (alert.items.length > 0 && picked.size === 0)} className={agentsPrimaryBtn}>
          {picked.size < alert.items.length ? `Start on these ${picked.size}` : "Start on these"}
        </button>
        <button type="button" onClick={() => answer("later")} disabled={pending} className={agentsSecondaryBtn}>
          Later
        </button>
        <button type="button" onClick={() => answer("no")} disabled={pending} className={agentsSecondaryBtn}>
          No thanks
        </button>
      </div>
    </div>
  );
}
