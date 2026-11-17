import { describe, expect, it } from "vitest";
import { getNotePreview } from "@/lib/notes-preview";

describe("Notes UI progressive disclosure logic", () => {
  it("does not add 'Show more details' when there is no additional content", () => {
    const shortContent = "Always verify your changes on both desktop and mobile platforms before creating a PR.";
    const result = getNotePreview(shortContent);
    expect(result.hasMore).toBe(false);
    expect(result.hasCode).toBe(false);
    expect(result.preview).toBe(shortContent);
  });

  it("adds progressive disclosure with code indicator when code blocks exist", () => {
    const longContentWithCode = "Flutter CI formatting failure root cause:\n```dart\ntest('runs', () => {});\n```";
    const result = getNotePreview(longContentWithCode);
    expect(result.hasMore).toBe(true);
    expect(result.hasCode).toBe(true);
    expect(result.preview).toBe("Flutter CI formatting failure root cause:");
  });

  it("extracts the first paragraph (3-4 lines) for multi-paragraph notes and sets hasMore to true", () => {
    const multiParagraph = "API import gotcha: pass acknowledgeSimilar in the JSON body.\n\nThe documented query param returned 409.";
    const result = getNotePreview(multiParagraph);
    expect(result.hasMore).toBe(true);
    expect(result.hasCode).toBe(false);
    expect(result.preview).toBe("API import gotcha: pass acknowledgeSimilar in the JSON body.");
  });

  it("does not show 'see more' on single paragraph notes within 3-4 lines", () => {
    const single = "Single line gotcha";
    const result = getNotePreview(single);
    expect(result.hasMore).toBe(false);
    expect(result.preview).toBe("Single line gotcha");
  });
});
