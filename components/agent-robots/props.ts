import type { Painter } from "./painter";

/** The workstation a working agent types at, to its right. The screen scrolls while it works. */
export function drawDesk(p: Painter, t: number, busy: boolean) {
  p.rect(12, -28, 37, 3, "#22324f");
  p.rect(12, -28, 37, 1, "#2e4266");
  p.rect(12, -25, 37, 1, "#15284a");
  p.rect(13, -25, 2, 25, "#1a2844");
  p.rect(46, -25, 2, 25, "#1a2844");
  // Keyboard.
  p.rect(13, -31, 12, 3, "#5f6577");
  p.rect(13, -31, 12, 1, "#93a0b8");
  // Monitor on its stand.
  p.rect(33, -36, 3, 8, "#1a2844");
  p.rect(29, -29, 11, 1, "#22324f");
  p.rect(23, -57, 25, 22, "#22324f");
  p.rect(23, -57, 25, 1, "#2e4266");
  p.rect(24, -56, 23, 19, "#0b2350");
  const scroll = Math.floor(t * (busy ? 3 : 0.3));
  for (let k = 0; k < 6; k++) {
    const o = (scroll + k) % 9;
    p.rect(26 + (o % 3) * 2, -54 + k * 3, 3 + ((o * 5) % 9), 1, k % 2 ? "#8fc9ff" : "#3978f6");
    p.rect(31 + ((o * 3) % 7), -54 + k * 3, 4, 1, "#2a63d8");
  }
  if (busy && Math.floor(t * 2) % 2) p.rect(26, -54 + 15, 2, 1, "#e8eef9");
}

/**
 * The workstation of an agent that is stuck: the same desk, its screen gone
 * yellow the way a failing run goes red with an X and a passing one green with
 * a tick, with a thin warning triangle that blinks (lit, unless `lit` is false).
 */
export function drawStuckDesk(p: Painter, t: number, lit: boolean) {
  drawDesk(p, t, false);
  p.rect(24, -56, 23, 19, "#33280a");
  for (let i = 0; i < 4; i++) p.rect(26, -54 + i * 3, [6, 9, 7, 8][i]!, 1, "#ffd36b");
  const line = lit ? "#ffeaa8" : "#8a6d22";
  // The triangle's outline, eleven pixels across and ten tall, one pixel thick like the tick.
  for (let row = 0; row < 9; row++) {
    const half = Math.floor((row + 1) / 2);
    p.rect(40 - half, -52 + row, 1, 1, line);
    p.rect(40 + half, -52 + row, 1, 1, line);
  }
  p.rect(35, -43, 11, 1, line);
  // And its "!", clear of the outline.
  p.rect(40, -49, 1, 3, line);
  p.rect(40, -45, 1, 1, line);
}

/** A long printout held up to read, folding down to a pile on the floor. The paper feeds while it reads, unless it's jammed. */
export function drawPrintout(p: Painter, t: number, sheet: [number, number] | null = [0, 0], feeding = true) {
  const feed = feeding ? Math.floor(t * 0.8) % 2 : 0;
  for (let y = -38, i = 0; y < -5; y += 4, i++) {
    const x = (i + feed) % 2 ? 15 : 11;
    p.rect(x, y, 9, 4, "#dfe5ee");
    p.rect(x, y + 3, 9, 1, "#b7c3da");
    p.rect(x + 1, y + 1, 5, 1, "#93a0b8");
  }
  p.rect(9, -6, 19, 6, "#cfd8e6");
  p.rect(9, -6, 19, 1, "#e8eef9");
  p.rect(10, -3, 17, 1, "#b7c3da");
  // The sheet in its hands.
  if (!sheet) return;
  const [sx, sy] = sheet;
  p.rect(10 + sx, -51 + sy, 10, 13, "#e8eef9");
  p.rect(10 + sx, -51 + sy, 10, 1, "#ffffff");
  for (let k = 0; k < 5; k++) p.rect(11 + sx, -49 + sy + k * 2, k === 2 ? 5 : 8, 1, "#93a0b8");
}

/** scale sizes the burst: under 1 for a polite tap, over 1 for a bang (which also gets a thicker red edge). */
export type Ripple = { x: number; y: number; born: number; rgb: string; size: number; scale: number };

/** How far each point of the impact star reaches, so the burst looks hand-drawn rather than even. */
const SPIKES = [12, 8, 14, 9, 11, 7, 13, 9, 12];

/** A manga-style impact where a robot knocks on the glass: a white starburst with a thin red edge, and speed lines shooting out (white on the dark floor, red on the light one, given as "r,g,b"). */
export function drawRipples(ctx: CanvasRenderingContext2D, ripples: Ripple[], t: number, lines = "255,255,255") {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    const age = (t - r.born) / 0.6;
    if (age >= 1) {
      ripples.splice(i, 1);
      continue;
    }
    const cx = Math.round(r.x), cy = Math.round(r.y);
    // Each knock turns the star a little, so no two look the same.
    const seed = Math.floor(r.born * 7);
    const spin = (seed % 9) * 0.35;

    // The starburst pops in slightly oversized, holds, then shrinks away.
    if (age < 0.55) {
      const size = age < 0.08 ? 1.15 : 1 - (age - 0.08) * 0.7;
      const alpha = age < 0.35 ? 1 : 1 - (age - 0.35) / 0.2;
      const reach = Math.ceil(17 * r.scale), rim = r.scale > 1.2 ? 3 : 1.2;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx, dy * 1.15);
          if (d > reach) continue;
          const turn = (((Math.atan2(dy, dx) + spin) / (Math.PI * 2)) * SPIKES.length + SPIKES.length) % SPIKES.length;
          const k = Math.floor(turn);
          const towardsTip = 1 - Math.abs(turn - k - 0.5) * 2;
          const edge = (5 + (SPIKES[(k + seed) % SPIKES.length] - 5) * towardsTip) * size * r.scale;
          if (d > edge) continue;
          ctx.fillStyle = d > edge - rim ? `rgba(${r.rgb},${(alpha * 0.85).toFixed(2)})` : `rgba(255,255,255,${alpha.toFixed(2)})`;
          ctx.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    }

    // Speed lines: short white dashes flying outwards between the points.
    if (age < 0.75) {
      const from = (13 + age * r.size) * r.scale, length = Math.max(2, 7 * (1 - age) * r.scale);
      ctx.fillStyle = `rgba(${lines},${(1 - age / 0.75).toFixed(2)})`;
      for (let k = 0; k < 8; k++) {
        const a = spin + 0.2 + (k * Math.PI * 2) / 8;
        for (let s = 0; s < length; s++) {
          ctx.fillRect(Math.round(cx + Math.cos(a) * (from + s)), Math.round(cy + Math.sin(a) * (from + s) * 0.85), 1, 1);
        }
      }
    }
  }
}
