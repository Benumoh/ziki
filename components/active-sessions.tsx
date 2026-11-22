"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutOtherSessionsAction, signOutSessionAction } from "@/app/actions/settings";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { ActiveSessionView, SessionDeviceType } from "@/lib/user-sessions";

function DeviceIcon({ type }: { type: SessionDeviceType }) {
  if (type === "mobile") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }

  if (type === "desktop") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 16v5" />
      </svg>
    );
  }

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}

export function ActiveSessions({
  initialSessions,
}: {
  initialSessions: ActiveSessionView[];
}) {
  const router = useRouter();
  const [revokedIds, setRevokedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAll, setPendingAll] = useState(false);
  const confirm = useConfirm();
  const notify = useToast();

  const sessions = initialSessions.filter((session) => !revokedIds.has(session.id));
  const otherSessionsCount = sessions.filter((session) => !session.isCurrent).length;

  async function handleSignOutOne(target: ActiveSessionView) {
    if (pendingId || pendingAll) return;
    const ok = await confirm({
      title: `Sign out ${target.device}?`,
      body: "That device will need to sign in again before accessing your account.",
      confirmLabel: "Sign out",
      tone: "danger",
    });
    if (!ok) return;

    setPendingId(target.id);
    try {
      const result = await signOutSessionAction(target.id);
      if (!result.ok) {
        notify(result.error, "error");
        return;
      }
      setRevokedIds((prev) => new Set([...prev, target.id]));
      notify(`Signed out ${target.device}.`, "success");
    } catch {
      notify("Could not sign out that session. Try again.", "error");
    } finally {
      setPendingId(null);
    }
  }

  async function handleSignOutOthers() {
    if (otherSessionsCount === 0 || pendingAll || pendingId) return;
    const ok = await confirm({
      title: "Sign out of all other devices?",
      body: "Every session except this device will end right away. Signed-out devices will need to log in again.",
      confirmLabel: "Sign out other devices",
      tone: "danger",
    });
    if (!ok) return;

    setPendingAll(true);
    try {
      const result = await signOutOtherSessionsAction();
      if (!result.ok) {
        notify(result.error, "error");
        return;
      }
      setRevokedIds((prev) => {
        const next = new Set(prev);
        for (const item of initialSessions) {
          if (!item.isCurrent) next.add(item.id);
        }
        return next;
      });
      notify("Signed out of all other devices.", "success");
      router.refresh?.();
    } catch {
      notify("Could not sign out other devices. Try again.", "error");
    } finally {
      setPendingAll(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-panel border border-zk-border bg-zk-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-bold text-zk-text">Active sessions</h2>
          <span className="text-[13px] text-zk-muted">
            Devices and browsers currently signed in to your account. {sessions.length} active.
          </span>
        </div>
        <button
          type="button"
          disabled={otherSessionsCount === 0 || pendingAll || Boolean(pendingId)}
          onClick={handleSignOutOthers}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-full border border-zk-bad-bd bg-zk-surface px-3.5 text-[13px] font-bold text-zk-bad-fg transition hover:bg-zk-bad-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          {pendingAll ? "Signing out…" : "Sign out of all other devices"}
        </button>
      </div>

      <div className="divide-y divide-zk-divider">
        {sessions.map((session) => {
          const isSigningOut = pendingId === session.id;
          return (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 py-3.5 first:pt-1 last:pb-1"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel bg-zk-chip text-zk-text2">
                  <DeviceIcon type={session.deviceType} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-zk-text">{session.device}</span>
                    {session.isCurrent ? (
                      <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-[11px] font-bold leading-4 text-zk-ok-fg">
                        This device
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-zk-muted">
                    {session.location} &middot; {session.ipAddress} &middot; {session.lastActiveText}
                  </span>
                </div>
              </div>

              {!session.isCurrent ? (
                <button
                  type="button"
                  disabled={isSigningOut || pendingAll}
                  aria-label={isSigningOut ? `Signing out… ${session.device}` : `Sign out ${session.device}`}
                  onClick={() => handleSignOutOne(session)}
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-[13px] font-bold text-zk-bad-fg transition hover:bg-zk-bad-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="m-0 rounded-panel border border-dashed border-zk-border bg-zk-bg px-4 py-3 text-xs leading-relaxed text-zk-muted">
        &ldquo;Sign out of all other devices&rdquo; ends every session except this one, so you stay
        signed in here. Signed-out devices must log in again.
      </p>
    </section>
  );
}

