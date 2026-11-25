// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { loginAction } from "@/app/actions/auth";
import { LoginForm } from "@/components/login-form";
import { SignInMethods } from "@/components/sign-in-methods";
import { PairForm } from "@/app/(app)/settings/agents/pair/pair-form";

vi.mock("@/app/(app)/settings/security/actions", () => ({ beginGoogleSecurityAction: vi.fn() }));

const pairAgentAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/settings/agents/actions", () => ({ pairAgentAction }));

vi.mock("@/lib/auth-mode", () => ({
  isPasswordAuthEnabled: () => false,
}));

vi.mock("@/lib/google-oauth", () => ({
  isGoogleOAuthConfigured: () => true,
}));

vi.mock("@/app/actions/auth", () => ({
  googleSignInAction: vi.fn(),
  addPasswordAction: vi.fn(),
  connectGoogleAction: vi.fn(),
  loginAction: vi.fn(),
}));

// Auth split frame mounts ThemeToggle; keep the page unit test free of
// settings/auth action side effects and next/image in jsdom.
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () =>
    createElement("button", {
      type: "button",
      "aria-label": "Switch to dark mode",
      "data-testid": "theme-toggle",
    }),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Signing in and pairing an agent: sign-in errors are announced without echoing link text, the code step appears only when needed, and pairing keeps the owner's edits. */
describe("LoginPage OAuth error a11y (#653)", () => {
  it("announces OAuth failure with role='alert', aria-live='assertive' and aria-atomic='true'", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "OAuthCallbackError" }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
  });

  it("never renders ?reason= text, so a crafted link cannot put words in the alert (#118, #558)", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({
        error: "OAuthCallbackError",
        reason: "Your account is locked. Call +1 555 0100 to unlock it.",
      } as { error: string }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toContain("locked");
    expect(alert.textContent).not.toContain("Diagnostic");
  });

  it("renders expired session status when expired parameter is present without error", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ expired: "1" }),
    });
    render(element);

    expect(screen.queryByRole("alert")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
  });
});

describe("the sign-in form's code step (#648)", () => {
  it("asks for the code only once the password is accepted, then sends it with the sign-in", async () => {
    const login = vi.mocked(loginAction);
    login.mockReset();
    const user = userEvent.setup({ delay: null });
    render(<LoginForm />);
    expect(screen.queryByLabelText("Authentication code")).toBeNull();
    login.mockResolvedValueOnce({ error: "Enter the code from your authenticator app.", needsCode: true });
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const field = await screen.findByLabelText("Authentication code");

    login.mockResolvedValueOnce(undefined);
    await user.type(field, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    const sent = login.mock.calls[1][1] as FormData;
    expect(sent.get("email")).toBe("ada@example.com");
    expect(sent.get("totp")).toBe("123456");
  });
});

describe("pairing an agent (#431)", () => {
  const renderForm = (instructions: string | null) =>
    render(
      <PairForm
        initialCode="ABCD-2345"
        pending={{ name: "Ada's Claude", model: "Claude", level: "working", instructions }}
        unknownCode={false}
        organisationName="Ziki"
        instructionsMaxLength={4000}
      />,
    );

  it("keeps the owner's edit after a failed approval, and resubmits it rather than the agent's proposal", async () => {
    pairAgentAction.mockReset();
    pairAgentAction.mockResolvedValue({ ok: false, error: "Open an organisation first." });
    renderForm("Focus on desktop bugs.");
    fireEvent.change(screen.getByLabelText(/Standing instructions/), { target: { value: "Owner-edited brief." } });
    // #agent-work-mode: the owner must choose how it works before it can be approved.
    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    expect(pairAgentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Ask me first/ }));
    fireEvent.change(screen.getByLabelText("Max tasks at once"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    await screen.findByText("Open an organisation first.");
    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    await waitFor(() => expect(pairAgentAction).toHaveBeenCalledTimes(2));
    const resubmitted = pairAgentAction.mock.calls[1][1] as FormData;
    expect(resubmitted.get("instructions")).toBe("Owner-edited brief.");
    expect(resubmitted.get("workMode")).toBe("ask_first");
    expect(resubmitted.get("maxActiveTasks")).toBe("2");
  });

  it("formats the pairing code and won't continue until it is valid", () => {
    render(<PairForm initialCode="" pending={null} unknownCode={false} organisationName="Ziki" instructionsMaxLength={4000} />);
    const input = screen.getByLabelText(/Pairing code/) as HTMLInputElement;
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "abcd2345" } });
    expect(input.value).toBe("ABCD-2345");
  });
});

describe("adding a password within Settings", () => {
  const methods = { hasPassword: false, googleLinked: true, googleConfigured: true, passwordEnabled: true, twoFactorEnabled: false, email: "a@x.dev" };

  it("expands password and confirmation fields on click and clears them when cancelled", async () => {
    const user = userEvent.setup();
    render(<SignInMethods {...methods} passwordVerified />);
    expect(screen.queryByLabelText("New password", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a password" }));
    await user.type(screen.getByLabelText("New password", { exact: true }), "NewPassw0rd!");
    await user.type(screen.getByLabelText("Confirm password", { exact: true }), "NewPassw0rd!");
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Add a password" }));
    expect(screen.getByLabelText("New password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Confirm password", { exact: true })).toHaveValue("");
  });

  it("shows the fields but asks for Google verification before an older session can save", async () => {
    const user = userEvent.setup();
    render(<SignInMethods {...methods} />);
    await user.click(screen.getByRole("button", { name: "Add a password" }));
    expect(screen.getByLabelText("New password", { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save password" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify with Google" })).toBeEnabled();
  });
});
