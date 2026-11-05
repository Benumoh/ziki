import { describe, expect, it } from "vitest";
import { ok, refused } from "./helpers";

/** A 1×1 PNG, the smallest real picture. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");

type Skill = { tag: string; slug: string; summary: string; description: string };
/** The skills under this run's tag (each sandbox agent also has its own "CLI testing" skill). */
const under = (profile: Profile, slug: string) => profile.skills.filter((skill) => skill.slug === slug);

type Profile = { username: string; tagline: string | null; about: string | null; skills: Skill[]; picture_url: string | null; rating: number | null };

/**
 * Agent profiles (#agent-profile): ada and bob set a username, tagline and
 * About me; a username one of them has is refused to the other; both add a
 * skill under the same tag, which stays one shared tag with each agent's own
 * text; others find ada by username and by tag; a picture must be a real
 * image; and removing a skill or the picture takes it off the profile.
 */
describe("agent profiles", () => {
  const run = Date.now().toString(36);
  const adaName = `ada-${run}`;
  const bobName = `bob-${run}`;
  const tag = `Postgres ${run}`;

  it("sets the username, tagline and About me, and refuses a taken username", async () => {
    const profile = (await ok("ada", "update-profile", {
      username: adaName,
      tagline: "Patient bug hunter",
      about: "I reproduce first, every time.",
    })) as Profile;
    expect(profile).toMatchObject({ username: adaName, tagline: "Patient bug hunter", about: "I reproduce first, every time." });

    await ok("bob", "update-profile", { username: bobName });
    expect((await refused("bob", "update-profile", { username: adaName }, 409)).message).toContain("taken");
    await refused("bob", "update-profile", { username: "pairing" }, 400);

    const me = (await ok("ada", "whoami")) as { profile: Profile };
    expect(me.profile).toMatchObject({ username: adaName, tagline: "Patient bug hunter" });
  });

  it("shares one tag between agents while each keeps its own text", async () => {
    await ok("ada", "set-skill", { tag, summary: "Query plans.", description: "I read EXPLAIN ANALYZE first." });
    await ok("bob", "set-skill", { tag: tag.toLowerCase(), summary: "Safe migrations.", description: "Backfills tested on a copy." });

    const tags = (await ok("ada", "list-skill-tags")) as { tags: Array<{ name: string; slug: string; agents: number }> };
    const shared = tags.tags.filter((t) => t.slug === `postgres-${run}`);
    expect(shared).toEqual([{ name: tag, slug: `postgres-${run}`, agents: 2 }]);

    const ada = (await ok("bob", "get-agent", { username: adaName })) as Profile;
    const bob = (await ok("ada", "get-agent", { username: bobName })) as Profile;
    expect(under(ada, `postgres-${run}`)).toEqual([{ tag, slug: `postgres-${run}`, summary: "Query plans.", description: "I read EXPLAIN ANALYZE first." }]);
    expect(under(bob, `postgres-${run}`)).toEqual([{ tag, slug: `postgres-${run}`, summary: "Safe migrations.", description: "Backfills tested on a copy." }]);

    const withTag = (await ok("cara", "list-agents", { tag: `postgres-${run}` })) as { agents: Profile[] };
    expect(withTag.agents.map((agent) => agent.username).sort()).toEqual([adaName, bobName].sort());
  });

  it("changes a skill's text in place and removes it, leaving the tag for others", async () => {
    await ok("ada", "set-skill", { tag, summary: "Query plans and indexes.", description: "EXPLAIN ANALYZE, then the narrowest index." });
    const ada = (await ok("ada", "get-agent", { username: adaName })) as Profile;
    expect(under(ada, `postgres-${run}`).map((skill) => skill.summary)).toEqual(["Query plans and indexes."]);

    await ok("ada", "remove-skill", { tag });
    expect(under((await ok("ada", "get-agent", { username: adaName })) as Profile, `postgres-${run}`)).toEqual([]);
    await refused("ada", "remove-skill", { tag }, 404);
    expect(under((await ok("bob", "get-agent", { username: bobName })) as Profile, `postgres-${run}`)).toHaveLength(1);
  });

  it("takes a real image as the picture, refuses anything else, and removes it", async () => {
    await refused("ada", "set-picture", { filename: "face.svg", dataBase64: SVG }, 415);
    const set = (await ok("ada", "set-picture", { filename: "face.png", dataBase64: PNG })) as { picture_url: string };
    expect(set.picture_url).toContain(`/api/v1/agents/${adaName}/picture`);
    expect(((await ok("bob", "get-agent", { username: adaName })) as Profile).picture_url).toContain(`/agents/${adaName}/picture`);

    await ok("ada", "remove-picture");
    expect(((await ok("ada", "get-agent", { username: adaName })) as Profile).picture_url).toBeNull();
    await refused("ada", "remove-picture", {}, 404);
  });

  it("answers 404 for a username nobody has", async () => {
    await refused("ada", "get-agent", { username: `nobody-${run}` }, 404);
  });

  it("blocks an agent from working until its profile is set up, but lets it set the profile up", async () => {
    // #agent-work-gate: with no tagline, every work route is refused.
    await ok("cara", "update-profile", { tagline: "" });
    try {
      const blocked = (await refused("cara", "list-projects", {}, 403)) as { error: string; missing: string[] };
      expect(blocked.error).toBe("profile_incomplete");
      expect(blocked.missing).toEqual(["tagline"]);
      // Reading itself still works, and says why it can't work.
      const me = (await ok("cara", "whoami")) as { work_status: { may_work: boolean; missing?: string[] } };
      expect(me.work_status).toMatchObject({ may_work: false, missing: ["tagline"] });
    } finally {
      await ok("cara", "update-profile", { tagline: "cara, the Ziki CLI's test agent" });
    }
    await ok("cara", "list-projects");
    expect(((await ok("cara", "whoami")) as { work_status: { may_work: boolean } }).work_status.may_work).toBe(true);
  });
});
