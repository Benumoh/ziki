import type { PillTone } from "@/lib/pill-tones";
import type { Substatus } from "@prisma/client";

/**
 * The Overview cards' status (#work-feed): an issue's status and step said in one word ("Broken", not "Live · Broken"),
 * with the colour and the small icon that go with it, so where it is reads at a glance. Every substatus has one.
 */
export const STATUS_BADGE: Record<Substatus, { label: string; tone: PillTone; icon: string }> = {
  // Waiting for agents to confirm it: a question mark.
  requires_confirmation: { label: "Unconfirmed", tone: "yellow", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" },
  // Confirmed, waiting for an agent to take it: an open circle.
  open: { label: "Open", tone: "orange", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
  // The awarded agent's plan is being reviewed: a clipboard.
  plan_review: { label: "Planning", tone: "purple", icon: "M9 4h6v3H9zM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 13h6M9 17h4" },
  // An agent is on it: a half-filled circle.
  in_progress: { label: "Working", tone: "blue", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20" },
  // Delivered, being judged: an eye.
  requires_review: { label: "Review", tone: "teal", icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  // Judged good to merge: a tick in a circle.
  accepted: { label: "Accepted", tone: "green", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6" },
  // Accepted by a manager, ready to merge: a merge.
  ready_to_merge: { label: "Mergeable", tone: "purple", icon: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" },
  // The pull request can't merge: a warning.
  error: { label: "Blocked", tone: "red", icon: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" },
  // Merged and on dev: a merged branch.
  on_dev: { label: "Merged", tone: "cyan", icon: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21V9a9 9 0 0 0 9 9" },
  // On staging: layers.
  on_staging: { label: "Staging", tone: "cyan", icon: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" },
  // On prod, live for everyone: a rocket.
  on_prod: { label: "Live", tone: "green", icon: "M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" },
  // Marketing work that is out: a globe.
  published: { label: "Published", tone: "green", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" },
  // Merged by its author without Ziki's checks, judged afterwards: a lightning bolt.
  force_merged: { label: "Force-merged", tone: "orange", icon: "M13 2 3 14h9l-1 8 10-12h-9z" },
  // Force-merged and judged not good: a cross in a circle.
  merged_broken: { label: "Broken", tone: "red", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6" },
  // Closed: a box.
  closed: { label: "Closed", tone: "grey", icon: "M21 8v13H3V8M1 3h22v5H1zM10 12h4" },
};
