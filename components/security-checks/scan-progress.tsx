"use client";

import { useEffect, useState } from "react";
import { parseSecurityTarget } from "@/lib/security-checks/target";

/** What the quick scan looks at, by kind (18 Nov, Hamzat: a repo's scan shows a repo's steps, not a website's). */
export const SITE_STEPS = ["HTTPS", "Certificate", "Headers", "Cookies", "Email"];
export const REPO_STEPS = ["Files", "Packages", "Workflows", "Secrets", "Policy"];
const STEPS = SITE_STEPS;

/** How long each area shows on the Scanning bar, on Security and the public page alike: steady, not slow. */
export const SCAN_STEP_MS = 700;
/** How long the whole bar takes for a website; the result waits for it. */
export const SCAN_BAR_MS = STEPS.length * SCAN_STEP_MS;

/**
 * "Scanning…" while the quick scan runs (#security-checks): a bar and the
 * areas ticking off, the same on the Security page's chat and the public page.
 */
export function ScanProgress({ site, kind }: { site: string; kind?: string }) {
  const parsed = kind ? null : parseSecurityTarget(site);
  const repo = (kind ?? (parsed?.ok ? parsed.target.kind : "website")) === "repo";
  const steps = repo ? REPO_STEPS : SITE_STEPS;
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, steps.length - 1)), SCAN_STEP_MS);
    return () => clearInterval(timer);
  }, [steps.length]);
  return (
    <div role="status" className="w-full rounded-2xl border border-zk-border bg-zk-surface p-4 text-left sm:p-5">
      <p className="m-0 text-[15px] font-bold text-zk-text">Scanning {site}…</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zk-chip">
        <div className="h-full rounded-full bg-electric-blue-strong transition-[width] duration-700" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]">
        {steps.map((label, index) => (
          <li key={label} className={index < step ? "text-zk-ok-fg" : index === step ? "font-semibold text-zk-text" : "text-zk-muted"}>
            {index < step ? "✓ " : ""}{label}
          </li>
        ))}
      </ul>
    </div>
  );
}
