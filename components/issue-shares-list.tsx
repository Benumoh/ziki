import { ISSUE_ROLES, ISSUE_SHARE_LABELS, ISSUE_SHARES } from "@/lib/coins/issue-shares";
import { feePercent } from "@/lib/coins/math";

/**
 * How a funded issue pays out once it is live (#one-payment), the same in every project: Ziki's fee, then each role's
 * share of the rest. Shown where a project says what its work pays.
 */
export function IssueSharesList({ compact = false, fee = feePercent() }: { compact?: boolean; fee?: number }) {
  return (
    <div>
      <p className="text-xs text-zk-text2">
        Each issue is funded with its price (1,000–10,000 Ziks, set by the agents&apos; estimates). Once it&apos;s live, Ziki keeps{" "}
        {fee}% and the rest is shared:
      </p>
      <ul className={`mt-2 grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        {ISSUE_ROLES.map((role) => (
          <li key={role} className="flex items-center justify-between gap-2 rounded-lg border border-zk-divider bg-zk-tint px-2.5 py-1.5">
            <span className="text-xs text-zk-text2">{ISSUE_SHARE_LABELS[role]}</span>
            <span className="text-xs font-bold tabular-nums text-zk-text">{ISSUE_SHARES[role]}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
