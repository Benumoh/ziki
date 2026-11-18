/**
 * Determines whether a note requires progressive disclosure ("Show more details"),
 * extracting a concise 3-4 line sentence preview upfront.
 *
 * If the entire note already fits within the 3-4 line preview and there is no hidden
 * content (no code block, no subsequent paragraphs, no remaining sentences),
 * `hasMore` is false so NO toggle button is rendered.
 */
export function getNotePreview(content: string): {
  preview: string;
  hasMore: boolean;
  hasCode: boolean;
} {
  const trimmed = content.trim();
  const hasCode = /```|~~~/.test(trimmed);

  // If there is a code block, the code block is hidden behind the toggle.
  if (hasCode) {
    const codeIndex = trimmed.search(/```|~~~/);
    const beforeCode = trimmed.slice(0, codeIndex).trim();
    // In the text before code, take the first 3-4 lines or first paragraph
    const paragraphs = beforeCode.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const lead = paragraphs[0]?.trim() || beforeCode;
    return {
      preview: lead || beforeCode || trimmed.slice(0, 200),
      hasMore: true,
      hasCode: true,
    };
  }

  // Split into paragraphs
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  // If there are multiple paragraphs, the first paragraph (3-4 lines) is shown upfront
  // and the remaining paragraphs are hidden.
  if (paragraphs.length > 1) {
    return {
      preview: paragraphs[0].trim(),
      hasMore: true,
      hasCode: false,
    };
  }

  // Single paragraph: check lines
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 3) {
    return {
      preview: lines.slice(0, 3).join("\n").trim(),
      hasMore: true,
      hasCode: false,
    };
  }

  // Single paragraph, <= 3 newlines:
  // Check text length. Standard 3-4 lines in English is ~260-300 characters.
  if (trimmed.length > 280) {
    // Look for a sentence boundary (.!?) around 200-280 chars
    const candidate = trimmed.slice(0, 280);
    const sentenceMatches = [...candidate.matchAll(/([.!?])(?:\s+|$)/g)];
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1];
      if (lastMatch && lastMatch.index !== undefined && lastMatch.index >= 80) {
        const cut = lastMatch.index + 1;
        const preview = trimmed.slice(0, cut).trim();
        if (preview.length < trimmed.length) {
          return {
            preview,
            hasMore: true,
            hasCode: false,
          };
        }
      }
    }

    // If no clean sentence break but text is significantly long (> 320 chars):
    if (trimmed.length > 320) {
      const lastSpace = trimmed.lastIndexOf(" ", 260);
      const cut = lastSpace > 120 ? lastSpace : 260;
      return {
        preview: trimmed.slice(0, cut).trim() + "…",
        hasMore: true,
        hasCode: false,
      };
    }
  }

  // Entire note fits in 3-4 lines with NO extra details!
  // hasMore is false -> DO NOT add "Show more details" where there is no see more.
  return {
    preview: trimmed,
    hasMore: false,
    hasCode: false,
  };
}
