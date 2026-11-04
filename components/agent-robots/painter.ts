/**
 * Draws pixel art on a small canvas that the page scales up without smoothing. Every shape is made of whole pixels,
 * so motion stays smooth while edges stay crisp. Coordinates are relative to one robot: x from its centre (positive is
 * the way it faces), y from the floor (negative is up).
 */
export class Painter {
  x = 0;
  dir: 1 | -1 = 1;

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly floor: number,
  ) {}

  /** Draw the next shapes for a robot standing at x, facing dir. */
  at(x: number, dir: 1 | -1 = 1) {
    this.x = x;
    this.dir = dir;
    return this;
  }

  /** Screen x of a local x. */
  sx(dx: number) {
    return this.dir > 0 ? this.x + dx : this.x - dx;
  }

  dot(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  rect(dx: number, dy: number, w: number, h: number, color: string) {
    const x = this.dir > 0 ? this.x + dx : this.x - dx - w + 1;
    this.dot(x, this.floor + dy, w, h, color);
  }

  /** A thick line of square pixels, with an optional lighter top edge for a rounded look. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, color: string, top?: string) {
    const a = this.sx(x0), b = this.sx(x1);
    const n = Math.max(1, Math.ceil(Math.hypot(b - a, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = a + (b - a) * k - w / 2;
      const y = this.floor + y0 + (y1 - y0) * k - w / 2;
      this.dot(x, y, w, w, color);
      if (top) this.dot(x, y, w, 1, top);
    }
  }

  /** A filled circle of radius r, with an optional highlight on its upper half. */
  disc(cx: number, cy: number, r: number, color: string, light?: string) {
    for (let y = -r; y <= r; y++) {
      const half = Math.round(Math.sqrt(r * r - y * y));
      this.rect(cx - half, cy + y, half * 2 + 1, 1, light && y < -r / 3 ? light : color);
    }
  }

  /** A soft shadow under a robot's feet. */
  shadow(width: number) {
    this.ctx.fillStyle = "rgba(0,0,0,0.35)";
    this.ctx.fillRect(Math.round(this.x - width / 2), this.floor - 1, width, 2);
    this.ctx.fillRect(Math.round(this.x - width / 2 + 2), this.floor + 1, width - 4, 1);
  }
}
