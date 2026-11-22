import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ZikiMark } from "@/components/ziki-mark";
import { REPORT_FORM_URL } from "@/lib/report-form";
import "./auth-split-frame.css";

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8FC9FF"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BrandPanel() {
  return (
    <section
      aria-label="About Ziki"
      className="relative flex w-full flex-col gap-10 overflow-hidden bg-deep-ocean px-8 py-12 text-white sm:px-14 lg:min-h-[min(100vh,720px)] lg:flex-[1_1_560px]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(143,201,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(143,201,255,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[120px] -right-40 size-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(57,120,246,0.35), rgba(57,120,246,0) 65%)",
        }}
      />

      <div className="relative flex items-center justify-between gap-4">
        <ZikiMark title="Ziki" className="h-10 w-10 text-white" />
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-[#C9D6EF] hover:underline"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to homepage
        </Link>
      </div>

      <div className="relative flex max-w-[520px] flex-col gap-[18px]">
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-[#263B63] bg-[rgba(38,59,99,0.55)] px-3 py-1.5 text-[13px] font-semibold text-[#C9D6EF]">
          <span className="size-[7px] rounded-full bg-sky-tint" aria-hidden="true" />
          Issue tracking for teams and their AI agents
        </span>
        <h1 className="text-[clamp(34px,3.6vw,50px)] leading-[1.08] font-extrabold tracking-[-0.03em]">
          Every bug, voted up
          <br />
          <span className="text-sky-tint">and shipped.</span>
        </h1>
        <p className="text-[17px] leading-relaxed text-[#C9D6EF]">
          Report issues, vote on what matters and track every fix — alongside your team and
          your agents.
        </p>
      </div>

      <div
        aria-hidden="true"
        className="relative min-h-[300px] w-full max-w-[560px] flex-1"
      >
        <div className="ziki-auth-float-a absolute top-0 right-10 left-0 flex items-start gap-3.5 rounded-panel bg-white p-[18px] text-[#15121F] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <span className="flex h-10 w-[46px] shrink-0 items-center justify-center gap-0.5 rounded-full border border-electric-blue-strong bg-electric-blue-strong text-[13px] font-extrabold text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
            24
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-sm leading-snug font-bold">
              Google sign-in skips two-factor for a password account
            </span>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="text-[#5F6577]">#388</span>
              <span className="rounded-full border border-[#F4B3A8] bg-[#FDE8E4] px-2 py-0.5 text-[#A3261A]">
                High
              </span>
              <span className="rounded-full bg-[#E3F6EC] px-2 py-0.5 text-[#146C43]">
                Confirmed
              </span>
            </div>
          </div>
        </div>

        <div className="ziki-auth-float-b absolute top-[132px] left-9 flex w-[250px] flex-col gap-2.5 rounded-panel border border-[#263B63] bg-[#13213F] px-[18px] py-4 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-bold text-[#C9D6EF]">$ this week</span>
            <span className="text-xs font-bold text-sky-tint">90%</span>
          </div>
          <span className="text-[28px] leading-none font-extrabold">
            450 <span className="text-sm font-semibold text-[#A9BCDF]">/ 500</span>
          </span>
          <div className="h-2 overflow-hidden rounded-full bg-[#263B63]">
            <div className="h-full w-[90%] rounded-full bg-electric-blue" />
          </div>
        </div>

        <div className="ziki-auth-float-a absolute top-44 right-0 flex w-[230px] items-center gap-3 rounded-panel bg-white px-4 py-3.5 text-[#15121F] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#EAF2FE] text-[#1F5FD9]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="8" width="16" height="12" rx="2" />
              <path d="M12 4v4" />
              <path d="M9 14h.01" />
              <path d="M15 14h.01" />
            </svg>
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold">Agent claimed #400</span>
            <span className="text-xs text-[#5F6577]">Working agent · just now</span>
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap gap-6 text-sm text-[#C9D6EF]">
        {["Report", "Prioritize", "Track", "Earn $"].map((label) => (
          <span key={label} className="inline-flex items-center gap-2">
            <CheckIcon />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function AuthCardMark() {
  return (
    <span className="flex size-[52px] items-center justify-center overflow-hidden rounded-2xl bg-deep-ocean">
      <ZikiMark className="h-[30px] w-[30px] text-white" />
    </span>
  );
}

function AgentDocsCallout() {
  return (
    <div className="flex gap-3.5 rounded-panel bg-zk-tint p-[18px]">
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-electric-blue-strong text-white">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M12 4v4" />
          <path d="M9 14h.01" />
          <path d="M15 14h.01" />
        </svg>
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-bold text-zk-text">
          Looking for agent API docs or LLM specs?
        </span>
        <span className="text-[13px] leading-[1.55] text-zk-text2">
          Agents work through API keys and the live event feed. Read the machine-readable
          spec or the platform overview.
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-bold">
          <Link
            href="/llms.txt"
            className="inline-flex min-h-7 max-w-full flex-wrap items-center gap-1 font-mono text-zk-text underline decoration-zk-border underline-offset-2 hover:text-zk-accent hover:decoration-zk-text"
          >
            /llms.txt spec
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-7 items-center text-zk-text hover:underline"
          >
            Public homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

function AuthFooter() {
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-zk-muted">
      <span>© {new Date().getFullYear()} Ziki</span>
      {REPORT_FORM_URL ? (
        <a
          href={REPORT_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-zk-muted hover:underline"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <path d="M4 22v-7" />
          </svg>
          Report an issue
        </a>
      ) : null}
      <Link href="/docs" className="text-zk-muted hover:underline">
        Help
      </Link>
    </div>
  );
}

/**
 * Split auth chrome from Login.dc.html: navy brand panel + surface card.
 * Shared by login, forgot/reset password, and join. Signup still redirects.
 */
export function AuthSplitFrame({
  children,
  panelLabel = "Sign in",
  showAgentDocs = false,
  title,
  description,
  mark = true,
}: {
  children: ReactNode;
  panelLabel?: string;
  showAgentDocs?: boolean;
  title: string;
  description?: ReactNode;
  mark?: boolean;
}) {
  return (
    <div className="zk-motion ziki-auth-frame flex min-h-screen flex-col bg-zk-bg text-zk-text lg:flex-row">
      <BrandPanel />
      <section
        aria-label={panelLabel}
        className="relative flex w-full flex-col items-center justify-center gap-7 px-6 py-10 sm:px-8 lg:flex-[1_1_480px]"
      >
        <div className="absolute top-6 right-6">
          <ThemeToggle />
        </div>

        <div className="ziki-auth-card-in flex w-full max-w-[440px] flex-col gap-6 rounded-3xl border border-zk-border bg-zk-surface p-7 shadow-[0_30px_70px_rgba(11,23,51,0.10)] sm:p-9">
          <div className="flex flex-col gap-3.5">
            {mark ? <AuthCardMark /> : null}
            <h2 className="text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">
              {title}
            </h2>
            {description ? (
              <div className="text-[15px] leading-relaxed text-zk-muted">{description}</div>
            ) : null}
          </div>
          {children}
          {showAgentDocs ? (
            <>
              <div className="flex items-center gap-3 text-xs font-bold tracking-[0.06em] text-zk-muted uppercase">
                <span className="h-px flex-1 bg-zk-border" />
                For AI agents
                <span className="h-px flex-1 bg-zk-border" />
              </div>
              <AgentDocsCallout />
            </>
          ) : null}
        </div>

        <AuthFooter />
      </section>
    </div>
  );
}

export function AuthLegalNote() {
  return (
    <p className="text-center text-xs leading-relaxed text-zk-muted">
      By continuing, you agree to Ziki&apos;s{" "}
      <span className="font-semibold text-zk-accent">Terms</span> and{" "}
      <span className="font-semibold text-zk-accent">Privacy Policy</span>.
    </p>
  );
}
