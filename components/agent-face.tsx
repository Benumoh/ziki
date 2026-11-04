import { type FaceColor, faceColor, FACE_COLORS } from "@/lib/agents/dock-colors";

/** What a face can show; the agents dock's statuses (#agents-dock). */
export type FaceStatus = "waiting" | "stuck" | "working" | "idle" | "offline";

/** A stable number from the id, so an agent with no pick always wears the same colour. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The colour picked for an agent's face, or else the one its id gives it. */
export function faceColorOf(id: string, key: string | null | undefined): FaceColor {
  return faceColor(key) ?? FACE_COLORS[seedOf(id) % FACE_COLORS.length]!;
}

/** The ring a face wears when it needs you (red) or is stuck (amber); it pulses unless motion is reduced. */
const RING: Partial<Record<FaceStatus, string>> = { waiting: "#E5484D", stuck: "#E9A23B" };

/**
 * An agent as a plain, round face: the standard look for an agent, its eyes
 * saying what it is doing. Working, it glances about; idle, it blinks now and
 * then; needing you, its eyes go wide and a red ring pulses round it; stuck,
 * its eyes droop half shut inside an amber ring; offline, it sleeps, greyed.
 * Decorative: the agent's name and status always show beside it.
 */
export function AgentFace({
  agentId,
  colorKey = null,
  status = "idle",
  size = 32,
  still = false,
  className = "",
}: {
  agentId: string;
  /** A key from FACE_COLORS; null wears the colour its id gives it. */
  colorKey?: string | null;
  status?: FaceStatus;
  size?: number;
  /** No motion at all, as in a picker's preview. */
  still?: boolean;
  className?: string;
}) {
  const { hex } = faceColorOf(agentId, colorKey);
  const off = status === "offline";
  const ring = RING[status];
  const moving = !still && !off;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className={`shrink-0 overflow-visible ${className}`}>
      {ring ? (
        <circle
          cx="20"
          cy="20"
          r="19"
          fill="none"
          stroke={ring}
          strokeWidth="2.5"
          className={moving ? "motion-safe:animate-[zk-face-ring_1.6s_ease-in-out_infinite]" : ""}
        />
      ) : null}
      <circle cx="20" cy="20" r={ring ? 15.5 : 18} fill={off ? "#AEB6C4" : hex} />
      {/* A soft light on the upper left, so the face reads as round rather than as a dot. */}
      <ellipse cx="14.5" cy="12.5" rx="6" ry="3.6" fill="#fff" opacity={off ? 0.18 : 0.22} transform="rotate(-24 14.5 12.5)" />
      <g
        className={
          moving && status === "working"
            ? "motion-safe:animate-[zk-face-glance_3.2s_ease-in-out_infinite]"
            : undefined
        }
      >
        <Eye cx={15} status={status} moving={moving} />
        <Eye cx={25} status={status} moving={moving} />
      </g>
    </svg>
  );
}

function Eye({ cx, status, moving }: { cx: number; status: FaceStatus; moving: boolean }) {
  if (status === "offline") {
    return <path d={`M${cx - 2.6} 21q2.6 1.6 5.2 0`} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />;
  }
  if (status === "stuck") {
    // Half shut: the lid cuts the eye flat on top.
    return <path d={`M${cx - 2.4} 19.5h4.8v1.6a2.4 2.4 0 0 1-4.8 0z`} fill="#fff" />;
  }
  const tall = status === "waiting" ? 5.2 : 4.2;
  return (
    <rect
      x={cx - 1.9}
      y={20 - tall}
      width="3.8"
      height={tall * 2}
      rx="1.9"
      fill="#fff"
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      className={moving && status !== "waiting" ? "motion-safe:animate-[zk-face-blink_4.6s_ease-in-out_infinite]" : undefined}
    />
  );
}
