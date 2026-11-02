import { beforeAll, describe, expect, it } from "vitest";
import { confirm, fileIssue, offeredTo, ok, refused, type Agent, ziki } from "./helpers";

type Item = { kind: string; key: string; canAct: boolean; blockedReason?: string; issue?: { id: string }; actions: { name: string; cli: string }[] };

/**
 * Offers only through bids, and any agent may award any bid (#bids-only-offers,
 * #open-award). ada files the issue; bob and cara bid; ada and cara vote for
 * bob's bid as guidance. Every agent sees the issue as an award_bid item with
 * both bids, whatever their votes; ada, a working agent, awards bob's as an
 * offer and bob accepts. Nothing offers the issue on its own.
 */
describe("bids, votes as guidance, and an award by any agent", () => {
  let id: string;
  let bobBid: string;
  let caraBid: string;

  const items = async (agent: Agent) => (await ok(agent, "work")).items as Item[];
  const byKey = async (agent: Agent, key: string) => (await items(agent)).find((item) => item.key === key);

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI bids: the export button is greyed out", ["bob", "cara", "eli"]);
    await confirm(id, ["bob", "cara"]);
  });

  it("takes bids from bob and cara, and offers the issue to nobody on its own", async () => {
    bobBid = (await ok("bob", "bid", { id, summary: "I can fix the export button.", description: "The button's disabled state never clears after a failed export; I will reset it and add a test." })).bid_id;
    caraBid = (await ok("cara", "bid", { id, summary: "I can fix it too.", description: "I would rewrite the export state machine." })).bid_id;
    expect(bobBid).toBeTruthy();
    expect(caraBid).toBeTruthy();
    expect(await offeredTo(id)).toBeNull();
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "open", holder: null });
  });

  it("asks agents to vote for each bid, and drops the item once they have", async () => {
    const item = await byKey("ada", `review_bid:${bobBid}`);
    expect(item).toMatchObject({ kind: "review_bid", canAct: true, issue: { id } });
    expect(item!.actions.map((action) => action.cli)).toEqual([`vote-bid --id ${bobBid}`]);
    expect(await ok("ada", "vote-bid", { id: bobBid })).toMatchObject({ bidId: bobBid, votes: 1, threshold: 3, awarded: false });
    // Voting again is fine and counts once.
    expect(await ok("ada", "vote-bid", { id: bobBid })).toMatchObject({ bidId: bobBid, votes: 1, awarded: false });
    expect(await byKey("ada", `review_bid:${bobBid}`)).toBeUndefined();
    expect(await byKey("ada", `review_bid:${caraBid}`)).toBeTruthy();
    // cara bids too, and may still vote for bob's bid.
    expect(await ok("cara", "vote-bid", { id: bobBid })).toMatchObject({ bidId: bobBid, votes: 2, threshold: 3, awarded: false });
    const listed = (await ok("ada", "list-bids", { id })).bids as { id: string; votes: number }[];
    expect(listed.find((bid) => bid.id === bobBid)?.votes).toBe(2);
  });

  it("refuses a working agent's vote for its own owner's bid", async () => {
    expect((await refused("bob", "vote-bid", { id: bobBid }, 403)).error).toBe("own_bid");
    expect(await byKey("bob", `review_bid:${bobBid}`)).toBeUndefined();
  });

  it("counts a manager's vote 3, still only guidance", async () => {
    expect(await byKey("dana", `review_bid:${bobBid}`)).toMatchObject({ kind: "review_bid", canAct: true });
    expect(await ok("dana", "vote-bid", { id: bobBid })).toMatchObject({ bidId: bobBid, votes: 5, awarded: false });
  });

  it("lists the award for every agent, with every bid, the most voted first", async () => {
    for (const agent of ["ada", "cara", "dana", "eli"] as const) {
      const item = await byKey(agent, `award_bid:${id}`);
      expect(item, `${agent} sees the award`).toMatchObject({ kind: "award_bid", canAct: true, minimumRole: "working" });
      expect(item!.actions.map((action) => action.cli)).toEqual([`award-bid --id ${bobBid}`, `award-bid --id ${caraBid}`]);
    }
    expect(await offeredTo(id)).toBeNull();
  });

  it("is awarded by ada, a working agent, as an offer: the issue stays Open until bob accepts", async () => {
    const awarded = await ok("ada", "award-bid", { id: bobBid });
    expect(awarded).toMatchObject({ bidId: bobBid, bugId: id, status: "offered" });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({
      status: "open",
      holder: { status: "offered", via: "bid", agentName: "bob" },
    });
    // One award at a time.
    await refused("dana", "award-bid", { id: caraBid }, 409);

    const offer = await byKey("bob", `offer:${awarded.claimId}`);
    expect(offer?.issue?.id).toBe(id);
    expect(offer?.actions[0].cli).toBe(`accept-offer --id ${awarded.claimId}`);
    const bobIdentity = await ziki("request", "GET", "/api/v1/agents/me", "--as", "bob");
    const otherBobIdentity = await ziki("request", "GET", "/api/v1/agents/me", "--as", "bob-alt");
    const bobInbox = await ok("bob", "read-inbox");
    const inboxOffer = (bobInbox.items as { eventType: string; payload: { claimId?: string }; agentId?: string; expired?: boolean }[])
      .find((item) => item.eventType === "claim.offered" && item.payload.claimId === awarded.claimId);
    expect(inboxOffer).toMatchObject({ agentId: bobIdentity.json.id, expired: false });
    expect(otherBobIdentity.json.owner_id).toBe(bobIdentity.json.owner_id);
    expect(otherBobIdentity.json.id).not.toBe(bobIdentity.json.id);
    const otherInbox = await ok("bob-alt", "read-inbox");
    expect((otherInbox.items as { payload: { claimId?: string } }[]).some((item) => item.payload.claimId === awarded.claimId)).toBe(false);
    const accepted = await ok("bob", "accept-offer", { id: awarded.claimId });
    expect(accepted.claim.status).toBe("active");
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "in_progress", holder: { status: "active", via: "bid", agentName: "bob" } });
  });

  it("withdraws the other bids once the offer is accepted", async () => {
    const open = (await ok("ada", "list-bids", { id })).bids as { id: string }[];
    expect(open.map((bid) => bid.id)).not.toContain(caraBid);
    expect(await byKey("eli", `review_bid:${caraBid}`)).toBeUndefined();
    // bob is done with it, so it goes back to Open for bids.
    expect(await ok("bob", "release-claim", { id, reason: "Done testing bids." })).toMatchObject({ reopened: true });
  });
});

/**
 * An agent may award its own owner's bid, an offer to itself (#open-award):
 * dana bids and awards it with no votes on it, then accepts it.
 */
describe("an agent awards its own owner's bid", () => {
  let id: string;
  let danaBid: string;

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI bids: a manager's own bid", ["bob", "cara", "eli"]);
    await confirm(id, ["bob", "cara"]);
    danaBid = (await ok("dana", "bid", { id, summary: "I will fix it myself.", description: "A one-line fix to the export handler, with a test." })).bid_id;
  });

  it("is awarded with no votes on it, and accepted", async () => {
    const awarded = await ok("dana", "award-bid", { id: danaBid });
    expect(awarded).toMatchObject({ bidId: danaBid, bugId: id, status: "offered" });
    const accepted = await ok("dana", "accept-offer", { id: awarded.claimId });
    expect(accepted.claim.status).toBe("active");
    expect(await ok("dana", "release-claim", { id, reason: "Done testing a manager's own award." })).toMatchObject({ reopened: true });
  });
});
