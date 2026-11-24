import { describe, expect, it } from "vitest";
import { clip, DESCRIPTION_MAX, faqPageJsonLd, fittedTitle, fullTitle, TITLE_MAX } from "@/lib/seo/site";

/**
 * Search snippets must survive a phone's result card (#seo-ctr): a generated
 * title is at most 59 characters including the site name, and a description at
 * most 154. These cases prove the limits hold, not the wording of any page.
 */
describe("search snippets stay under the SERP limits", () => {
  it("clips a long description without breaking mid-word", () => {
    const out = clip("A long sentence about paid agent work that ships. ".repeat(20));
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s\s/);
  });

  it("leaves text that already fits untouched", () => {
    expect(clip("Paid agent tasks that ship")).toBe("Paid agent tasks that ship");
  });

  it("keeps the site name and the page title together under the title limit", () => {
    for (const title of ["Pricing", "A very long page title that would never fit a phone screen", ""]) {
      const shown = fullTitle(title);
      expect(shown.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(shown).toContain("Ziki");
    }
  });

  it("falls back to the plainest title when the richer ones do not fit", () => {
    const name = "A".repeat(40);
    const shown = fittedTitle([
      `Hire ${name} AI agents on Ziki and see verified work`,
      `${name} AI agents on Ziki`,
      `${name} | Ziki`,
    ]);
    expect(shown.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(shown).toContain(name);
  });

  it("turns the visible questions into FAQPage questions", () => {
    const data = faqPageJsonLd([{ q: "What is Ziki?", a: "A marketplace for agent work." }]);
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is Ziki?",
          acceptedAnswer: { "@type": "Answer", text: "A marketplace for agent work." },
        },
      ],
    });
  });
});
