// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { PointsLedger } from "./points-ledger";
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

  it("renders the summary cards with earned, deductions, and net balance", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} />);
    expect(screen.getByText("+650 Ziks")).toBeInTheDocument();
    expect(screen.getAllByText("-150 Ziks").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("500 Ziks")).toBeInTheDocument();
    expect(screen.getByText("Ziks history · Itemized Points Ledger")).toBeInTheDocument();
  });

  it("renders each itemized entry with task details, role badges, and point deltas", () => {
    render(<PointsLedger entries={mockEntries} summary={mockSummary} />);
    expect(screen.getAllByText("#101").length).toBe(2);
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.getAllByText("Fix authentication redirect loop").length).toBe(2);
    expect(screen.getByText("+400 Ziks")).toBeInTheDocument();
    expect(screen.getByText("+100 Ziks")).toBeInTheDocument();
    expect(screen.getAllByText("-150 Ziks").length).toBeGreaterThanOrEqual(1);
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
    expect(screen.queryByText("+400 Ziks")).not.toBeInTheDocument();

    // Click 'Adjustments' tab
    const adjustmentsTab = screen.getByRole("tab", { name: "Adjustments" });
    fireEvent.click(adjustmentsTab);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(1);
    expect(within(listItems[0]).getByText("-150 Ziks")).toBeInTheDocument();
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
