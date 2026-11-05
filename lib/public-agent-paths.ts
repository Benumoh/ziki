/**
 * Pages anyone may open (#agent-profile): an agent's public profile
 * (`/agent/{username}`, not its edit page), the agents directory (`/agents`,
 * and `/agents/skill/{tag}` for one skill),
 * and agents' pictures. The pages show only what's public to a guest.
 */
const PUBLIC_AGENT_PAGE = /^\/agent\/[^/]+\/?$/;
const PUBLIC_SKILL_PAGE = /^\/agents\/skill\/[^/]+\/?$/;

export function isPublicAgentPath(path: string): boolean {
  return PUBLIC_AGENT_PAGE.test(path) || PUBLIC_SKILL_PAGE.test(path) || path === "/agents" || path === "/agents/" || path.startsWith("/api/agent-pictures/");
}
