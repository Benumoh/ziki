// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The issue page's stage panels: bids with their votes and the Award control only where it may be used, confirmations and their banner, and judgements and merge reviews with their replies. */
const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  requireUser: vi.fn(),
  currentTenantIdFor: vi.fn(),
  findRedesign: vi.fn(),
}));
vi.mock("@/app/actions/issues", () => ({ addCommentAction: mocks.addComment }));
vi.mock("@/app/actions/issue-bids", () => ({ awardIssueBidAction: vi.fn() }));
vi.mock("@/app/actions/confirmations", () => ({ giveConfirmationAction: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantIdFor: mocks.currentTenantIdFor }));
vi.mock("@/lib/prisma", () => ({ prisma: { redesignProposal: { findFirst: mocks.findRedesign } } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("Not found"); },
}));

import { MergeReviewsPanel, TestVerdictsPanel, type MergeReviewView, type TestVerdictView } from "@/components/issue-review-entries";
import { IssueBidsPanel, type BidEntryView } from "@/components/issue-bids";
import { IssueConfirmationsPanel, type ConfirmationEntryView, type ConfirmationsData } from "@/components/issue-confirmations";
import RedesignPage from "@/app/(app)/redesigns/[id]/page";
import { BASE_PATH } from "@/lib/base-path";

const PR = "https://github.com/emerjent/ziki/pull/42";

const verdict: TestVerdictView = {
  id: "tv1",
  agentName: "Bob's Claude",
  by: "Bob",
  goodToMerge: false,
  summary: "Not good to merge: Save still fails.",
  description: "Clicked Save twice on the PR head in Safari; the second click does nothing.",
  pullRequestUrl: PR,
  headSha: "abc1234def",
  current: true,
  updatedAt: new Date("2026-10-29T10:00:00Z"),
  replies: [{ id: "r1", body: "Which Safari version?", authorName: "Ada", agentName: null, createdAt: new Date("2026-10-29T11:00:00Z") }],
};

const review: MergeReviewView = {
  id: "mr1",
  agentName: "Dana's Claude",
  by: "Dana",
  verdict: "accept",
  summary: "Accept: small and tested.",
  description: "Two independent testers verified the head commit.",
  pullRequestUrl: PR,
  headSha: "0123456789",
  current: false,
  updatedAt: new Date("2026-10-29T12:00:00Z"),
  replies: [],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RedesignPage linked proposal decisions (#595)", () => {
  it("lets a workspace admin reject a pending proposal linked to a blocked issue", async () => {
    mocks.requireUser.mockResolvedValue({ id: "admin" });
    mocks.currentTenantIdFor.mockResolvedValue("tenant-acme");
    mocks.findRedesign.mockResolvedValue({
      id: "proposal-1",
      title: "Try a clearer issue layout",
      body: "Move the issue metadata into a compact sidebar.",
      status: "proposed",
      bugId: "issue-1",
      approvedAt: null,
      authorAgent: { name: "Design Agent" },
      onBehalfOf: { name: "Admin" },
      approver: null,
      bug: { number: 595, project: { slug: "ziki" } },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const page = await RedesignPage({ params: Promise.resolve({ id: "proposal-1" }) });
    render(page);

    const reject = screen.getByRole("button", { name: "Reject" });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.setup().click(reject);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_PATH}/api/v1/redesigns/proposal-1/decision`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "rejected" }) }),
    ));
  });
});

describe("TestVerdictsPanel (#review-entries)", () => {
  it("shows each verdict's chip, agent, owner, summary, description, pull request and replies", () => {
    render(<TestVerdictsPanel bugId="bug1" verdicts={[verdict]} canReply />);
    expect(screen.getByRole("heading", { name: /Judgements/ })).toBeInTheDocument();
    expect(screen.getByText("Not good to merge")).toBeInTheDocument();
    expect(screen.getByText("Bob's Claude")).toBeInTheDocument();
    expect(screen.getByText("for Bob")).toBeInTheDocument();
    expect(screen.getByText(verdict.summary)).toBeInTheDocument();
    expect(screen.getByText(verdict.description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #42" })).toHaveAttribute("href", PR);
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
    expect(screen.getByText("Which Safari version?")).toBeInTheDocument();
    expect(screen.queryByText("Earlier code")).toBeNull();
  });

  it("replies to a verdict with a plain comment naming it", async () => {
    mocks.addComment.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TestVerdictsPanel bugId="bug1" verdicts={[verdict]} canReply />);
    await user.click(screen.getByRole("button", { name: "Reply" }));
    const form = screen.getByRole("form", { name: "Reply to this judgement" });
    await user.type(form.querySelector("textarea")!, "Safari 18.");
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    const [bugId, data] = mocks.addComment.mock.calls[0] as [string, FormData];
    expect(bugId).toBe("bug1");
    expect(data.get("testVerdictId")).toBe("tv1");
    expect(data.get("body")).toBe("Safari 18.");
    expect(data.get("type")).toBeNull();
  });
});

describe("MergeReviewsPanel (#review-entries)", () => {
  it("shows the manager's accept, marks a review of earlier code, and replies by mergeReviewId", async () => {
    mocks.addComment.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MergeReviewsPanel bugId="bug1" reviews={[review]} canReply />);
    expect(screen.getByRole("heading", { name: /Merge reviews/ })).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dana's Claude")).toBeInTheDocument();
    expect(screen.getByText("Earlier code")).toBeInTheDocument();
    expect(screen.getByText(review.summary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reply" }));
    const form = screen.getByRole("form", { name: "Reply to this merge review" });
    await user.type(form.querySelector("textarea")!, "Thanks.");
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    expect((mocks.addComment.mock.calls[0][1] as FormData).get("mergeReviewId")).toBe("mr1");
  });
});

const bid: BidEntryView = {
  id: "bid1",
  agentName: "Ada's Claude",
  by: "Ada",
  summary: "I can fix the login redirect today.",
  description: "The session cookie is dropped on redirect. I will keep it and add a test.",
  areaMatch: true,
  updatedAt: new Date("2026-10-29T10:00:00Z"),
  replies: [{ id: "r1", body: "Please add a regression test.", authorName: "Cara", agentName: null, createdAt: new Date("2026-10-29T11:00:00Z") }],
};


describe("IssueBidsPanel (#issue-bids)", () => {

  it("is one compact card past Open, collapsed, naming the awarded bid, and expands to the bids without Award", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <IssueBidsPanel
        bids={[{ ...bid, awardedAt: new Date("2026-10-29T12:00:00Z") }, { ...bid, id: "bid2", agentName: "Bob's agent" }]}
        collapsed
      />,
    );
    const card = screen.getByTestId("bids");
    const fold = card.querySelector("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(card).toHaveTextContent(/Ada's Claude/);
    await user.click(screen.getByText(/Awarded to Ada's Claude/));
    expect(fold).toHaveAttribute("open");
    expect(screen.getByText("Bob's agent")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Award bid" })).toBeNull();
  });

  it("shows each open bid's votes, and no Award button to a viewer who can't award", () => {
    render(<IssueBidsPanel bids={[{ ...bid, votes: 3 }, { ...bid, id: "bid2", agentName: "Bob's agent", votes: 1 }, { ...bid, id: "bid3", agentName: "Cara's agent" }]} />);
    expect(screen.getAllByTestId("bid-votes").map((votes) => votes.textContent?.match(/\d+/)?.[0])).toEqual(["3", "1", "0"]);
    expect(screen.queryByRole("button", { name: /Award/ })).toBeNull();
  });

  it("offers Award on every open bid, whatever its votes, and only to a viewer who can award (#open-award)", () => {
    const at = new Date("2026-10-29T12:00:00Z");
    const bids: BidEntryView[] = [
      { ...bid, id: "open1", agentName: "Open agent", votes: 3 },
      { ...bid, id: "open2", agentName: "Second agent", votes: 4 },
      { ...bid, id: "below1", agentName: "Short agent", votes: 2 },
      { ...bid, id: "withdrawn1", agentName: "Withdrawn agent", withdrawnAt: at, votes: 3 },
      { ...bid, id: "released1", agentName: "Released agent", awardedAt: at, awardReleasedAt: at, votes: 3 },
    ];
    const { unmount } = render(<IssueBidsPanel bids={bids} canAward awardThreshold={3} />);
    const buttons = screen.getAllByRole("button", { name: /Award/ });
    expect(buttons).toHaveLength(3);
    const awardedIds = buttons.map((button) => (button.closest("form")?.querySelector("input[name=bidId]") as HTMLInputElement | null)?.value);
    // Every open bid, the most voted first; the one below the old threshold too.
    expect(awardedIds).toEqual(["open2", "open1", "below1"]);
    expect(screen.getByTestId("bid-withdrawn").querySelector("button")).toBeNull();
    expect(screen.getByTestId("bid-released").querySelector("button")).toBeNull();
    unmount();

    render(<IssueBidsPanel bids={bids} awardThreshold={3} />);
    expect(screen.queryByRole("button", { name: /Award/ })).toBeNull();
  });

  it("marks an open bid whose bidder is at capacity, and offers no Award button for it (#bidder-capacity)", () => {
    render(<IssueBidsPanel bids={[{ ...bid, id: "full", agentName: "Pixel", atCapacity: true, votes: 3 }, { ...bid, id: "free", agentName: "Cara's agent", votes: 3 }]} canAward awardThreshold={3} />);
    const marks = screen.getAllByTestId("bid-at-capacity");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("at capacity");
    expect(marks[0].closest("li")).toHaveTextContent("Pixel");
    const buttons = screen.getAllByRole("button", { name: /Award/ });
    expect(buttons.map((button) => (button.closest("form")?.querySelector("input[name=bidId]") as HTMLInputElement | null)?.value)).toEqual(["free"]);
  });

});

const entry = (id: string, by: string, at: string): ConfirmationEntryView => ({
  id,
  verdict: "confirm",
  summary: `${by} reproduced it.`,
  description: `${by}'s steps and what happened.`,
  duplicateOf: null,
  onBehalfOfUserId: `user-${id}`,
  by,
  agentName: null,
  counted: true,
  undone: false,
  updatedAt: new Date(at),
  replies: [],
});

const data: ConfirmationsData = {
  confirmations: 2,
  confirmationsNeeded: 2,
  entries: [entry("c1", "Ada", "2026-10-28T10:00:00Z"), entry("c2", "Bob", "2026-10-28T11:00:00Z")],
};


describe("IssueConfirmationsPanel past Requires confirmation", () => {
  it("is one compact card, collapsed, with who confirmed it, and expands to the entries", async () => {
    const user = userEvent.setup({ delay: null });
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} history confirmed />);
    const card = screen.getByTestId("confirmations-collapsed");
    const fold = card.querySelector("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(card).toHaveTextContent(/Ada.*Bob/);
    // No big banner while it is collapsed.
    expect(screen.queryByTestId("confirmation-banner")).toBeNull();
    await user.click(screen.getByText(/Confirmed by/));
    expect(fold).toHaveAttribute("open");
    expect(screen.getByText("Ada reproduced it.")).toBeVisible();
  });

  it("shows the full cards, and no Not confirmed banner, while the issue requires confirmation", () => {
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} confirmed={false} />);
    expect(screen.queryByTestId("confirmations-collapsed")).toBeNull();
    expect(screen.getByText("Ada reproduced it.")).toBeInTheDocument();
    // The next-step bar says what is still needed; the panel has no banner of its own.
    expect(screen.queryByTestId("confirmation-banner")).toBeNull();
    expect(screen.queryByText(/Not confirmed yet/)).toBeNull();
  });

  it("shows the green Confirmed banner, naming who confirmed it, once confirmed", () => {
    render(<IssueConfirmationsPanel bugId="bug1" data={data} viewerId="viewer" block={null} summaryMaxChars={200} confirmed />);
    const banner = screen.getByTestId("confirmation-banner");
    expect(banner).toHaveAttribute("data-confirmed", "true");
    expect(banner).toHaveTextContent(/Ada.*Bob/);
  });
});
