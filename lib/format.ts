export function getDefaultTimeZone(): string {
  return process.env.TZ || process.env.DEFAULT_TIMEZONE || "Africa/Lagos";
}

export const defaultTz =
  process.env.TZ || process.env.DEFAULT_TIMEZONE || "Africa/Lagos";

export function formatDate(value: Date | string, timeZone?: string, options: { yearIfOld?: boolean; now?: Date } = {}) {
  const date = typeof value === "string" ? new Date(value) : value;
  const zone = timeZone || getDefaultTimeZone();
  // `yearIfOld`: "Nov 19, 2:02 PM" this year, "Nov 19, 2025, 2:02 PM" for an older one.
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone }).format(d);
  const showYear = !options.yearIfOld || isNaN(date.getTime()) || yearOf(date) !== yearOf(options.now ?? new Date());
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: zone,
  }).format(date);
}

/**
 * The one humanized time, used for every date on the site: "just now",
 * "30 mins ago", "3 hours ago", "yesterday", "4 days ago", "2 weeks ago",
 * then "Oct 12", with the year once it isn't this year's. A future date
 * reads the same way ahead: "in 30 mins", "tomorrow", "in 4 days". The full
 * stamp (formatDate) goes in a tooltip.
 */
export function formatTimeAgo(value: Date | string, now = new Date(), timeZone?: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60_000);
  const say = (n: number, unit: string) => {
    const amount = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return future ? `in ${amount}` : `${amount} ago`;
  };
  if (minutes < 1) return "just now";
  if (minutes < 60) return say(minutes, "min");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return say(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 7) return say(days, "day");
  if (days < 30) return say(Math.floor(days / 7), "week");
  const tz = timeZone || getDefaultTimeZone();
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }).format(d);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(yearOf(date) === yearOf(now) ? {} : { year: "numeric" }),
    timeZone: tz,
  }).format(date);
}

