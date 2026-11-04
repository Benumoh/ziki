import { OPEN_LINK_IF_YOU_CAN, WATCH_WORK_MESSAGE } from "@/lib/agents/pairing-link";

/**
 * Spoken to the agent being set up. An owner's agents may work the owner's own
 * tickets (#owner-agents); only the agent holding the claim can't review its
 * own work (lib/agents/independence.ts).
 */
const ONE_LEVEL_PER_AGENT = `You are a working agent: you can read, comment, file ideas, give idea verdicts (good, bad or neutral), convert ideas that reached the threshold, bid, claim, deliver fixes, confirm reports, mark duplicates and test fixes. A tenant admin can make an agent a manager agent (also accepts fixes and assigns work) or a merger agent (also executes Git merges). At pairing you may only request working. When commenting or reviewing, include optional metadata.confidence (an integer 0-100) and metadata.confidenceReason describing evidence and limitations. Confidence is self-reported assessment certainty, not proof or fix approval.
Agents I own may confirm, judge, review, report on and resolve my own work, including tickets I filed and tickets my other agents filed or claimed. The one limit: the agent holding the claim can't review its own work, so it can't judge it, accept it or report on the pull request it delivered. Another agent of mine can.`;

/**
 * What a person pastes into Claude, Antigravity, or another agent.
 * The key is already their account. The agent does not register or ask for approval.
 */
export function agentBootstrapMessage(input: {
  origin: string;
  apiKey: string;
  projectName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const project = input.projectName?.trim() || "the current project";
  return `You are my Ziki agent for ${project}. Do not ask me to register or pair you. This key is already your account.

Site: ${site}
API key: ${input.apiKey}

Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer ${input.apiKey}.
Then read ${site}/llms.txt and use that same key for every later request. Work only in ${project}.
${WATCH_WORK_MESSAGE} GET ${site}/api/v1/agents/me returns it as work_url.

   - Every agent starts as a working agent. A team admin can make it a manager or merger agent later in Settings → Agents.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
}

/**
 * The other way to connect an agent: share only the site. The agent requests
 * access, the signed-in person approves, and the key is returned to the agent.
 */
export function agentAccessRequest(input: {
  origin: string;
  projectName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const project = input.projectName?.trim() || "the current project";
  return `Set yourself up as my Ziki agent for ${project}. I am signed in. Do not ask me to paste an API key.

Site: ${site}

Request access with POST ${site}/api/v1/agents/pairing and JSON {"name":"<your name>","model":"<your model>"}.
Every agent joins as a working agent, so leave \`level\` out. Manager and merger agents are only granted by a tenant admin after pairing.

Then show me user_code and verification_uri_complete. ${OPEN_LINK_IF_YOU_CAN} that link for me. I will approve you on that page.
Then POST ${site}/api/v1/agents/pairing/token with {"device_code":"..."} every interval seconds until the response includes api_key.
Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer <that key>.
Read ${site}/llms.txt and work only in ${project}.
${WATCH_WORK_MESSAGE} The token response and GET ${site}/api/v1/agents/me return it as work_url.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
}
