// @vitest-environment jsdom
"use client";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { unstable_rethrow } from "next/navigation";
import { createBugAction } from "@/app/actions/issues";
import { CreateBugForm } from "@/components/create-issue-form";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  unstable_rethrow: vi.fn(),
  useRouter: () => ({ back: vi.fn() }),
}));

const issueTypes = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { issueType: issueTypes } }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  unstable_cache: <T,>(read: T) => read,
}));

vi.mock("@/app/actions/issues", () => ({
  createBugAction: vi.fn(),
}));

/** Reporting an issue: a valid report is submitted, a failure shows the error and keeps what was typed, and nothing is sent while a file is still uploading. */
const mockedCreateBug = vi.mocked(createBugAction);
const mockedRethrow = vi.mocked(unstable_rethrow);

// Set by tests that defer the mocked action's resolution; always released in
// afterEach so a failed assertion cannot leak a pending transition.
let releasePendingAction: (() => void) | null = null;

afterEach(() => {
  releasePendingAction?.();
  releasePendingAction = null;
  cleanup();
});

const defaultProps = {
  users: [{ id: "u1", name: "Alice", role: "user" as const }],
  types: [{ id: "t1", name: "Bug" }, { id: "t2", name: "Feature" }],
  isAdmin: false,
  projectSlug: "acme",
} as Parameters<typeof CreateBugForm>[0];

let capturedFormData: FormData | null = null;

function renderForm(props: Parameters<typeof CreateBugForm>[0] = defaultProps) {
  return render(<CreateBugForm {...props} />);
}

function titleInput() {
  return screen.getByLabelText("Title") as HTMLInputElement;
}

function descriptionTextarea() {
  // The MarkdownEditor gives the mention combobox wrapper the same accessible
  // name as the textarea ("Description"), so getByLabelText matches twice.
  // Query by role to pin the actual text field (#326).
  return screen.getByRole("textbox", {
    name: "Description",
  }) as HTMLTextAreaElement;
}

function submitButton() {
  return screen.getByRole("button", {
    name: /^(Create issue|Creating…|Uploading…)$/,
  }) as HTMLButtonElement;
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(titleInput(), "App crashes on launch");
  await user.type(
    descriptionTextarea(),
    "Steps to reproduce: it crashes every time.",
  );
}

describe("CreateBugForm optimistic submission", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    capturedFormData = null;
    mockedCreateBug.mockReset();
    mockedCreateBug.mockResolvedValue({ ok: true });
    mockedRethrow.mockClear();
    user = userEvent.setup({ delay: null });
  });

  it("submits the form and enables the button once the action resolves", async () => {
    // Hold the action open until the test releases it so the pending state
    // ("Creating…"/disabled) is observable instead of racing the assertion.
    mockedCreateBug.mockImplementationOnce((formData) => {
      capturedFormData = formData;
      return new Promise((resolve) => {
        releasePendingAction = () => resolve({ ok: true });
      });
    });

    renderForm();
    await fillValidForm(user);

    await user.click(submitButton());
    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
      expect(submitButton().disabled).toBe(true);
    });

    releasePendingAction?.();
    releasePendingAction = null;

    await waitFor(() => expect(submitButton().disabled).toBe(false), { timeout: 5000 });

    expect(capturedFormData?.get("title")).toBe("App crashes on launch");
    expect(capturedFormData?.get("description")).toBe(
      "Steps to reproduce: it crashes every time.",
    );
    // Default type is the first option ("Bug").
    expect(capturedFormData?.get("typeId")).toBe("t1");
    expect(capturedFormData?.get("proofLinks")).toBe("");

    expect(screen.queryByRole("alert")).toBeNull();
  }, 15000);

  it("shows the server error and preserves the form values on failure", async () => {
    mockedCreateBug.mockResolvedValueOnce({
      error: "Something went wrong. Please try again.",
    });

    renderForm();
    await fillValidForm(user);

    await user.click(submitButton());

    // Error surfaced and the button settled back to its idle state.
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Something went wrong. Please try again.",
      );
      expect(submitButton().disabled).toBe(false);
    }, { timeout: 5000 });

    expect(titleInput().value).toBe("App crashes on launch");
  }, 15000);

  it("disables submit button and prevents submission while an attachment is uploading (#734)", async () => {
    // The file input lives inside its label. user.upload clicks that input, and
    // the label can open the dialog again, so more than one request may be in
    // flight. Resolving only the last one leaves the button disabled.
    const finishUpload: Array<() => void> = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload.push(() =>
            resolve({
              ok: true,
              json: async () => ({ id: "att-456", size: 4096 }),
            }),
          );
        }),
    );

    mockedCreateBug.mockImplementationOnce((formData) => {
      capturedFormData = formData;
      return Promise.resolve({ ok: true });
    });

    try {
      const { container } = renderForm();
      await fillValidForm(user);

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(fileInput).toBeTruthy();

      const file = new File(["content"], "diag.png", { type: "image/png" });
      await user.upload(fileInput, file);

      // Submit button should be disabled and show Uploading…
      await waitFor(() => {
        expect(submitButton().disabled).toBe(true);
      });

      // Attempting to submit form while uploading should be prevented
      const form = container.querySelector("form") as HTMLFormElement;
      form.requestSubmit();
      expect(mockedCreateBug).not.toHaveBeenCalled();

      // Resolve every upload started by the dialog.
      finishUpload.splice(0).forEach((finish) => finish());

      // Button becomes enabled
      await waitFor(() => {
        expect(submitButton().disabled).toBe(false);
      });

      // Submit should now succeed with attachment included
      await user.click(submitButton());
      await waitFor(() => expect(mockedCreateBug).toHaveBeenCalledTimes(1));

      expect(String(capturedFormData?.get("attachmentIds"))).toContain("att-456");
    } finally {
      global.fetch = originalFetch;
    }
  }, 15000);

});

describe("CreateBugForm project-scoped drafts (#729)", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
    });
    mockedCreateBug.mockReset();
    mockedCreateBug.mockResolvedValue({ ok: true });
    user = userEvent.setup({ delay: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the project draft when creation fails", async () => {
    mockedCreateBug.mockResolvedValueOnce({ error: "Could not create issue." });
    renderForm({ ...defaultProps, currentUserId: "u1", projectId: "project-a" });

    await fillValidForm(user);
    await waitFor(() => {
      expect(mockStorage["draft:u1:bug:new:project-a"]).toBeDefined();
    });

    await user.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    expect(mockStorage["draft:u1:bug:new:project-a"]).toBeDefined();
  }, 15000);
});

describe("CreateBugForm quick report in a modal (#report-modal)", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockedCreateBug.mockReset();
    mockedCreateBug.mockResolvedValue({ ok: true });
    capturedFormData = null;
    window.localStorage.clear();
    user = userEvent.setup({ delay: null });
  });

  function renderModal(extra: Partial<Parameters<typeof CreateBugForm>[0]> = {}) {
    return render(<CreateBugForm {...defaultProps} variant="modal" {...extra} />);
  }

  it("sends a report with the page it came from, unless removed", async () => {
    mockedCreateBug.mockImplementation((formData) => {
      capturedFormData = formData;
      return Promise.resolve({ ok: true });
    });
    renderModal({ reportedFrom: "/issues/42" });
    await user.type(screen.getByRole("textbox", { name: "What happened?" }), "The save button does nothing on Safari.");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(mockedCreateBug).toHaveBeenCalledTimes(1));
    expect(capturedFormData?.get("isReport")).toBe("true");
    expect(capturedFormData?.get("description")).toBe(
      "The save button does nothing on Safari.\n\nReported from: /issues/42",
    );
  });

});

describe("marketing task types and the report form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers only product types", async () => {
    issueTypes.findMany.mockResolvedValue([{ id: "fix", name: "Fix", isActive: true }]);
    const { getIssueTypes } = await import("@/lib/lookups");
    await getIssueTypes("t1");
    expect(issueTypes.findMany.mock.calls[0][0].where).toEqual({ organisationId: "t1", track: "product" });
  }, 15000);

  it("still sets up the product types in an organisation that only has marketing types", async () => {
    issueTypes.count.mockImplementation(async ({ where }: { where: { track?: string } }) => (where.track === "product" ? 0 : 4));
    const { ensureDefaultIssueTypes } = await import("@/lib/issue-types");
    await ensureDefaultIssueTypes("t1");
    expect(issueTypes.upsert).toHaveBeenCalled();
  }, 15000);

});
