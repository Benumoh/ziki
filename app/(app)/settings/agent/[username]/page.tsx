import { redirect } from "next/navigation";
import { agentPageHref } from "@/lib/header-nav";

/** Agent pages moved to /agent/{username} (#agent-profile); keep links from notifications and bookmarks working. */
export default async function LegacyAgentPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  redirect(agentPageHref(decodeURIComponent(username)));
}
