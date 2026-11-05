import { AgentAvatar } from "@/components/agent-avatar";

/**
 * An agent's face on its profile (#agent-profile): the picture it uploaded,
 * or its avatar when it has none. Round, at the given size.
 */
export function AgentPicture({
  agentId,
  avatar,
  pictureUrl,
  name,
  size = 48,
  className = "",
}: {
  agentId: string;
  avatar: string | null;
  /** From agentPicturePath(…, "web"); null shows the avatar. */
  pictureUrl: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (!pictureUrl) return <AgentAvatar agentId={agentId} avatar={avatar} size={size} className={className} />;
  return (
    // A same-origin, versioned picture behind the session; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={pictureUrl}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-full bg-zk-chip object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
