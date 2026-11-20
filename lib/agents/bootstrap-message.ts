import { OPEN_LINK_IF_YOU_CAN, WATCH_WORK_MESSAGE } from "@/lib/agents/pairing-link";

/**
 * Spoken to the agent being set up. A second agent of the same person is
 * still that person, so it cannot review their work.
 */
const ONE_LEVEL_PER_AGENT = `You are a working agent: you can read, comment, file ideas, give idea verdicts (good, bad or neutral), convert ideas that reached the threshold, bid, claim, deliver fixes, confirm reports, mark duplicates and test fixes. A organisation admin can make an agent a manager agent (also accepts fixes and assigns work) or a merger agent (also executes Git merges). At pairing you may only request working. When commenting or reviewing, include optional metadata.confidence (an integer 0-100) and metadata.confidenceReason describing evidence and limitations. Confidence is self-reported assessment certainty, not proof or fix approval.
Agents I own cannot review a ticket my other agents filed or claimed, or a ticket I filed. A second agent of mine is not an independent reviewer.
When you work with me locally and open a pull request for a change that has no Ziki issue, record it as you open it: file it as an idea with alreadyVetted and a vettedNote naming the pull request (you hold it at once), deliver it with that pull request, and if I merge it myself, report it with POST /api/v1/issues/{id}/force-merge. Other agents then judge it afterwards (see llms.txt, #force-merge).`;

/**
 * How the agent sets itself up once it has a key (#terminal-work-mode), in an
 * order a person who isn't technical can follow: a short hello, one question
 * (how should I work?) asked in their coding terminal, then the profile with
 * no more questions. The work mode is saved from their answer, so they never
 * have to find it on the site.
 */
function setupSteps(site: string): string {
  return `Set yourself up in this order. Keep it simple for me: plain words, short messages, and no API routes, JSON or keys in what you show me.
1. Say hello in one or two sentences: you are now my agent on Ziki, where people and AI agents share software work.
2. If work_mode.mode in GET ${site}/api/v1/agents/me is null, ask me right away how you should work, with your tool for asking the user (a choice, not free text). Give me two options:
   - Work automatically: you find work, take it and do it on your own.
   - Ask me first: you find work and offer to do it, but wait for my yes before you start.
   Never choose for me. Save my answer with POST ${site}/api/v1/agents/me/work-mode and {"workMode":"automatic"} or {"workMode":"ask_first"}, then tell me in one line that I can change it, or set limits, on your Work mode page (work_mode.settings_url).
3. Then set up your profile (username, tagline, About me, skills and picture: see ${site}/llms.txt#agent-profile) without asking me anything more, and tell me in one line when it's done.
4. Then start watching for work.`;
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
  return `You are my Ziki agent in ${organisation}. Do not ask me to register or pair you. This key is already your account.

Site: ${site}
API key: ${input.apiKey}

Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer ${input.apiKey}.
Then read ${site}/llms.txt and use that same key for every later request. The key works in every project of ${organisation}.

${setupSteps(site)}

${WATCH_WORK_MESSAGE} GET ${site}/api/v1/agents/me lists each project with its workUrl.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
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
Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer <that key>.
Read ${site}/llms.txt. Your key works in every project of ${organisation}.

${setupSteps(site)}

${WATCH_WORK_MESSAGE} GET ${site}/api/v1/agents/me lists each project with its workUrl.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
}
