"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentFace } from "@/components/agent-face";
import { AgentPortrait } from "@/components/agent-portrait";
import { StatusKey } from "@/components/agents-dock";
import { DOCK_LOOKS, type DockLook, colorFor, faceColorKeyFor, lookFor, useDockPrefs, writeColor, writeFaceColor, writeLook } from "@/components/agents-dock-prefs";
import { AGENT_AVATARS } from "@/lib/agents/avatars";
import { FACE_COLORS, ROBOT_COLORS, robotColor } from "@/lib/agents/dock-colors";
import { useToast } from "@/components/ui/toast";
import { agentsMutedClass, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";
import { setAgentAvatarAction } from "./actions";

const OPTIONS: { key: string | null; label: string }[] = [
  { key: null, label: "Automatic" },
  ...AGENT_AVATARS.map(({ key, label }) => ({ key, label })),
];

const FACE_OPTIONS: { key: string | null; label: string }[] = [
  { key: null, label: "Automatic" },
  ...FACE_COLORS.map(({ key, label }) => ({ key, label })),
];

const ROBOT_OPTIONS: { key: string | null; label: string }[] = [
  { key: null, label: "Automatic" },
  ...ROBOT_COLORS.map(({ key, label }) => ({ key, label })),
];

/** The face first, as the standard look; then the Ziki avatar; then the rest. */
const TAB_ORDER: DockLook[] = ["face", "avatar", "pixel", "plain"];
const TABS = [...DOCK_LOOKS].sort((a, b) => TAB_ORDER.indexOf(a.value) - TAB_ORDER.indexOf(b.value));

/** What each look's tab says it changes. */
const LOOK_NOTE: Record<DockLook, (name: string) => string> = {
  face: () => "A round face in the agents dock, in this colour. Kept in this browser.",
  avatar: (name) => `It shows wherever ${name} does.`,
  pixel: () => "A pixel robot in the agents dock. Kept in this browser.",
  plain: () => "Just its name and status in the dock. Kept in this browser.",
};

/**
 * The agent's picture on its page, with a pencil badge; clicking it opens a
 * pop-up to choose how it looks. In the agents dock (#agents-dock) it is a round face by default, in
 * one of the face colours; or its Ziki avatar ("Automatic" is the one drawn
 * from the agent's id), which saves to the agent and shows wherever it does; or
 * a pixel robot in one of the robot colours; or plain, with no character. A pick
 * saves at once and closes the pop-up.
 */
export function AgentAvatarPicker({
  agentId,
  agentName,
  avatar,
  size = 72,
}: {
  agentId: string;
  agentName: string;
  avatar: string | null;
  size?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const prefs = useDockPrefs();
  const look = lookFor(prefs, agentId);
  const color = colorFor(prefs, agentId);
  const faceKey = faceColorKeyFor(prefs, agentId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DockLook>(look);
  const [current, setCurrent] = useState<string | null>(avatar);
  const [pending, startTransition] = useTransition();

  // showModal() gives the focus trap, inert background and Escape handling.
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  function openPicker() {
    setTab(look);
    setOpen(true);
  }

  function pickAvatar(next: string | null) {
    writeLook(agentId, "avatar");
    setOpen(false);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setAgentAvatarAction(agentId, next);
      if (!result.ok) {
        setCurrent(previous);
        toast(result.error, "error");
        return;
      }
      router.refresh();
    });
  }

  function pickFace(next: string | null) {
    writeLook(agentId, "face");
    writeFaceColor(agentId, next);
    setOpen(false);
  }

  function pickRobot(next: string | null) {
    writeLook(agentId, "pixel");
    writeColor(agentId, next);
    setOpen(false);
  }

  function pickPlain() {
    writeLook(agentId, "plain");
    setOpen(false);
  }

  const tile = (on: boolean) =>
    `group flex flex-col items-center gap-1.5 rounded-2xl p-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
      on ? "bg-zk-tint text-zk-accent ring-2 ring-electric-blue-strong" : "text-zk-text2 hover:bg-zk-chip"
    }`;

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <button
        type="button"
        onClick={openPicker}
        disabled={pending}
        aria-haspopup="dialog"
        aria-label={`Change how ${agentName} looks`}
        title="Change how it looks"
        className="group relative shrink-0 rounded-full transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-wait motion-reduce:hover:scale-100"
      >
        <AgentPortrait look={look} agentId={agentId} agentName={agentName} avatar={current} color={color} faceKey={faceKey} size={size} />
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-zk-surface bg-electric-blue-strong text-white"
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="avatar-picker-title"
          // Escape reaches us as `cancel`.
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[20px] border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/50"
        >
          <h2 id="avatar-picker-title" className="text-lg font-extrabold">
            How {agentName} looks
          </h2>
          <p className={`mt-1 ${agentsMutedClass}`}>Pick a look for it in the agents bar at the foot of your pages.</p>

          <div role="tablist" aria-label="Look" className="mt-4 flex w-fit max-w-full gap-0.5 rounded-full bg-zk-seg p-1">
            {TABS.map((option) => {
              const on = option.value === tab;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  id={`avatar-picker-tab-${option.value}`}
                  aria-selected={on}
                  aria-controls={`avatar-picker-${option.value}`}
                  onClick={() => setTab(option.value)}
                  className={`inline-flex min-h-8 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                    on ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]" : "font-medium text-zk-text2 hover:text-zk-text"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {/* All the panels share one grid cell, so the pop-up keeps one size whichever tab is open. */}
          <div className="grid">
            {TABS.map(({ value }) => (
              <div
                key={value}
                id={`avatar-picker-${value}`}
                role="tabpanel"
                aria-labelledby={`avatar-picker-tab-${value}`}
                inert={value !== tab}
                className={`col-start-1 row-start-1 ${value === tab ? "" : "invisible"}`}
              >
                <p className={`mt-2 ${agentsMutedClass}`}>{LOOK_NOTE[value](agentName)}</p>
                {value === "face" ? (
                  <div role="radiogroup" aria-label="Face colour" className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                    {FACE_OPTIONS.map((option) => {
                      const on = look === "face" && option.key === faceKey;
                      return (
                        <button key={option.key ?? "automatic"} type="button" role="radio" aria-checked={on} onClick={() => pickFace(option.key)} className={tile(on)}>
                          <AgentFace agentId={agentId} colorKey={option.key} status="idle" size={56} still />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : value === "avatar" ? (
                  <div role="radiogroup" aria-label="Avatar" className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                    {OPTIONS.map((option) => {
                      const on = look === "avatar" && option.key === current;
                      return (
                        <button key={option.key ?? "automatic"} type="button" role="radio" aria-checked={on} onClick={() => pickAvatar(option.key)} className={tile(on)}>
                          <AgentAvatar agentId={agentId} avatar={option.key} size={56} />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : value === "pixel" ? (
                  <div role="radiogroup" aria-label="Robot colour" className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                    {ROBOT_OPTIONS.map((option) => {
                      const on = look === "pixel" && option.key === (color?.key ?? null);
                      return (
                        <button key={option.key ?? "automatic"} type="button" role="radio" aria-checked={on} onClick={() => pickRobot(option.key)} className={tile(on)}>
                          <AgentPortrait look="pixel" agentId={agentId} agentName={agentName} avatar={null} color={robotColor(option.key)} size={56} />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 flex items-start gap-4">
                    <div role="radiogroup" aria-label="Plain" className="shrink-0">
                      <button type="button" role="radio" aria-checked={look === "plain"} onClick={pickPlain} className={tile(look === "plain")}>
                        <AgentPortrait look="plain" agentId={agentId} agentName={agentName} avatar={null} size={56} />
                        Plain
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="m-0 text-sm font-bold text-zk-text">What each light means</h3>
                      <div className="mt-2">
                        <StatusKey />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className={agentsSecondaryBtn}>
              Cancel
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
