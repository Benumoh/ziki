import type { Palette } from "./types";
import type { Painter } from "./painter";

export type Point = [number, number];
export type Arm = { elbow: Point; hand: Point };

/** Everything that decides how a robot looks in one frame. The animations (poses.ts) produce these. */
export type Pose = {
  /** "side" while it works on its own, "front" when it turns to face you. */
  view: "side" | "front";
  dir: 1 | -1;
  /** Upper body moved down by this many pixels (a servo settling, a step). */
  bob: number;
  /** Sitting on the floor, down on one knee, on both knees, or kicking (reach: -1 swung back to 1 kicked out). Lower the body with bob to match. */
  legs:
    | { kind: "stand" | "sit" | "kneel" | "knees" }
    | { kind: "walk"; phase: number; run?: boolean }
    | { kind: "kick"; reach: number };
  /** Side view: the near arm. Front view: the arm on the viewer's right. */
  near: Arm;
  /** Side view: the far arm. Front view: the arm on the viewer's left. */
  far: Arm;
  /** Head lowered by this many pixels (reading) and visor moved sideways (looking around). */
  tilt: number;
  pan: number;
  visor: string;
  /** Visor height in pixels: 5 normally, 2 when squinting, 7 for a yawn. */
  visorH?: number;
  /** A light that sweeps across the visor, line by line. */
  scan: boolean;
  led: string;
  blink: boolean;
  /** Blue light from a monitor on the face and chest. */
  glow?: boolean;
  /** Hands drawn bigger, as when one comes close to the glass. */
  bigHands?: boolean;
  /** Side view: everything above the hips moved forward by this many pixels, the head a pixel more (running). */
  lean?: number;
};

const GLASS = "#0b1426";
const WHITE = "#ffffff";

function visor(p: Painter, x: number, y0: number, w: number, pose: Pose, t: number) {
  const h = pose.visorH ?? 5;
  // A narrow visor sits in the middle of the frame; a tall one grows downwards.
  const y = h < 5 ? y0 + Math.floor((5 - h) / 2) : y0;
  p.rect(x - 1, y - 1, w + 2, h + 2, GLASS);
  p.rect(x, y, w, h, pose.visor);
  p.rect(x, y, w, 1, "#dbe7fd");
  if (h > 2) p.rect(x, y + h - 1, w, 1, "rgba(0,0,0,0.25)");
  if (pose.scan) p.rect(x + (Math.floor(t * 6) % w), y + 1, 1, Math.max(1, h - 2), WHITE);
  else p.rect(x + 1, y + 1, 2, 1, "rgba(255,255,255,0.7)");
}

function led(p: Painter, x: number, y: number, pose: Pose, t: number, size = 2) {
  if (pose.blink && Math.floor(t * 2.5) % 2) return;
  p.rect(x, y, size, size, pose.led);
}

function sideLeg(p: Painter, pal: Palette, near: boolean, footX: number, lift: number, bend = 2.5) {
  const hipY = -28;
  const ankle: Point = [footX, -4 - lift];
  legTo(p, pal, near, [0, hipY], [footX / 2 + bend, (hipY + ankle[1]) / 2], ankle, false);
}

/** One leg from hip to knee to ankle. The foot is flat on the ground, or just a toe when the shin lies on the floor. */
function legTo(p: Painter, pal: Palette, near: boolean, hip: Point, knee: Point, ankle: Point, toe: boolean) {
  const c = near ? pal[2] : pal[3], top = near ? pal[1] : pal[2];
  p.line(hip[0], hip[1], knee[0], knee[1], 5, c, top);
  p.line(knee[0], knee[1], ankle[0], ankle[1], 4, c, top);
  p.disc(Math.round(knee[0]), Math.round(knee[1]), 2, near ? pal[3] : pal[4], near ? pal[2] : undefined);
  if (toe) {
    p.rect(ankle[0] - 3, ankle[1] - 1, 3, 3, near ? pal[3] : pal[4]);
    return;
  }
  p.rect(ankle[0] - 4, ankle[1] + 1, 10, 3, near ? pal[3] : pal[4]);
  p.rect(ankle[0] - 4, ankle[1] + 1, 10, 1, c);
  p.rect(ankle[0] + 5, ankle[1] + 2, 1, 2, near ? pal[4] : "#11151f");
}

function sideArm(p: Painter, pal: Palette, arm: Arm, bob: number, near: boolean, outline = false) {
  const [ex, ey] = arm.elbow, [hx, hy] = arm.hand;
  const c = near ? pal[2] : pal[3], top = near ? pal[0] : pal[2];
  // A dark edge so a fast-moving arm stands out against the body.
  if (outline) {
    p.line(1, -46 + bob, ex, ey + bob, 5, pal[4]);
    p.line(ex, ey + bob, hx, hy + bob, 5, pal[4]);
    p.rect(hx - 3, hy + bob - 3, 6, 6, pal[4]);
  }
  p.line(1, -46 + bob, ex, ey + bob, 3, c, top);
  p.line(ex, ey + bob, hx, hy + bob, 3, c, top);
  p.disc(Math.round(ex), Math.round(ey + bob), 1, near ? pal[3] : pal[4]);
  p.rect(hx - 2, hy + bob - 2, 4, 4, near ? pal[1] : pal[2]);
  p.rect(hx - 2, hy + bob + 1, 4, 1, near ? pal[3] : pal[4]);
}

/** A robot seen from the side, facing pose.dir. */
export function drawSide(p: Painter, pal: Palette, pose: Pose, t: number) {
  const b = pose.bob;
  const base = p.x, lean = (pose.lean ?? 0) * p.dir;
  p.shadow(22);
  p.x = base + lean;
  sideArm(p, pal, pose.far, b, false);
  p.x = base;

  // Legs: far one first. Sitting and kneeling hang from a hip lowered by bob.
  const hipY = -28 + b;
  for (const near of [false, true]) {
    const dx = near ? 0 : -1;
    if (pose.legs.kind === "sit") {
      legTo(p, pal, near, [dx, hipY], [dx + 8, -7], [dx + 15, -4], false);
    } else if (pose.legs.kind === "kneel") {
      if (near) legTo(p, pal, near, [0, hipY], [3, -3], [-8, -3], true);
      else legTo(p, pal, near, [0, hipY], [8, hipY + 4], [8, -4], false);
    } else if (pose.legs.kind === "knees") {
      legTo(p, pal, near, [dx, hipY], [dx + 4, -3], [dx - 7, -3], true);
    } else if (pose.legs.kind === "kick") {
      const r = pose.legs.reach;
      if (near) sideLeg(p, pal, near, -2 + r * 12, Math.max(0, r) * 7, 2.5 - Math.max(0, r) * 2);
      else sideLeg(p, pal, near, -2, 0);
    } else if (pose.legs.kind === "walk" && pose.legs.run) {
      // Running: a long stride, and the leg coming forward lifts its knee high.
      const ph = pose.legs.phase + (near ? 0 : Math.PI);
      const lift = Math.max(0, Math.cos(ph)) * 8;
      sideLeg(p, pal, near, Math.sin(ph) * 9, lift, 2.5 + lift * 0.7);
    } else if (pose.legs.kind === "walk") {
      const ph = pose.legs.phase + (near ? 0 : Math.PI);
      sideLeg(p, pal, near, Math.sin(ph) * 6, Math.max(0, Math.cos(ph)) * 3);
    } else {
      sideLeg(p, pal, near, near ? 2 : -2, 0);
    }
  }

  // Upper body, leaning forward if it's running.
  p.x = base + lean;
  // Pelvis and power pack.
  p.rect(-7, -31 + b, 14, 4, pal[2]);
  p.rect(-7, -31 + b, 14, 1, pal[1]);
  p.rect(-14, -48 + b, 5, 15, pal[3]);
  p.rect(-14, -48 + b, 5, 1, pal[2]);
  for (let i = 0; i < 3; i++) p.rect(-13, -44 + b + i * 3, 3, 1, pal[4]);

  // Torso: lit from above, with a rim of light on the side it faces.
  p.rect(-9, -50 + b, 19, 20, pal[1]);
  p.rect(-8, -51 + b, 17, 1, pal[0]);
  p.rect(-9, -50 + b, 19, 1, pal[0]);
  p.rect(-9, -50 + b, 2, 20, pal[2]);
  p.rect(9, -49 + b, 1, 18, pal[0]);
  p.rect(-9, -31 + b, 19, 1, pal[3]);
  p.rect(-6, -49 + b, 3, 1, WHITE);
  p.rect(-5, -48 + b, 1, 1, WHITE);
  // Side hatch with two lights, and vents.
  p.rect(-3, -46 + b, 9, 8, pal[2]);
  p.rect(-3, -46 + b, 9, 1, pal[3]);
  p.rect(-3, -39 + b, 9, 1, pal[0]);
  led(p, 3, -44 + b, pose, t);
  p.rect(0, -44 + b, 1, 1, "#3978f6");
  for (let i = 0; i < 3; i++) p.rect(-2, -36 + b + i * 2, 7, 1, pal[3]);
  for (const [rx, ry] of [[-7, -49], [8, -49], [-7, -33], [8, -33]]) p.rect(rx, ry + b, 1, 1, pal[0]);
  if (pose.glow) p.rect(10, -49 + b, 1, 18, "rgba(143,201,255,0.55)");

  // Neck and head.
  p.rect(-2, -54 + b, 6, 4, pal[3]);
  p.rect(-2, -53 + b, 6, 1, pal[2]);
  if (lean) p.x = base + lean + p.dir;
  const hy = -67 + b + pose.tilt;
  p.rect(-8, hy, 18, 13, pal[1]);
  p.rect(-7, hy - 1, 16, 1, pal[0]);
  p.rect(-8, hy, 18, 2, pal[0]);
  p.rect(-8, hy, 2, 13, pal[2]);
  p.rect(-8, hy + 12, 18, 1, pal[3]);
  p.rect(-5, hy + 1, 3, 1, WHITE);
  p.disc(-3, hy + 7, 3, pal[2], pal[1]);
  p.disc(-3, hy + 7, 1, pal[3]);
  visor(p, 3 + pose.pan, hy + 4, 7, pose, t);
  if (pose.glow) p.rect(10, hy + 3, 1, 7, "rgba(143,201,255,0.5)");
  // Antenna.
  p.rect(-5, hy - 5, 1, 5, pal[2]);
  led(p, -5, hy - 6, pose, t, 1);
  p.x = base + lean;

  sideArm(p, pal, pose.near, b, true, !!pose.lean);
  p.disc(1, -46 + b, 3, pal[2], pal[1]);
  p.x = base;
}

/** A robot facing you. */
export function drawFront(p: Painter, pal: Palette, pose: Pose, t: number) {
  const b = pose.bob;
  p.at(p.x, 1);
  p.shadow(26);

  // Legs. On its knees, the thighs come straight down to knee pads on the floor and the feet are hidden behind.
  const kneeling = pose.legs.kind === "knees" || pose.legs.kind === "kneel";
  for (const [lx, c, top] of [[-7, pal[2], pal[1]], [3, pal[3], pal[2]]] as const) {
    if (kneeling) {
      // Short thighs down to wide knee pads on the floor, with the soles of the feet showing behind.
      p.rect(lx - 1, -6, 7, 3, pal[4]);
      p.rect(lx, -28 + b, 5, Math.max(4, 25 - b), c);
      p.rect(lx, -28 + b, 1, Math.max(4, 25 - b), top);
      p.rect(lx - 1, -4, 7, 4, pal[3]);
      p.rect(lx - 1, -4, 7, 1, pal[1]);
      continue;
    }
    p.rect(lx, -28, 5, 25, c);
    p.rect(lx, -28, 1, 25, top);
    p.disc(lx + 2, -15, 2, pal[3], pal[2]);
  }
  if (!kneeling) {
    p.rect(-9, -3, 8, 3, pal[3]);
    p.rect(1, -3, 8, 3, pal[4]);
    p.rect(-9, -3, 8, 1, pal[2]);
    p.rect(1, -3, 8, 1, pal[3]);
  }

  // Pelvis and torso.
  p.rect(-8, -31 + b, 16, 4, pal[2]);
  p.rect(-11, -51 + b, 22, 21, pal[1]);
  p.rect(-10, -52 + b, 20, 1, pal[0]);
  p.rect(-11, -51 + b, 22, 1, pal[0]);
  p.rect(-11, -51 + b, 2, 21, pal[0]);
  p.rect(9, -51 + b, 2, 21, pal[3]);
  p.rect(-11, -31 + b, 22, 1, pal[3]);
  p.rect(-8, -50 + b, 3, 1, WHITE);
  // Chest panel and seam.
  p.rect(-5, -47 + b, 10, 8, pal[2]);
  p.rect(-5, -47 + b, 10, 1, pal[3]);
  p.rect(-5, -40 + b, 10, 1, pal[0]);
  led(p, -3, -45 + b, pose, t, 3);
  p.rect(2, -45 + b, 1, 1, "#3978f6");
  p.rect(0, -38 + b, 1, 7, pal[3]);
  for (let i = 0; i < 2; i++) p.rect(-4, -36 + b + i * 2, 3, 1, pal[3]);

  // Neck and head.
  p.rect(-3, -54 + b, 6, 3, pal[3]);
  const hy = -68 + b + pose.tilt;
  p.rect(-10, hy, 20, 14, pal[1]);
  p.rect(-9, hy - 1, 18, 1, pal[0]);
  p.rect(-10, hy, 20, 2, pal[0]);
  p.rect(-10, hy, 2, 14, pal[0]);
  p.rect(8, hy, 2, 14, pal[3]);
  p.rect(-10, hy + 13, 20, 1, pal[3]);
  p.rect(-7, hy + 1, 3, 1, WHITE);
  p.rect(-12, hy + 4, 2, 6, pal[2]);
  p.rect(10, hy + 4, 2, 6, pal[3]);
  visor(p, -6 + pose.pan, hy + 5, 12, pose, t);
  p.rect(0, hy - 5, 1, 5, pal[2]);
  led(p, 0, hy - 6, pose, t, 1);

  // Arms: the viewer's left (far), then right (near).
  for (const [side, arm] of [[-1, pose.far], [1, pose.near]] as const) {
    const sx = side * 12;
    const c = side > 0 ? pal[3] : pal[2], top = side > 0 ? pal[2] : pal[0];
    p.line(sx, -48 + b, arm.elbow[0], arm.elbow[1] + b, 3, c, top);
    p.line(arm.elbow[0], arm.elbow[1] + b, arm.hand[0], arm.hand[1] + b, 3, c, top);
    p.disc(sx, -48 + b, 3, pal[2], pal[1]);
    const s = pose.bigHands ? 6 : 4;
    p.rect(arm.hand[0] - s / 2, arm.hand[1] + b - s / 2, s, s, pal[1]);
    p.rect(arm.hand[0] - s / 2, arm.hand[1] + b + s / 2 - 1, s, 1, pal[3]);
  }
}
