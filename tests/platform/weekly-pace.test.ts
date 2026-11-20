import { describe, expect, it } from "vitest";
import { weeklyPace } from "@/lib/points/pace";

describe("weeklyPace", () => {
  it("is on track once earned meets the goal", () => {
    const p = weeklyPace(6, 2, 5);
    expect(p.state).toBe("on-track");
    expect(p.detail).toContain("10 Ziks");
  });
  it("is fixable when earned plus in-motion reaches the goal", () => {
    expect(weeklyPace(2, 3, 5).state).toBe("fixable");
  });
  it("is short otherwise and names the gap", () => {
    const p = weeklyPace(1, 1, 5);
    expect(p.state).toBe("short");
    expect(p.headline).toBe("Short by 30 Ziks");
  });
  it("never overflows the bar and tolerates bad input", () => {
    const p = weeklyPace(100, 100, 5);
    expect(p.earnedPct + p.inMotionPct).toBeLessThanOrEqual(100.0001);
    const q = weeklyPace(NaN, -4, 0);
    expect(q.earned).toBe(0);
    expect(q.inMotion).toBe(0);
  });
});
