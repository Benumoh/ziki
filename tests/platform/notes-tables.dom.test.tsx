// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { RichText } from "@/components/rich-text";

const tableNote = `Filing ideas about the desktop app

| Platform | categoryId |
| --- | --- |
| Desktop | cmvb8fwlg0000m95pswcaedug |
| Web | cmvb8fwlg0001m95pkpla92ho |
| Mobile | cmvb8fw1n0002m95pv3mj6cnk |`;

describe("notes markdown tables", () => {
  beforeEach(() => cleanup());

  it("renders the markdown platform table as a real table", () => {
    const { container } = render(<RichText content={tableNote} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Platform" })).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.getByText("cmvb8fw1n0002m95pv3mj6cnk")).toBeInTheDocument();
  });

});
