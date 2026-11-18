import { describe, expect, it } from "vitest";
import { canAddFile, countFiles, fileKind, placeholderCreditCosts, ratioShape, urlKind, type AspectRatio, type MediaKind, type StudioAsset } from "@/components/marketing/video/model";

function assets(kind: MediaKind, count: number): StudioAsset[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${kind}-${index}`, name: `${kind} ${index}`, kind, origin: "asset" }));
}

describe("video studio preview shape", () => {
  it.each<[AspectRatio, number, number]>([
    ["16:9", 340, 191], ["9:16", 191, 340], ["1:1", 340, 340],
    ["4:3", 340, 255], ["3:4", 255, 340], ["21:9", 340, 146],
  ])("fits %s inside the preview without distorting its orientation", (ratio, width, height) => {
    expect(ratioShape(ratio)).toEqual({ width, height });
    const [w, h] = ratio.split(":").map(Number);
    const tile = ratioShape(ratio, 26);
    expect(Math.max(tile.width, tile.height)).toBe(26);
    expect(Math.abs(tile.width / w - tile.height / h)).toBeLessThanOrEqual(1);
  });
});

describe("placeholder video credit costs", () => {
  it("prices draft and final separately at the default length", () => {
    expect(placeholderCreditCosts(15)).toEqual({ draft: 8, final: 40 });
  });
  it("clamps out-of-range durations to the supported endpoints", () => {
    expect(placeholderCreditCosts(0)).toEqual({ draft: 2, final: 11 });
    expect(placeholderCreditCosts(90)).toEqual({ draft: 15, final: 80 });
  });
});

describe("browser-only video files", () => {
  it.each<[MediaKind, number]>([["photo", 30], ["clip", 10], ["audio", 10]])("refuses a %s beyond its own limit of %i", (kind, limit) => {
    expect(canAddFile(assets(kind, limit - 1), kind)).toBe(true);
    expect(canAddFile(assets(kind, limit), kind)).toBe(false);
    expect(canAddFile(assets(kind, limit + 1), kind)).toBe(false);
  });
  it("counts the three media types independently", () => {
    const files = [...assets("photo", 30), ...assets("clip", 9), ...assets("audio", 10)];
    expect(countFiles(files)).toEqual({ photo: 30, clip: 9, audio: 10 });
    expect(canAddFile(files, "photo")).toBe(false);
    expect(canAddFile(files, "clip")).toBe(true);
    expect(canAddFile(files, "audio")).toBe(false);
  });
  it("refuses non-media uploads and classifies links without fetching them", () => {
    expect(fileKind(new File(["text"], "notes.txt", { type: "text/plain" }))).toBeNull();
    expect(fileKind(new File([], "clip.webm", { type: "video/webm" }))).toBe("clip");
    expect(urlKind(new URL("https://example.com/clip.mp4?download=1"))).toBe("clip");
    expect(urlKind(new URL("https://example.com/music.mp3#intro"))).toBe("audio");
  });
});
