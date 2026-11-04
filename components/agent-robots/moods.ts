import type { AgentState } from "./types";
import type { Painter } from "./painter";
import type { Effects, Runtime } from "./poses";
import type { Arm, Point, Pose } from "./robot";

/** What a mood knows while it plays: how far through it is (u, 0 to 1), its own clock, and the robot's normal pose. */
export type MoodCtx = { rt: Runtime; u: number; t: number; base: Pose; fx: Effects };

/** A few seconds of personality on top of what a robot is doing, like a yawn or a stamp of approval. */
export type Mood = {
  label: string;
  seconds: number;
  pose: (m: MoodCtx) => Pose;
  /** Drawn after the robot, in front of it: a mug, a stamp, steam. */
  props?: (p: Painter, m: MoodCtx, pose: Pose) => void;
  /** Reviewing only: where the sheet in its hands goes (moved from normal), or null while it isn't holding it. */
  sheet?: (u: number) => Point | null;
  /** Reviewing only: the printer stops feeding paper. */
  jammed?: (u: number) => boolean;
};

// Timing helpers. u runs from 0 to 1 over a mood.
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const seg = (u: number, a: number, b: number) => clamp((u - a) / (b - a));
const smooth = (v: number) => v * v * (3 - 2 * v);
/** Eases from 0 to 1 between a and b, holds, and eases back to 0 between c and d. */
const hold = (u: number, a: number, b: number, c: number, d: number) => smooth(Math.min(seg(u, a, b), 1 - seg(u, c, d)));
const mix = (a: Point, b: Point, k: number): Point => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const arm = (elbow: Point, hand: Point): Arm => ({ elbow, hand });
const mixArm = (a: Arm, b: Arm, k: number): Arm => ({ elbow: mix(a.elbow, b.elbow, k), hand: mix(a.hand, b.hand, k) });
/** True the first time it's called for beat i, so an effect fires once per knock or bang. */
function once(rt: Runtime, i: number) {
  if (rt.beat === i) return false;
  rt.beat = i;
  return true;
}

/** Arms hanging at its sides: side view, then the front view's right and left. */
const DOWN = arm([1, -37], [2, -29]);
const FRONT_NEAR = arm([14, -39], [14, -30]);
const FRONT_FAR = arm([-14, -39], [-14, -30]);

const side = (m: MoodCtx, over: Partial<Pose>): Pose => ({ ...m.base, view: "side", legs: { kind: "stand" }, bigHands: false, ...over });
const front = (m: MoodCtx, over: Partial<Pose>): Pose => ({
  ...m.base, view: "front", dir: 1, legs: { kind: "stand" }, bob: 0, tilt: 0, pan: 0, near: FRONT_NEAR, far: FRONT_FAR, bigHands: false, ...over,
});
/** Legs to match how far the body has dropped: standing, on the way down, then on the floor. */
const lowered = (drop: number): Pose["legs"] => ({ kind: drop > 18 ? "sit" : drop > 3 ? "kneel" : "stand" });

/** A short label in the robot's own space, like a sign or a "z". */
function text(p: Painter, s: string, dx: number, dy: number, color: string, size = 6) {
  p.ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
  p.ctx.textAlign = "center";
  p.ctx.textBaseline = "top";
  p.ctx.fillStyle = color;
  p.ctx.fillText(s, p.sx(dx), p.floor + dy);
}

const hand = (a: Arm, pose: Pose): Point => [Math.round(a.hand[0]), Math.round(a.hand[1] + pose.bob)];

/** A tick of a check mark, pixel by pixel, from its bottom-left. */
function check(p: Painter, x: number, y: number, color: string) {
  for (const [dx, dy] of [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0], [5, -1], [6, -2]]) p.rect(x + dx, y + dy, 1, 1, color);
}

/** An X the same size as the tick, from its top-left. */
function cross(p: Painter, x: number, y: number, color: string) {
  for (let i = 0; i < 6; i++) {
    p.rect(x + i, y + i, 1, 1, color);
    p.rect(x + 5 - i, y + i, 1, 1, color);
  }
}

// ---- Working: at the desk, typing. ----

const WORKING: Mood[] = [
  {
    label: "Tired: sits down and wipes its brow",
    seconds: 7,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      const drop = Math.round(26 * k);
      const wiping = m.u > 0.25 && m.u < 0.8;
      const wipe = arm([10, -52], [3 + Math.sin(m.t * 5) * 6, -61]);
      const red = m.u > 0.08 && m.u < 0.9;
      return side(m, {
        bob: drop, legs: lowered(drop), tilt: k > 0.5 ? 1 : 0, glow: false,
        visor: red ? "#ff6b6b" : m.base.visor, led: red ? "#ff6b6b" : m.base.led,
        near: mixArm(m.base.near, wiping ? wipe : arm([4, -38], [8, -33]), k),
        far: mixArm(m.base.far, arm([3, -38], [7, -33]), k),
      });
    },
    props: (p, m, pose) => {
      if (m.u > 0.08 && m.u < 0.9) {
        // The monitor goes red with an X, like the green tick when tests pass.
        p.rect(24, -56, 23, 19, "#3a1014");
        for (let i = 0; i < 4; i++) p.rect(26, -54 + i * 3, 6 + ((i * 7) % 9), 1, "#ff6b6b");
        cross(p, 37, -47, "#ffc2c2");
      }
      if (m.u < 0.25 || m.u > 0.8) return;
      // A bead of sweat running down the side of its head.
      p.rect(-9, -60 + pose.bob + Math.floor((m.t * 14) % 9), 1, 2, "#8fc9ff");
    },
  },
  {
    label: "Overheating: the fan vents heat",
    seconds: 5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.1, 0.85, 1);
      return side(m, {
        near: mixArm(m.base.near, arm([5, -38], [9, -34]), k),
        far: mixArm(m.base.far, arm([4, -39], [8, -35]), k),
        visor: k > 0.5 ? "#ff9a5a" : m.base.visor, led: k > 0.5 ? "#ff6b5a" : m.base.led, blink: k > 0.5,
        bob: k > 0.5 && Math.sin(m.t * 30) > 0.6 ? 1 : 0, glow: false,
      });
    },
    props: (p, m, pose) => {
      const k = hold(m.u, 0, 0.1, 0.85, 1);
      if (k < 0.3) return;
      // Vents glowing on the power pack, and heat rising off it.
      for (let i = 0; i < 3; i++) p.rect(-13, -44 + pose.bob + i * 3, 3, 1, Math.sin(m.t * 12 + i) > 0 ? "#ff8a4f" : "#c2410c");
      for (let i = 0; i < 10; i++) {
        const f = (m.t * 0.9 + i / 10) % 1;
        const a = ((1 - f) * k).toFixed(2);
        p.rect(Math.round(-15 - (i % 3) * 2 + Math.sin(f * 8 + i) * 2), Math.round(-46 - f * 26 + pose.bob), 2, 2,
          f < 0.4 ? `rgba(255,150,90,${a})` : `rgba(190,200,215,${a})`);
      }
    },
  },
  {
    label: "Stiff: rolls its neck and shoulders",
    seconds: 4,
    pose: (m) => {
      const k = hold(m.u, 0, 0.12, 0.88, 1);
      const th = m.t * Math.PI * 1.8;
      const shoulder = (o: number): Point => [8 + 2 * Math.cos(th + o), -38 - 4 * Math.max(0, Math.sin(th + o))];
      return side(m, {
        near: mixArm(m.base.near, arm(shoulder(0), [14, -33]), k),
        far: mixArm(m.base.far, arm(shoulder(Math.PI), [13, -34]), k),
        tilt: Math.round(k * (2 + 2.5 * Math.sin(th))), pan: Math.round(k * 2 * Math.cos(th)), lean: -Math.round(k * Math.max(0, Math.sin(th))),
      });
    },
  },
  {
    label: "Break: a sip from its mug of oil",
    seconds: 6,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      const sip = hold(m.u, 0.3, 0.42, 0.62, 0.72);
      const holding = mixArm(arm([6, -40], [16, -34]), arm([5, -50], [10, -58]), sip);
      return side(m, { far: mixArm(m.base.far, holding, k), tilt: sip > 0.5 ? -1 : 0 });
    },
    props: (p, m, pose) => {
      if (hold(m.u, 0, 0.15, 0.85, 1) < 0.05) return;
      const [x, y] = hand(pose.far, pose);
      p.rect(x - 1, y - 3, 5, 6, "#e8eef9");
      p.rect(x - 1, y - 3, 5, 1, "#1a1206");
      p.rect(x - 1, y + 2, 5, 1, "#b7c3da");
      p.rect(x - 1, y, 5, 1, "#2e6fef");
      p.rect(x + 4, y - 2, 2, 1, "#e8eef9");
      p.rect(x + 5, y - 2, 1, 3, "#e8eef9");
      p.rect(x + 4, y, 2, 1, "#e8eef9");
      // Steam off the oil, while it isn't drinking.
      if (hold(m.u, 0.3, 0.42, 0.62, 0.72) < 0.2) {
        for (let i = 0; i < 3; i++) p.rect(x + 1 + Math.round(Math.sin(m.t * 3 + i)), y - 5 - i * 2, 1, 1, `rgba(200,210,225,${0.6 - i * 0.15})`);
      }
    },
  },
  {
    label: "Tests pass: a quiet fist pump",
    seconds: 4.5,
    pose: (m) => {
      const green = m.u > 0.08 && m.u < 0.9;
      const k = hold(m.u, 0.2, 0.3, 0.62, 0.72);
      const pump = Math.abs(Math.sin(seg(m.u, 0.3, 0.62) * Math.PI * 2));
      return side(m, {
        near: mixArm(m.base.near, arm([2, -40], mix([8, -50], [6, -38], pump)), k),
        visor: green ? "#6ee7a8" : m.base.visor, led: green ? "#6ee7a8" : m.base.led, bob: pump > 0.8 && k > 0.5 ? 1 : 0,
      });
    },
    props: (p, m) => {
      if (m.u < 0.08 || m.u > 0.9) return;
      // The monitor goes green with a tick.
      p.rect(24, -56, 23, 19, "#0f3326");
      for (let i = 0; i < 4; i++) p.rect(26, -54 + i * 3, 6 + ((i * 7) % 9), 1, "#6ee7a8");
      check(p, 37, -44, "#b9f6d2");
    },
  },
  {
    label: "Knuckles: laces its fingers and cracks them",
    seconds: 4,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      const push = 0.5 + 0.5 * Math.sin(seg(m.u, 0.2, 0.8) * Math.PI * 4 - Math.PI / 2);
      return side(m, {
        near: mixArm(m.base.near, arm([9, -44], [14 + 4 * push, -45]), k),
        far: mixArm(m.base.far, arm([8, -45], [13 + 4 * push, -45]), k),
      });
    },
    props: (p, m, pose) => {
      const push = 0.5 + 0.5 * Math.sin(seg(m.u, 0.2, 0.8) * Math.PI * 4 - Math.PI / 2);
      if (m.u < 0.2 || m.u > 0.8 || push < 0.92) return;
      const [x, y] = hand(pose.near, pose);
      for (const [dx, dy, w, h] of [[3, -5, 1, 2], [5, -1, 2, 1], [3, 3, 1, 2]]) p.rect(x + dx, y + dy, w, h, "#ffffff");
    },
  },
];

// ---- Reviewing: reading a long printout. ----

const SQUINT_SHEET = (u: number): Point => [Math.round(-3 * hold(u, 0, 0.2, 0.8, 1)), Math.round(-5 * hold(u, 0, 0.2, 0.8, 1))];
/** The thrown pages: sideways speed and launch speed of each. */
const THROWN = [[-9, 34], [-3, 40], [4, 44], [9, 38], [14, 46]] as const;

const REVIEWING: Mood[] = [
  {
    label: "Fed up: throws the papers, then picks them up",
    seconds: 7,
    sheet: (u) => (u < 0.86 ? null : [0, 0]),
    pose: (m) => {
      const u = m.u, angry = "#fca5a0";
      if (u < 0.14) return front(m, { near: arm([13, -42], [5, -45]), far: arm([-13, -42], [-5, -45]), visor: angry, scan: false });
      const up = arm([4, -58], [5, -74]);
      if (u < 0.32) return side(m, { near: mixArm(m.base.near, up, seg(u, 0.14, 0.24)), far: mixArm(m.base.far, arm([3, -57], [2, -73]), seg(u, 0.14, 0.24)), visor: angry, tilt: -1, scan: false });
      if (u < 0.5) return side(m, { near: mixArm(up, DOWN, seg(u, 0.32, 0.4)), far: mixArm(up, DOWN, seg(u, 0.32, 0.4)), tilt: 2, visor: "#8a9ab8", scan: false });
      if (u < 0.86) {
        const k = hold(u, 0.5, 0.58, 0.8, 0.86);
        const drop = Math.round(9 * k);
        return side(m, { bob: drop, legs: { kind: drop > 3 ? "kneel" : "stand" }, near: mixArm(DOWN, arm([7, -26], [11, -12]), k), far: DOWN, tilt: 2, scan: false });
      }
      const k = seg(u, 0.86, 1);
      return side(m, { near: mixArm(DOWN, m.base.near, k), far: mixArm(DOWN, m.base.far, k) });
    },
    props: (p, m) => {
      if (m.u < 0.14) {
        p.rect(-5, -51, 10, 12, "#e8eef9");
        for (let k = 0; k < 4; k++) p.rect(-4, -49 + k * 2, k === 2 ? 4 : 8, 1, "#93a0b8");
        return;
      }
      if (m.u < 0.22 || m.u > 0.86) return;
      const tau = (m.u - 0.22) * 7;
      THROWN.forEach(([vx, vy], k) => {
        if (m.u > 0.6 + k * 0.04) return; // picked up
        const land = (vy + Math.sqrt(vy * vy + 2 * 60 * 72)) / 60; // when it reaches the floor
        const s = Math.min(tau, land);
        const x = Math.round(4 + vx * s), y = Math.round(Math.min(-2, -74 - vy * s + 30 * s * s));
        if (y >= -2) p.rect(x - 2, -2, 5, 2, "#dfe5ee");
        else if ((Math.floor(m.t * 8) + k) % 2) p.rect(x - 2, y - 2, 5, 4, "#e8eef9");
        else p.rect(x - 1, y - 3, 3, 5, "#cfd8e6");
      });
    },
  },
  {
    label: "Squints: holds the page right up to its visor",
    seconds: 4,
    sheet: SQUINT_SHEET,
    pose: (m) => {
      const k = hold(m.u, 0, 0.2, 0.8, 1);
      return side(m, {
        lean: Math.round(2 * k), tilt: Math.round(3 * k), visorH: k > 0.5 ? 2 : 5,
        near: mixArm(m.base.near, arm([6, -45], [9, -52]), k), far: mixArm(m.base.far, arm([5, -46], [9, -54]), k),
      });
    },
  },
  {
    label: "Red pen: marks up the page",
    seconds: 5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.1, 0.9, 1);
      return side(m, { near: mixArm(m.base.near, arm([7, -40], [14 + 2 * Math.sin(m.t * 11), -44 + Math.round(2 * Math.cos(m.t * 4))]), k), tilt: 2 });
    },
    props: (p, m, pose) => {
      if (hold(m.u, 0, 0.1, 0.9, 1) < 0.3) return;
      const [x, y] = hand(pose.near, pose);
      p.line(x, y, x + 3, y - 4, 1, "#d63030");
      p.rect(x, y, 1, 1, "#ffffff");
      const marks = Math.floor(seg(m.u, 0.12, 0.85) * 7);
      for (let i = 0; i < marks; i++) p.rect(11 + ((i * 3) % 6), -49 + i * 2, 2 + (i % 2), 1, "#e0453f");
    },
  },
  {
    label: "Approved: stamps the page",
    seconds: 4.5,
    sheet: (u) => [Math.round(2 * hold(u, 0, 0.12, 0.88, 1)), Math.round(6 * hold(u, 0, 0.12, 0.88, 1))],
    pose: (m) => {
      const u = m.u;
      const raised = arm([6, -56], [9, -66]), slam = arm([10, -38], [16, -38]);
      const near =
        u < 0.45 ? mixArm(m.base.near, raised, smooth(seg(u, 0.1, 0.3)))
        : u < 0.5 ? mixArm(raised, slam, seg(u, 0.45, 0.5))
        : u < 0.75 ? slam
        : mixArm(slam, m.base.near, smooth(seg(u, 0.75, 1)));
      return side(m, { near, far: mixArm(m.base.far, arm([7, -38], [13, -40]), hold(u, 0, 0.12, 0.88, 1)), bob: u > 0.5 && u < 0.53 ? 1 : 0 });
    },
    props: (p, m, pose) => {
      if (m.u > 0.5) {
        // The mark on the page: a green box with a tick.
        p.rect(13, -41, 8, 1, "#2fbf71");
        p.rect(13, -36, 8, 1, "#2fbf71");
        p.rect(13, -41, 1, 6, "#2fbf71");
        p.rect(20, -41, 1, 6, "#2fbf71");
        check(p, 14, -39, "#2fbf71");
      }
      if (m.u < 0.85) {
        const [x, y] = hand(pose.near, pose);
        p.rect(x - 1, y - 6, 2, 4, "#6b4a2b");
        p.rect(x - 2, y - 7, 4, 1, "#8a6440");
        p.rect(x - 3, y - 2, 6, 2, "#c23b3b");
        if (m.u > 0.5 && m.u < 0.6) for (const [dx, dy] of [[-5, 0], [4, 0], [-4, -3], [3, -3]]) p.rect(x + dx, y + dy, 1, 1, "#ffffff");
      }
    },
  },
  {
    label: "Paper jam: yanks at the printout",
    seconds: 5,
    jammed: (u) => u > 0.05 && u < 0.75,
    pose: (m) => {
      const k = hold(m.u, 0, 0.1, 0.75, 0.85);
      const jerk = m.u > 0.25 && m.u < 0.7 && Math.sin(m.t * 18) > 0 ? 2 : 0;
      return side(m, {
        near: mixArm(m.base.near, arm([5, -40], [9 - jerk, -44]), k), far: mixArm(m.base.far, arm([4, -41], [9 - jerk, -46]), k),
        lean: jerk ? -1 : 0, visor: k > 0.5 ? "#f6cf6b" : m.base.visor,
      });
    },
    props: (p, m) => {
      if (m.u < 0.1 || m.u > 0.75) return;
      text(p, "!", 4, -80, "#f6cf6b", 9);
      // The paper crumpled up where it feeds.
      p.rect(12, -33, 6, 5, "#dfe5ee");
      p.rect(13, -35, 3, 2, "#b7c3da");
      p.rect(17, -31, 2, 2, "#cfd8e6");
      p.rect(14, -32, 1, 1, "#93a0b8");
      p.rect(16, -30, 1, 1, "#93a0b8");
    },
  },
  {
    label: "Confused: scratches its head and keeps reading",
    seconds: 4,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      return side(m, { near: mixArm(m.base.near, arm([7, -60], [1 + 2 * Math.sin(m.t * 16), -70]), k), pan: -Math.round(k), tilt: 0 });
    },
    props: (p, m) => {
      if (hold(m.u, 0, 0.15, 0.85, 1) < 0.5) return;
      text(p, "?", 12, -80 + Math.round(Math.sin(m.t * 4)), "#9cc2ff", 9);
    },
  },
];

// ---- Needs your call: facing you, tapping the glass. ----

const ESCALATING: Mood[] = [
  {
    label: "Losing it: steams, then bangs on the glass",
    seconds: 6,
    pose: (m) => {
      const red = { visor: "#ff5a4f", led: "#ff5a4f", blink: true };
      if (m.u < 0.15) return front(m, { ...red, bob: Math.sin(m.t * 40) > 0 ? 1 : 0, near: arm([15, -40], [13, -33]), far: arm([-15, -40], [-13, -33]) });
      if (m.u > 0.92) return front(m, red);
      const beat = 0.42, since = m.t - 0.9;
      const i = Math.floor(since / beat), f = (since % beat) / beat;
      const s = i % 2 ? -1 : 1;
      const striking = arm([s * 15, -54], f < 0.65 ? [s * 12, -62] : [s * 8, -46]);
      const cocked = arm([-s * 15, -42], [-s * 13, -36]);
      if (f >= 0.65 && once(m.rt, i)) {
        m.fx.bang(m.rt.x + s * 8, -46);
        m.fx.shake();
      }
      return front(m, { ...red, bigHands: f >= 0.65, near: s > 0 ? striking : cocked, far: s > 0 ? cocked : striking });
    },
    props: (p, m) => {
      // Steam puffing out of both sides of its head.
      for (let i = 0; i < 6; i++) {
        const f = (m.t * 1.2 + i / 6) % 1, s = i % 2 ? 1 : -1, size = 2 + Math.round(f * 2);
        p.rect(Math.round(s * (12 + f * 6)), Math.round(-64 - f * 14), size, size, `rgba(225,230,240,${((1 - f) * 0.8).toFixed(2)})`);
      }
    },
  },
  {
    label: "Polite: one small tap at a time",
    seconds: 4,
    pose: (m) => {
      const i = Math.floor(m.t / 0.8), f = (m.t % 0.8) / 0.8;
      const reach = f < 0.5 ? 0 : Math.sin(((f - 0.5) / 0.5) * Math.PI);
      const tip: Point = [9 - reach, -44 - reach * 3];
      if (reach > 0.9 && once(m.rt, i)) m.fx.tap(m.rt.x + tip[0], tip[1], 0.45);
      return front(m, { near: arm([14, -42], tip), far: arm([-14, -40], [-10, -33]), tilt: 1, pan: 1, blink: false });
    },
  },
  {
    label: "Holds up a sign: your call",
    seconds: 5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.12, 0.88, 1);
      return front(m, { near: mixArm(FRONT_NEAR, arm([14, -44], [10, -46]), k), far: mixArm(FRONT_FAR, arm([-14, -44], [-10, -46]), k) });
    },
    props: (p, m) => {
      if (hold(m.u, 0, 0.12, 0.88, 1) < 0.6) return;
      const w = Math.round(Math.sin(m.t * 3));
      p.rect(-18, -58 + w, 36, 17, "#e8eef9");
      p.rect(-18, -58 + w, 36, 1, "#ffffff");
      p.rect(-18, -42 + w, 36, 1, "#93a0b8");
      text(p, `#${m.rt.bot.issueId ?? ""}`, 0, -57 + w, "#c23b3b", 7);
      text(p, "your call", 0, -49 + w, "#0e1a33", 6);
    },
  },
  {
    label: "Checks the time on its wrist",
    seconds: 4.5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      const tap = hold(m.u, 0.4, 0.48, 0.7, 0.78);
      return front(m, {
        far: mixArm(FRONT_FAR, arm([-12, -44], [1, -47]), k),
        near: mixArm(FRONT_NEAR, arm([13, -44], [5 + (Math.sin(m.t * 14) > 0 ? 0 : 1), -50]), tap),
        tilt: Math.round(2 * k), pan: -Math.round(2 * k),
      });
    },
    props: (p, m, pose) => {
      if (hold(m.u, 0, 0.15, 0.85, 1) < 0.5) return;
      const [x, y] = hand(pose.far, pose);
      p.rect(x - 6, y - 2, 4, 3, "#0b1426");
      p.rect(x - 5, y - 1, 2, 1, Math.floor(m.t * 2) % 2 ? "#8fc9ff" : "#3978f6");
    },
  },
  {
    label: "Points at your Inbox",
    seconds: 4,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      const jab = m.u > 0.25 && m.u < 0.8 ? Math.max(0, Math.sin(m.t * 8)) : 0;
      return front(m, {
        far: mixArm(FRONT_FAR, arm([-17, -55], [-23 - jab, -63 - jab]), k),
        near: mixArm(FRONT_NEAR, arm([16, -40], [12, -34]), k),
        pan: -Math.round(2 * k), tilt: -Math.round(k),
      });
    },
    props: (p, m, pose) => {
      const jab = m.u > 0.25 && m.u < 0.8 ? Math.max(0, Math.sin(m.t * 8)) : 0;
      if (jab < 0.7) return;
      const [x, y] = hand(pose.far, pose);
      p.rect(x - 5, y - 4, 2, 1, "#e8eef9");
      p.rect(x - 3, y - 6, 1, 2, "#e8eef9");
    },
  },
  {
    label: "Kneels and begs you to answer",
    seconds: 5.5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.12, 0.85, 1);
      const drop = Math.round(18 * k), shake = Math.round(Math.sin(m.t * 18) * 0.6);
      return front(m, {
        bob: drop, legs: { kind: k > 0.4 ? "knees" : "stand" }, tilt: -Math.round(k), visorH: k > 0.5 ? 6 : 5, visor: k > 0.5 ? "#ffe7a3" : m.base.visor,
        near: mixArm(FRONT_NEAR, arm([9, -46], [1, -53 + shake]), k), far: mixArm(FRONT_FAR, arm([-9, -46], [-1, -53 + shake]), k),
      });
    },
  },
];

// ---- Idle: wandering about. ----

/** Where the kicked bolt is, t seconds after the kick: skipping along the floor and slowing down. */
const boltAt = (t: number): Point => [12 + 40 * (1 - Math.exp(-t * 1.6)), -2 - Math.abs(Math.sin((t * Math.PI) / 0.6)) * 9 * Math.exp(-t * 1.5)];

const IDLE: Mood[] = [
  {
    label: "Yawns, stretches and looks at you",
    seconds: 6.5,
    pose: (m) => {
      if (m.u >= 0.6 && m.u < 0.88) return front(m, {});
      if (m.u >= 0.88) return m.base;
      const up = hold(m.u, 0.05, 0.25, 0.45, 0.58);
      return side(m, {
        near: mixArm(m.base.near, arm([3, -58], [4, -77]), up), far: mixArm(m.base.far, arm([1, -58], [1, -78]), up),
        visorH: 5 + Math.round(2 * hold(m.u, 0.15, 0.25, 0.4, 0.5)), tilt: -Math.round(up), visor: "#6f93cf",
      });
    },
  },
  {
    label: "Power nap: sits down, visor dims",
    seconds: 8,
    pose: (m) => {
      const k = hold(m.u, 0, 0.12, 0.88, 0.96);
      const drop = Math.round(26 * k);
      return side(m, {
        bob: drop, legs: lowered(drop), tilt: Math.round(3 * k), pan: 0,
        visor: k > 0.6 ? "#1c2f55" : m.base.visor, led: k > 0.6 ? "#22324f" : m.base.led,
        near: mixArm(m.base.near, arm([3, -38], [8, -33]), k), far: mixArm(m.base.far, arm([2, -38], [7, -33]), k),
      });
    },
    props: (p, m) => {
      if (hold(m.u, 0, 0.12, 0.88, 0.96) < 0.8) return;
      for (let i = 0; i < 3; i++) {
        const f = (m.t * 0.5 + i / 3) % 1;
        text(p, i % 2 ? "z" : "Z", Math.round(8 + f * 8 + Math.sin(f * 6) * 2), Math.round(-44 - f * 22), `rgba(156,194,255,${(1 - f).toFixed(2)})`, 5 + Math.round(f * 3));
      }
    },
  },
  {
    label: "Peers at an issue",
    seconds: 5,
    pose: (m) => {
      const k = hold(m.u, 0, 0.15, 0.85, 1);
      return side(m, { near: mixArm(m.base.near, arm([8, -52], [9, -63]), k), lean: Math.round(2 * k), tilt: Math.round(k), pan: Math.round(k * Math.sin(m.t * 1.4)) });
    },
    props: (p, m) => {
      if (hold(m.u, 0, 0.15, 0.85, 1) < 0.5) return;
      // A small floating issue card it's studying.
      const y = -60 + Math.round(Math.sin(m.t * 2));
      p.rect(18, y, 12, 9, "rgba(143,201,255,0.18)");
      p.rect(18, y, 12, 1, "rgba(143,201,255,0.8)");
      p.rect(18, y + 8, 12, 1, "rgba(143,201,255,0.5)");
      p.rect(20, y + 2, 4, 1, "#f6cf6b");
      p.rect(20, y + 4, 8, 1, "rgba(232,238,249,0.8)");
      p.rect(20, y + 6, 6, 1, "rgba(232,238,249,0.6)");
    },
  },
  {
    label: "Kicks a loose bolt",
    seconds: 5,
    pose: (m) => {
      const u = m.u;
      const reach = u < 0.3 || u > 0.62 ? 0 : u < 0.45 ? -0.4 * seg(u, 0.3, 0.45) : u < 0.52 ? -0.4 + 1.4 * seg(u, 0.45, 0.52) : 1 - seg(u, 0.52, 0.62);
      return side(m, {
        legs: { kind: "kick", reach }, tilt: u < 0.45 ? 2 : 0, pan: u < 0.45 ? 1 : u > 0.55 ? 2 : 0,
        far: arm([3, -40], [6 + 4 * Math.max(0, reach), -36]), near: arm([0, -38], [-2 - 3 * Math.max(0, reach), -31]),
      });
    },
    props: (p, m) => {
      const tau = Math.max(0, (m.u - 0.5) * 5);
      if (tau > 2.2) return;
      const [bx, by] = boltAt(tau);
      const x = Math.round(bx), y = Math.round(by);
      const alpha = tau > 1.6 ? 1 - (tau - 1.6) / 0.6 : 1;
      p.ctx.globalAlpha = alpha;
      if (tau > 0 && Math.floor(tau * 12) % 2) p.rect(x - 2, y - 1, 5, 2, "#93a0b8");
      else {
        p.rect(x - 1, y - 2, 3, 3, "#93a0b8");
        p.rect(x - 1, y - 2, 3, 1, "#c9d4e8");
        p.rect(x, y - 1, 1, 1, "#262f45");
      }
      p.ctx.globalAlpha = 1;
    },
  },
  {
    label: "Runs a self-check scan",
    seconds: 5,
    pose: (m) => front(m, { near: arm([15, -42], [18, -34]), far: arm([-15, -42], [-18, -34]), visor: "#6ee7a8", led: "#6ee7a8", scan: true }),
    props: (p, m) => {
      const s = seg(m.u, 0.1, 0.8);
      if (s > 0 && s < 1) {
        const y = Math.round(s < 0.5 ? -72 + 144 * s : -72 + 144 * (1 - s));
        p.rect(-15, y - 3, 31, 3, "rgba(110,231,168,0.18)");
        p.rect(-15, y, 31, 1, "rgba(110,231,168,0.9)");
      }
      if (m.u > 0.82) check(p, -3, -77, "#6ee7a8");
    },
  },
  {
    label: "Trips, gets up fast and checks nobody saw",
    seconds: 5.5,
    pose: (m) => {
      const u = m.u, blush = "#ffb3c1";
      if (u < 0.12) {
        const s = seg(u, 0, 0.12);
        return side(m, { legs: { kind: "walk", phase: m.rt.phase + s * 6 }, lean: Math.round(4 * s), near: arm([6, -52], [11, -58]), far: arm([-4, -50], [-8, -56]), visor: "#f6cf6b" });
      }
      if (u < 0.42) return side(m, { legs: { kind: "knees" }, bob: 10, lean: 3, near: arm([9, -26], [14, -13]), far: arm([8, -26], [12, -13]), tilt: 1, visor: blush });
      if (u < 0.5) {
        const s = seg(u, 0.42, 0.5);
        return side(m, { bob: Math.round(10 * (1 - s)), legs: { kind: s < 0.5 ? "kneel" : "stand" }, lean: Math.round(3 * (1 - s)), near: DOWN, far: DOWN, visor: blush });
      }
      if (u < 0.85) return front(m, { pan: Math.sin((u - 0.5) * 40) > 0 ? 2 : -2, visor: blush });
      return m.base;
    },
    props: (p, m) => {
      const f = seg(m.u, 0.12, 0.3);
      if (f <= 0 || f >= 1) return;
      for (let i = 0; i < 4; i++) {
        p.rect(Math.round(14 + (i - 1.5) * 5 * (1 + f)), Math.round(-2 - f * 4 - (i % 2)), 2, 2, `rgba(180,190,205,${((1 - f) * 0.7).toFixed(2)})`);
      }
    },
  },
];

export const MOODS: Record<AgentState, Mood[]> = { working: WORKING, reviewing: REVIEWING, escalating: ESCALATING, idle: IDLE };

/** How often moods play: off, now and then, or often enough to show them off. */
export type MoodPace = "off" | "calm" | "lively";
// Seconds between one mood and the next. The agents dock plays them calm: now and then, not all the time.
const GAP: Record<Exclude<MoodPace, "off">, [number, number]> = { calm: [40, 80], lively: [5, 10] };

/** Starts, ends and schedules a robot's moods. A robot on the move never starts one. */
export function updateMood(rt: Runtime, now: number, pace: MoodPace) {
  const gap = pace === "off" ? null : GAP[pace];
  const later = () => (gap ? now + gap[0] + Math.random() * (gap[1] - gap[0]) : Infinity);
  if (rt.mood) {
    if (now - rt.mood.start >= rt.mood.mood.seconds) {
      rt.mood = null;
      rt.nextMood = later();
    }
    return;
  }
  // The first mood waits a whole gap too, so a page that has just opened stays calm.
  if (!(rt.nextMood < Infinity) && gap) rt.nextMood = later();
  if (rt.forceMood && rt.state === "idle") rt.walking = rt.running = false;
  if (rt.walking || !(rt.forceMood || (gap && now >= rt.nextMood))) return;
  rt.forceMood = false;
  const list = MOODS[rt.state];
  rt.moodIndex = (rt.moodIndex + 1) % list.length;
  rt.mood = { mood: list[rt.moodIndex], start: now };
  rt.beat = -1;
}
