// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { PointsLedger } from "./points-ledger";
import { parsePointCursorStack, type PointEntriesPage } from "@/lib/points/entries";
import type { DetailedPointEntry, PointLedgerSummary } from "@/lib/points/ledger";

describe("PointsLedger", () => {
  beforeEach(() => cleanup());

  const mockSummary: PointLedgerSummary = {
    totalEarned: 65,
    totalDeductions: 15,
    netPoints: 50,
    entryCount: 3,
  };

  const mockEntries: DetailedPointEntry[] = [
    {
      id: "entry-1",
      points: 40,
      role: "solver",
      sourceKey: "solver:bug-1:user-1",
      correctedAt: null,
      createdAt: new Date("2026-11-01T12:00:00Z"),
      bug: {
        id: "bug-1",
        number: 101,
        title: "Fix authentication redirect loop",
        status: "resolved",
      },
      disputes: [],
    },
    {
      id: "entry-2",
      points: 10,
      role: "reviewer",
      sourceKey: "reviewer:bug-2:user-1",
      correctedAt: null,
      createdAt: new Date("2026-11-02T14:30:00Z"),
      bug: {
        id: "bug-2",
        number: 102,
        title: "Improve avatar upload validation",
        status: "resolved",
      },
      disputes: [],
    },
    {
      id: "entry-3",
      points: -15,
      role: "solver",
      sourceKey: "correction:bug-1:user-1",
      correctedAt: new Date("2026-11-03T10:00:00Z"),
      createdAt: new Date("2026-11-03T10:00:00Z"),
      bug: {
        id: "bug-1",
        number: 101,
        title: "Fix authentication redirect loop",
        status: "resolved",
      },
      disputes: [],
    },
  ];

  const cursor = (id: string) => Buffer.from(JSON.stringify({
    at: "2026-11-01T12:00:00.000Z",
    id,
  })).toString("base64url");

  const page = (nextCursor: string | null): PointEntriesPage => ({
    items: mockEntries.map((entry) => ({
      id: entry.id,
      points: entry.points,
      role: entry.role,
      createdAt: entry.createdAt.toISOString(),
      source: "Point award",
      issue: null,
      idea: null,
    })),
    nextCursor,
  });

  it("validates the cursor stack, including the first-page marker and bounds", () => {
    const olderCursor = cursor("entry-older");
    expect(parsePointCursorStack(["", olderCursor])).toEqual([null, olderCursor]);
    expect(parsePointCursorStack("invalid-cursor")).toBeNull();
    expect(parsePointCursorStack(Array.from({ length: 101 }, () => ""))).toBeNull();
  });

  it("shows the first-page pager with Older enabled and Newer disabled", () => {
    render(
      <PointsLedger
        page={page(cursor("page-2"))}
        profileId="user-1"
        from="2026-11-01"
        to="2026-11-03"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Points history pagination" });
    expect(within(nav).getByText("Newer entries")).toHaveAttribute("aria-disabled", "true");
    const older = within(nav).getByRole("link", { name: "Older entries" });
    const olderUrl = new URL(older.getAttribute("href")!, "https://ziki.dev");
    expect(olderUrl.searchParams.get("cursor")).toBe(cursor("page-2"));
    expect(olderUrl.searchParams.getAll("prev")).toEqual([""]);
    expect(olderUrl.searchParams.get("from")).toBe("2026-11-01");
    expect(olderUrl.searchParams.get("to")).toBe("2026-11-03");
  });

  it("shows both directions on a middle page and preserves its cursor history", () => {
    const pageTwoCursor = cursor("page-2");
    render(
      <PointsLedger
        page={page(cursor("page-3"))}
        profileId="user-1"
        currentCursor={pageTwoCursor}
        previousCursors={[null]}
        from="2026-11-01"
        to="2026-11-03"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Points history pagination" });
    const newerUrl = new URL(within(nav).getByRole("link", { name: "Newer entries" }).getAttribute("href")!, "https://ziki.dev");
    expect(newerUrl.searchParams.has("cursor")).toBe(false);
    expect(newerUrl.searchParams.getAll("prev")).toEqual([]);
    expect(newerUrl.searchParams.get("from")).toBe("2026-11-01");
    expect(newerUrl.searchParams.get("to")).toBe("2026-11-03");

    const olderUrl = new URL(within(nav).getByRole("link", { name: "Older entries" }).getAttribute("href")!, "https://ziki.dev");
    expect(olderUrl.searchParams.get("cursor")).toBe(cursor("page-3"));
    expect(olderUrl.searchParams.getAll("prev")).toEqual(["", pageTwoCursor]);
  });

  it("keeps the pager on the last page with a Newer link and Older disabled", () => {
    const pageTwoCursor = cursor("page-2");
    render(
      <PointsLedger
        page={page(null)}
        profileId="user-1"
        currentCursor={cursor("page-3")}
        previousCursors={[null, pageTwoCursor]}
        from="2026-11-01"
        to="2026-11-03"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Points history pagination" });
    const newerUrl = new URL(within(nav).getByRole("link", { name: "Newer entries" }).getAttribute("href")!, "https://ziki.dev");
    expect(newerUrl.searchParams.get("cursor")).toBe(pageTwoCursor);
    expect(newerUrl.searchParams.getAll("prev")).toEqual([""]);
    expect(newerUrl.searchParams.get("from")).toBe("2026-11-01");
    expect(newerUrl.searchParams.get("to")).toBe("2026-11-03");
    expect(within(nav).getByText("Older entries")).toHaveAttribute("aria-disabled", "true");
  });

  it("renders the summary cards with earned, deductions, and net balance", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} />);
    expect(screen.getByText("+$65")).toBeInTheDocument();
    expect(screen.getAllByText("-$15").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("$ history · Itemized Points Ledger")).toBeInTheDocument();
  });

  it("renders each itemized entry with task details, role badges, and point deltas", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} />);
    expect(screen.getAllByText("#101").length).toBe(2);
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.getAllByText("Fix authentication redirect loop").length).toBe(2);
    expect(screen.getByText("+$40")).toBeInTheDocument();
    expect(screen.getByText("+$10")).toBeInTheDocument();
    expect(screen.getAllByText("-$15").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Corrected")).toBeInTheDocument();
  });

  it("filters entries by role when tabs are clicked", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} />);
    
    // Initial state: shows all 3 entries
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    // Click 'Reviewer' tab
    const reviewerTab = screen.getByRole("tab", { name: "Reviewer" });
    fireEvent.click(reviewerTab);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.queryByText("+$40")).not.toBeInTheDocument();

    // Click 'Adjustments' tab
    const adjustmentsTab = screen.getByRole("tab", { name: "Adjustments" });
    fireEvent.click(adjustmentsTab);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(1);
    expect(within(listItems[0]).getByText("-$15")).toBeInTheDocument();
  });

  it("renders a clean empty state when no entries match or exist", () => {
    render(
      <PointsLedger
        entries={[]}
        summary={{ totalEarned: 0, totalDeductions: 0, netPoints: 0, entryCount: 0 }}
      />
    );
    expect(screen.getByText("No ledger entries found")).toBeInTheDocument();
  });

  it("shows dispute buttons only when canDispute is true and entry is not corrected", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} canDispute={true} />);
    const disputeLinks = screen.getAllByRole("link", { name: "Dispute" });
    expect(disputeLinks).toHaveLength(2);
    expect(disputeLinks[0]).toHaveAttribute(
      "href",
      "/points/disputes/new?bug=101&pointEntryId=entry-1"
    );
  });
});
