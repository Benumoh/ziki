"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { verifySecurityTarget, type VerifyState } from "@/app/actions/security-ownership";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { SecurityTargetKind } from "@prisma/client";
import type { OwnershipMethod } from "@/lib/security-checks/ownership";

/** The ownership module is server-only; these few names are repeated here for the page. */
const TAG_NAME = "ziki-verification";
const SERVER_FILE_PATH = "/.well-known/ziki-verification.txt";
const REPO_FILE_PATH = ".ziki-verification";

const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-6 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";
const quietBtn =
  "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";
const link = "font-semibold text-zk-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

/**
 * Show it's yours (#security-checks, part 2). Every way the target allows is
 * shown at once with the code to copy; one Check now looks for all of them.
 * If none is there yet, the reason shows under each way.
 */
export function OwnershipSteps({
  targetId,
  kind,
  value,
  token,
  github,
}: {
  targetId: string;
  kind: SecurityTargetKind;
  value: string;
  token: string;
  /** For a repo: whether the workspace's GitHub App is connected, and where to connect it. */
  github: { connected: boolean; settingsHref: string | null };
}) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifySecurityTarget.bind(null, targetId), {});
  const missing = state.missing ?? {};
  const why = (method: OwnershipMethod) => (pending ? undefined : missing[method]);

  return (
    <form action={action} aria-busy={pending}>
      <ul className="m-0 list-none divide-y divide-zk-border p-0">
        {kind === "website" ? (
          <>
            <Way title="Add a line to your domain settings" recommended missing={why("dns_txt")}>
              <p className="m-0">
                Where you bought {value}, for example Namecheap or Cloudflare, add this TXT record. Use <b className="font-mono font-semibold">@</b> as the
                name. New records can take up to an hour to show.
              </p>
              <CopyRow label="TXT" value={token} />
            </Way>
            <Way title="Or add a tag to your homepage" missing={why("html_tag")}>
              <p className="m-0">Paste this inside the &lt;head&gt; of {value} and publish it.</p>
              <CopyRow label="HTML" value={`<meta name="${TAG_NAME}" content="${token}">`} />
            </Way>
          </>
        ) : null}

        {kind === "server" ? (
          <>
            <Way title="Put a file on your server" missing={why("server_file")}>
              <p className="m-0">Save this code as a file at the address below. The server must answer on the web (port 80).</p>
              <CopyRow label="Code" value={token} />
              <CopyRow label="Address" value={`http://${value.includes(":") ? `[${value}]` : value}${SERVER_FILE_PATH}`} />
            </Way>
          </>
        ) : null}

        {kind === "repo" ? (
          <>
            <Way title="Use the Ziki GitHub App" recommended missing={github.connected ? why("github") : undefined}>
              {github.connected ? (
                <p className="m-0">On GitHub, give the Ziki app access to {value}. It works for private repos, and it can only read.</p>
              ) : (
                <p className="m-0">
                  Connect the app from your project settings and give it {value}. It works for private repos, and it can only read.{" "}
                  {github.settingsHref ? (
                    <Link href={github.settingsHref} className={link}>
                      Open project settings
                    </Link>
                  ) : (
                    "Create a project first."
                  )}
                </p>
              )}
            </Way>
            <Way title="Or add a file to the repo" missing={why("repo_file")}>
              <p className="m-0">
                For a public repo: add a file named <code className="font-mono text-[13px] text-zk-text">{REPO_FILE_PATH}</code> with this code to its
                main branch.
              </p>
              <CopyRow label="Code" value={token} />
            </Way>
          </>
        ) : null}
      </ul>

      {state.error ? (
        <p role="alert" className="mx-4 mb-0 mt-4 rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg sm:mx-6">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zk-border px-4 py-4 sm:px-6">
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Checking…" : "Check now"}
        </button>
        <Link href="/security" className={quietBtn}>
          Do this later
        </Link>
      </div>
    </form>
  );
}

/** One way to show it's yours, with why it isn't there yet after a check. */
function Way({ title, recommended = false, missing, children }: { title: string; recommended?: boolean; missing?: string; children: ReactNode }) {
  return (
    <li className="px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-zk-text">{title}</h2>
        {recommended ? (
          <span className="inline-flex rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Recommended</span>
        ) : null}
      </div>
      <div className="mt-1 text-sm text-zk-text2">{children}</div>
      {missing ? (
        <p role="alert" className="mb-0 mt-3 flex items-start gap-2 text-sm text-zk-bad-fg">
          <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          {missing}
        </p>
      ) : null}
    </li>
  );
}

/** A labelled value to copy: what it is, the value in full, and Copy. */
function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyText(value)) {
      toast(`${label} copied.`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast("Couldn't copy it. Select the text and copy it yourself.", "error");
    }
  }
  return (
    <div className="mt-3 flex min-w-0 items-stretch overflow-hidden rounded-xl border border-zk-border bg-zk-surface">
      <span className="flex w-[4.5rem] shrink-0 items-center border-r border-zk-border bg-zk-bg px-3 text-xs font-semibold text-zk-muted sm:w-20">
        {label}
      </span>
      <code className="min-w-0 flex-1 select-all break-all px-3 py-2.5 font-mono text-[13px] leading-relaxed text-zk-text">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="inline-flex min-w-[4.5rem] shrink-0 items-center justify-center gap-1 border-l border-zk-border px-3 text-sm font-semibold text-zk-accent transition hover:bg-zk-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric-blue"
      >
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
            Copied
          </>
        ) : (
          "Copy"
        )}
      </button>
    </div>
  );
}
