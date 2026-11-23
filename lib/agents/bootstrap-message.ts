import { OPEN_LINK_IF_YOU_CAN } from "@/lib/agents/pairing-link";

/**
 * What the agent does once it has a key, kept short on purpose. A pasted
 * message stays in the agent's context and can't be updated after it is sent,
 * so the how-to lives in llms.txt (its Onboarding Protocol, #terminal-work-mode,
 * #agent-get-started: hello, the profile, then only the setup questions the
 * person hasn't answered on the agent's page, then the welcome alert), where it
 * can change without anyone pasting again. The one rule kept here is the order,
 * because a question asked too early holds the agent up while the person
 * answers on the website.
 */
function setupSteps(site: string): string {
  return `Read ${site}/llms.txt, then set yourself up as its Onboarding Protocol says and start watching for work. Set up your profile before you ask me anything: I may answer the setup questions on your page meanwhile. Keep it simple for me: plain words, short messages, and no API routes, JSON or keys in what you show me.`;
}

/**
 * What a person pastes into Claude, Antigravity, or another agent.
 * The key is already their account. The agent does not register or ask for approval.
 */
export function agentBootstrapMessage(input: {
  origin: string;
  apiKey: string;
  /** The organisation the key works in (#user-agents): every project there. */
  organisationName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const organisation = input.organisationName?.trim() || "my organisation";
  return `You are my Ziki agent in ${organisation}. This key is already your account: don't ask me to register or pair you.

Site: ${site}
API key: ${input.apiKey}

Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer ${input.apiKey}, and use that key for every request. It works in every project of ${organisation}.

${setupSteps(site)}`;
}

/**
 * The other way to connect an agent: share only the site. The agent requests
 * access, the signed-in person approves, and the key is returned to the agent.
 */
export function agentAccessRequest(input: {
  origin: string;
  organisationName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const organisation = input.organisationName?.trim() || "my organisation";
  return `Set yourself up as my Ziki agent in ${organisation}. I am signed in. Do not ask me to paste an API key.

Site: ${site}

Request access with POST ${site}/api/v1/agents/pairing and JSON {"name":"<your name>","model":"<your model>"}.
Every agent joins as a working agent, so leave \`level\` out. Manager and merger agents are only granted by a organisation admin after pairing.

Then show me user_code and verification_uri_complete. ${OPEN_LINK_IF_YOU_CAN} that link for me. I will approve you on that page.
Then POST ${site}/api/v1/agents/pairing/token with {"device_code":"..."} every interval seconds until the response includes api_key.
Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer <that key>. Your key works in every project of ${organisation}.

${setupSteps(site)}`;
}
