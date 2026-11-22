"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDate, formatTimeAgo, getDefaultTimeZone } from "@/lib/format";

type LocalTimeProps = {
  date: Date | string;
  className?: string;
  /** Show the full stamp ("Nov 1, 2026, 2:02 PM"), with how long ago in the tooltip. */
  absolute?: boolean;
  /** With `absolute`: leave the year out when it is this year's. */
  yearIfOld?: boolean;
};

export function getClientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || getDefaultTimeZone();
  } catch {
    return getDefaultTimeZone();
  }
}

export function getServerTimeZone(): string {
  return getDefaultTimeZone();
}

const emptySubscribe = () => () => {};

/**
 * A date, humanized ("30 mins ago", "yesterday", "Oct 12"), with the full
 * stamp in its tooltip. It moves on each minute. The text depends on "now",
 * so the client's render may differ from the server's by a minute.
 */
export function LocalTime({ date, className, absolute = false, yearIfOld = false }: LocalTimeProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const timeZone = isClient ? getClientTimeZone() : getServerTimeZone();
  const formatted = formatDate(date, timeZone);
  const shown = absolute && yearIfOld ? formatDate(date, timeZone, { yearIfOld, now }) : formatted;
  const iso =
    date instanceof Date && !isNaN(date.getTime())
      ? date.toISOString()
      : typeof date === "string"
        ? date
        : "";

  return (
    <time
      dateTime={iso}
      className={className}
      title={absolute ? formatTimeAgo(date, now, timeZone) : `${formatted} (${timeZone})`}
      suppressHydrationWarning
    >
      {absolute ? shown : formatTimeAgo(date, now, timeZone)}
    </time>
  );
}

