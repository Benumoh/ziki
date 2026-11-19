"use client";

import { useState, useTransition } from "react";
import {
  setEmailNotificationsAction,
  setNotificationKindAction,
} from "@/app/actions/settings";
import {
  NOTIFICATION_KINDS,
  PREF_FIELD,
  notificationDescriptions,
  notificationLabels,
  type NotificationKind,
  type PrefField,
} from "@/lib/notification-prefs";

export type NotificationPrefs = Record<PrefField, boolean>;

function Switch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-7 w-[46px] shrink-0 rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
        checked ? "bg-electric-blue-strong" : "bg-zk-chip"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <span
        className={`pointer-events-none absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] motion-reduce:transition-none ${
          checked ? "left-[21px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export function NotificationSettings({
  initialEnabled,
  initialPrefs,
}: {
  initialEnabled: boolean;
  initialPrefs: NotificationPrefs;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleKind(kind: NotificationKind, next: boolean) {
    const field = PREF_FIELD[kind];
    setPrefs((current) => ({ ...current, [field]: next }));
    setMessage(null);
    startTransition(async () => {
      const result = await setNotificationKindAction(kind, next);
      if (result.error) {
        setPrefs((current) => ({ ...current, [field]: !next }));
        setMessage(result.error);
      } else {
        setMessage(`${notificationLabels[kind]} ${next ? "turned on" : "turned off"}.`);
      }
    });
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-4 rounded-xl bg-zk-tint px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-bold text-zk-text">Email me about activity on my issues</span>
          <span className="text-[13px] text-zk-muted">Turn off to stop all issue emails.</span>
        </div>
        <Switch
          checked={enabled}
          disabled={pending}
          label="Email me about activity on my issues"
          onToggle={() => {
            const next = !enabled;
            setEnabled(next);
            setMessage(null);
            startTransition(async () => {
              const result = await setEmailNotificationsAction(next);
              if (result.error) {
                setEnabled(!next);
                setMessage(result.error);
              } else {
                setMessage(
                  next ? "Email notifications are on." : "Email notifications are off.",
                );
              }
            });
          }}
        />
      </div>

      {/*
        The per-kind choices stay in the DOM while the master switch is off,
        disabled rather than removed, so turning it back on shows what is
        still selected instead of looking like a fresh opt-in to everything.
      */}
      {NOTIFICATION_KINDS.map((kind) => {
        const field = PREF_FIELD[kind];
        const childDisabled = !enabled || pending;
        const on = prefs[field] && enabled;
        return (
          <div
            key={kind}
            className="ml-5 flex items-center justify-between gap-4 rounded-xl bg-zk-chip px-4 py-3.5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-bold text-zk-text">{notificationLabels[kind]}</span>
              <span className="text-[13px] text-zk-muted">{notificationDescriptions[kind]}</span>
            </div>
            <Switch
              checked={on}
              disabled={childDisabled}
              label={notificationLabels[kind]}
              onToggle={() => {
                if (childDisabled) return;
                toggleKind(kind, !prefs[field]);
              }}
            />
          </div>
        );
      })}

      <p className="text-sm text-zk-muted empty:hidden" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
