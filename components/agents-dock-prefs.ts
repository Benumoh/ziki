"use client";

import { useSyncExternalStore } from "react";
import { type RobotColor, faceColor, robotColor } from "@/lib/agents/dock-colors";

/*
 * The agents dock's settings (#agents-dock): whether the agents stay pinned to
 * the foot of the page, whether they close up when the cursor leaves, how each agent is drawn there (its look, and its
 * robot's colour), and which agents are hidden from it. They are per-viewer,
 * so they live in this browser.
 */

/**
 * How an agent stands in the dock: a round face (the standard look), its Ziki
 * avatar, a pixel robot, or no character at all.
 */
export type DockLook = "face" | "avatar" | "pixel" | "plain";

export const DOCK_LOOKS: { value: DockLook; label: string; hint: string }[] = [
  { value: "face", label: "Face", hint: "A round face whose eyes show what it is doing." },
  { value: "pixel", label: "Pixel robot", hint: "Acts out its status at a desk." },
  { value: "avatar", label: "Ziki avatar", hint: "The avatar you picked for it." },
  { value: "plain", label: "Plain", hint: "Its name and status only." },
];

export const DEFAULT_LOOK: DockLook = "face";

/**
 * `colors` holds a robot colour key and `faceColors` a face colour key
 * (lib/agents/dock-colors.ts) per agent; none keeps the one its id gives it.
 */
export type DockPrefs = {
  pinned: boolean;
  /** On (the default), the agents open while the cursor is on the strip and close when it leaves; off, they stay open. */
  closeOnLeave: boolean;
  looks: Record<string, DockLook>;
  colors: Record<string, string>;
  faceColors: Record<string, string>;
  hidden: string[];
};

const PREFS_KEY = "ziki-agents-dock";
const DEFAULT_PREFS: DockPrefs = { pinned: true, closeOnLeave: true, looks: {}, colors: {}, faceColors: {}, hidden: [] };
const listeners = new Set<() => void>();
let cache: DockPrefs | null = null;

const isLook = (value: unknown): value is DockLook => DOCK_LOOKS.some((look) => look.value === value);

export function readPrefs(): DockPrefs {
  if (cache) return cache;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Record<keyof DockPrefs, unknown>>;
    const looks: Record<string, DockLook> = {};
    if (saved.looks && typeof saved.looks === "object") {
      for (const [id, look] of Object.entries(saved.looks)) if (isLook(look)) looks[id] = look;
    }
    const colors: Record<string, string> = {};
    if (saved.colors && typeof saved.colors === "object") {
      for (const [id, key] of Object.entries(saved.colors)) if (typeof key === "string" && robotColor(key)) colors[id] = key;
    }
    const faceColors: Record<string, string> = {};
    if (saved.faceColors && typeof saved.faceColors === "object") {
      for (const [id, key] of Object.entries(saved.faceColors)) if (typeof key === "string" && faceColor(key)) faceColors[id] = key;
    }
    cache = {
      pinned: typeof saved.pinned === "boolean" ? saved.pinned : DEFAULT_PREFS.pinned,
      closeOnLeave: typeof saved.closeOnLeave === "boolean" ? saved.closeOnLeave : DEFAULT_PREFS.closeOnLeave,
      looks,
      colors,
      faceColors,
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    cache = DEFAULT_PREFS;
  }
  return cache;
}

export function writePrefs(change: Partial<DockPrefs>) {
  cache = { ...readPrefs(), ...change };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked: the choice holds until the page reloads.
  }
  listeners.forEach((listener) => listener());
}

/** Sets how one agent is drawn in the dock. */
export function writeLook(agentId: string, look: DockLook) {
  writePrefs({ looks: { ...readPrefs().looks, [agentId]: look } });
}

/** Sets one agent's robot colour; null gives it back its own metal. */
export function writeColor(agentId: string, key: string | null) {
  const colors = { ...readPrefs().colors };
  if (key) colors[agentId] = key;
  else delete colors[agentId];
  writePrefs({ colors });
}

/** Sets one agent's face colour; null gives it back the one its id gives it. */
export function writeFaceColor(agentId: string, key: string | null) {
  const faceColors = { ...readPrefs().faceColors };
  if (key) faceColors[agentId] = key;
  else delete faceColors[agentId];
  writePrefs({ faceColors });
}

export function faceColorKeyFor(prefs: DockPrefs, agentId: string): string | null {
  return prefs.faceColors[agentId] ?? null;
}

/** Takes one agent off the dock's floor and button (hide) or puts it back; the panel still lists it. */
export function writeHidden(agentId: string, hide: boolean) {
  const rest = readPrefs().hidden.filter((id) => id !== agentId);
  writePrefs({ hidden: hide ? [...rest, agentId] : rest });
}

export function colorFor(prefs: DockPrefs, agentId: string): RobotColor | null {
  return robotColor(prefs.colors[agentId]);
}

export function lookFor(prefs: DockPrefs, agentId: string): DockLook {
  return prefs.looks[agentId] ?? DEFAULT_LOOK;
}

export function useDockPrefs(): DockPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      // Another tab (the agents page open beside the one you're on) changes them too.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== PREFS_KEY) return;
        cache = null;
        listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    readPrefs,
    () => DEFAULT_PREFS,
  );
}
