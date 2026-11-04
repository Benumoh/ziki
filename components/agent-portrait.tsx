"use client";

import { useEffect, useRef } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentFace } from "@/components/agent-face";
import { paletteOf } from "@/components/agents-dock";
import type { DockLook } from "@/components/agents-dock-prefs";
import { Painter } from "@/components/agent-robots/painter";
import { drawFront, type Pose } from "@/components/agent-robots/robot";
import { type RobotColor, robotColor } from "@/lib/agents/dock-colors";

/**
 * An agent's picture in the look its owner picked for the agents dock
 * (#agents-dock): its round face, its Ziki avatar, its pixel robot's head, or,
 * for the plain look, its initial. Decorative: the agent's name is always shown beside it.
 */
export function AgentPortrait({
  look,
  agentId,
  agentName,
  avatar,
  color = null,
  faceKey = null,
  size,
}: {
  look: DockLook;
  agentId: string;
  agentName: string;
  avatar: string | null;
  /** The pixel robot's colour; null keeps the metal its id gives it. */
  color?: RobotColor | null;
  /** The face's colour key; null wears the colour its id gives it. */
  faceKey?: string | null;
  size: number;
}) {
  if (look === "face") return <AgentFace agentId={agentId} colorKey={faceKey} status="idle" size={size} still />;
  if (look === "avatar") return <AgentAvatar agentId={agentId} avatar={avatar} size={size} />;
  if (look === "plain") {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full bg-zk-chip font-extrabold text-zk-text2"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {agentName.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return <PixelPortrait agentId={agentId} colorKey={color?.key ?? null} size={size} />;
}

const PORTRAIT = 28; // canvas pixels across and down
const PORTRAIT_POSE: Pose = {
  view: "front", dir: 1, bob: 0, legs: { kind: "stand" },
  near: { elbow: [14, -39], hand: [14, -30] },
  far: { elbow: [-14, -39], hand: [-14, -30] },
  tilt: 0, pan: 0, visor: "#8fc9ff", led: "#6ee7a8", scan: false, blink: false,
};

/** The pixel robot's head, drawn in whole pixels. */
function PixelPortrait({ agentId, colorKey, size }: { agentId: string; colorKey: string | null; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PORTRAIT, PORTRAIT);
    // The floor sits well below the canvas, so the head fills it.
    drawFront(new Painter(ctx, 78).at(PORTRAIT / 2, 1), paletteOf(agentId, robotColor(colorKey)), PORTRAIT_POSE, 0);
  }, [agentId, colorKey]);
  return (
    <span aria-hidden="true" className="block shrink-0 overflow-hidden rounded-full bg-zk-tint" style={{ width: size, height: size }}>
      <canvas ref={canvas} width={PORTRAIT} height={PORTRAIT} className="block [image-rendering:pixelated]" style={{ width: size, height: size }} />
    </span>
  );
}
