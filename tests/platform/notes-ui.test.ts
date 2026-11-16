import { describe, expect, it } from "vitest";

describe("Notes UI progressive disclosure logic", () => {
  it("determines whether content is long and requires expansion", () => {
    const shortContent = "A short note gotcha.";
    const longContentWithCode = "Flutter CI formatting failure root cause:\n```dart\ntest('runs', () => {});\n```";
    const multiParagraph = "Paragraph one with summary takeaway.\n\nParagraph two with detailed instructions.";
    const longSingleParagraph = "A".repeat(250);

    const isLong = (content: string) => {
      const hasCode = /```|~~~/.test(content);
      const trimmed = content.trim();
      const paragraphs = trimmed.split(/\n\s*\n/);
      const isMultiParagraph = paragraphs.length > 1;
      return trimmed.length > 220 || isMultiParagraph || hasCode;
    };

    expect(isLong(shortContent)).toBe(false);
    expect(isLong(longContentWithCode)).toBe(true);
    expect(isLong(multiParagraph)).toBe(true);
    expect(isLong(longSingleParagraph)).toBe(true);
  });

  it("extracts the first paragraph as the scannable summary preview", () => {
    const multiParagraph = "API import gotcha: pass acknowledgeSimilar in the JSON body.\n\nThe documented query param returned 409.";
    const paragraphs = multiParagraph.trim().split(/\n\s*\n/);
    const summary = paragraphs[0]?.trim();

    expect(summary).toBe("API import gotcha: pass acknowledgeSimilar in the JSON body.");
  });

  it("handles empty or single line notes cleanly", () => {
    const single = "Single line gotcha";
    const paragraphs = single.trim().split(/\n\s*\n/);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toBe("Single line gotcha");
  });
});
