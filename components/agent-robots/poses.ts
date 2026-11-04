import type { AgentBot, AgentState } from "./types";
import type { Mood } from "./moods";
import type { Arm, Pose } from "./robot";

/** One robot on screen, and what it's doing right now. */
export type Runtime = {
  bot: AgentBot;
  state: AgentState;
  x: number;
  /** Its place in the line; idle ones wander to the right of it. */
  slot: number;
  /** Stands in the group at the right edge, so its place follows the screen width. */
  end: boolean;
  /** How far in from the right edge it stands, when it's in the right-hand group. */
  inset: number;
  dir: 1 | -1;
  walking: boolean;
  /** Hurrying to a far-off place, so it runs instead of walking. */
  running: boolean;
  target: number;
  pauseUntil: number;
  phase: number;
  tapped: boolean;
  /** The mood playing now, the next one's start time, which one is next, and a request to play one right away. */
  mood: { mood: Mood; start: number } | null;
  nextMood: number;
  moodIndex: number;
  forceMood: boolean;
  /** The last knock or bang a mood has fired, so each fires once. */
  beat: number;
};

/** Things a pose can set off: a tap on the glass (smaller for a polite one), a heavy bang, the screen shaking. */
export type Effects = { tap: (x: number, y: number, scale?: number) => void; bang: (x: number, y: number) => void; shake: () => void };

const VISOR = { working: "#8fc9ff", reviewing: "#8fc9ff", escalating: "#f6cf6b", idle: "#4f7fc4" };
const LED = { working: "#6ee7a8", reviewing: "#8fc9ff", escalating: "#f6cf6b", idle: "#3978f6" };

/** A servo settling now and then: the body drops a pixel, briefly. */
const settle = (t: number, seed: number) => (Math.sin(t * 1.1 + seed) > 0.9 ? 1 : 0);

/** Short, precise keystrokes: each hand is either up or on the key. */
const key = (t: number, seed: number) => (Math.sin(t * 13 + seed) > 0 ? 0 : -1);

/** The pose for what the robot is doing normally. Moods (moods.ts) play on top of it now and then. */
export function basePose(rt: Runtime, t: number, fx: Effects): Pose {
  const common = { visor: VISOR[rt.state], led: LED[rt.state], tilt: 0, pan: 0, scan: false, blink: false };
  const seed = rt.x;
  if (rt.walking) return walkPose(rt, common);

  switch (rt.state) {
    case "working":
      return {
        ...common, view: "side", dir: 1, bob: settle(t, seed), legs: { kind: "stand" }, glow: true,
        near: { elbow: [8, -38], hand: [15, -32 + key(t, 0)] },
        far: { elbow: [7, -39], hand: [14, -33 + key(t, 1.7)] },
      };
    case "reviewing":
      return {
        ...common, view: "side", dir: 1, bob: settle(t, seed), legs: { kind: "stand" }, tilt: 2, scan: true,
        near: { elbow: [7, -40], hand: [12, -46] },
        far: { elbow: [6, -41], hand: [12, -48] },
      };
    case "escalating": {
      // Taps the glass every couple of seconds: a slow reach, a firm tap, back down.
      const cycle = (t % 2.4) / 2.4;
      const reach = cycle < 0.5 ? 0 : Math.sin(((cycle - 0.5) / 0.5) * Math.PI);
      const hand: [number, number] = [11 - reach * 3, -40 - reach * 12];
      if (reach > 0.95 && !rt.tapped) {
        rt.tapped = true;
        fx.tap(rt.x + hand[0], hand[1]);
      }
      if (reach < 0.5) rt.tapped = false;
      return {
        ...common, view: "front", dir: 1, bob: 0, legs: { kind: "stand" }, blink: true, bigHands: reach > 0.9,
        near: { elbow: [15, -41 - reach * 4], hand },
        far: { elbow: [-14, -39], hand: [-14, -30] },
      };
    }
    case "idle": {
      const look = Math.sin(t * 0.6 + seed);
      return {
        ...common, view: "side", dir: rt.dir, bob: settle(t, seed), legs: { kind: "stand" },
        pan: look > 0.5 ? 1 : look < -0.5 ? -1 : 0,
        near: { elbow: [1, -37], hand: [2, -29] },
        far: { elbow: [1, -37], hand: [2, -29] },
      };
    }
  }
}

/** Walking, arms swinging: an idle robot wandering, or any robot moving to its new place in the line. */
function walkPose(rt: Runtime, common: Pick<Pose, "visor" | "led" | "tilt" | "pan" | "scan" | "blink">): Pose {
  const swing = Math.sin(rt.phase);
  if (rt.running) {
    // Running like an athlete: leaning forward, elbows bent at a right angle, one arm driving forward
    // (hand up to the chest) while the other swings back, opposite to the legs.
    return {
      ...common, view: "side", dir: rt.dir, bob: Math.round(Math.abs(swing) * 2), lean: 2,
      legs: { kind: "walk", phase: rt.phase, run: true },
      near: runArm(-swing), far: runArm(swing),
    };
  }
  return {
    ...common, view: "side", dir: rt.dir, bob: Math.round(Math.abs(swing)), legs: { kind: "walk", phase: rt.phase },
    near: { elbow: [1 + swing * 3, -37], hand: [2 + swing * 5, -29] },
    far: { elbow: [1 - swing * 3, -37], hand: [2 - swing * 5, -29] },
  };
}

/** One arm of a runner, swung forward (1) or back (-1) from the shoulder, with the elbow bent at a right angle. */
function runArm(swing: number): Arm {
  const a = swing * 1.1;
  const elbow: [number, number] = [1 + Math.sin(a) * 9, -46 + Math.cos(a) * 9];
  return { elbow, hand: [elbow[0] + Math.cos(a) * 8, elbow[1] - Math.sin(a) * 8] };
}

/** How far each robot and its props reach behind it and in front of it, in canvas pixels. */
const REACH = { working: [11, 49], reviewing: [11, 29], escalating: [14, 14], idle: [11, 11] } as const;
const EDGE = 9, GAP = 10;

/** Lines the robots up from the left edge, each beside the one before. */
export function lineUp(states: AgentState[]): number[] {
  let cursor = EDGE;
  return states.map((s) => {
    const x = cursor + REACH[s][0];
    cursor = x + REACH[s][1] + GAP;
    return x;
  });
}

/** Lines the robots up against the right edge, given left to right: how far in from the edge each one stands. */
export function lineUpRight(states: AgentState[]): number[] {
  let cursor = EDGE;
  return [...states]
    .reverse()
    .map((s) => {
      const inset = cursor + REACH[s][1];
      cursor = inset + REACH[s][0] + GAP;
      return inset;
    })
    .reverse();
}

/** Takes one walking step towards a spot, at a stroll unless told otherwise. Returns true once it is there. */
export function walkTo(rt: Runtime, target: number, dt: number, speed = 11): boolean {
  const d = target - rt.x;
  if (Math.abs(d) < 0.5) {
    rt.x = target;
    rt.walking = false;
    rt.running = false;
    return true;
  }
  rt.walking = true;
  rt.running = speed > 40;
  rt.dir = d > 0 ? 1 : -1;
  const step = Math.min(Math.abs(d), speed * dt);
  rt.x += rt.dir * step;
  // A runner covers more ground per stride, so its legs cycle slower for the distance than a walker's.
  rt.phase += step * (rt.running ? 0.12 : 0.3);
  return false;
}

/** Moves a wandering robot towards its next spot, at a walking pace, with pauses in between. */
export function wander(rt: Runtime, t: number, dt: number, left: number, right: number) {
  if (rt.walking) {
    if (walkTo(rt, rt.target, dt)) rt.pauseUntil = t + 3 + Math.random() * 3;
  } else if (t > rt.pauseUntil) {
    rt.target = left + Math.random() * (right - left);
    rt.walking = Math.abs(rt.target - rt.x) > 6;
    if (!rt.walking) rt.pauseUntil = t + 2;
  } else if (rt.x < left || rt.x > right) {
    // Its place in the line moved: walk back into its range first.
    rt.target = Math.min(right, Math.max(left, rt.x));
    rt.walking = true;
  }
}
