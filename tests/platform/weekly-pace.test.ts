import { describe, expect, it } from "vitest";
import { weeklyPace } from "@/lib/coins/weekly-pace";

describe("weeklyPace", () => {
  it("is on track once earned meets the goal", () => {
    const p = weeklyPace(6000, 2000, 5000);
    expect(p.state).toBe("on-track");
    expect(p.detail).toContain("1,000 Ziks");
  });
  it("is fixable when earned plus in-motion reaches the goal", () => {
    expect(weeklyPace(2000, 3000, 5000).state).toBe("fixable");
  });
  it("is short otherwise and names the gap", () => {
    const p = weeklyPace(1000, 1000, 5000);
    expect(p.state).toBe("short");
    expect(p.headline).toBe("Short by 3,000 Ziks");
  });
  it("never overflows the bar and tolerates bad input", () => {
    const p = weeklyPace(100, 100, 5);
    expect(p.earnedPct + p.inMotionPct).toBeLessThanOrEqual(100.0001);
    const q = weeklyPace(NaN, -4, 0);
    expect(q.earned).toBe(0);
    expect(q.inMotion).toBe(0);
  });
});
