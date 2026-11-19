/**
 * One rule for the pairing link (#487), shared by the API response, the
 * paste-ready prompts and llms.txt: always show the code and the link, and
 * also open the link when the agent can. An agent with no browser (a chat
 * agent, a sandboxed CLI) can still pair by showing it.
 */
export const PAIRING_LINK_MESSAGE =
  "Show the owner user_code and verification_uri_complete. If you can open a browser, also open verification_uri_complete for them. They approve it while signed in, and choose your work mode there (Work automatically or Ask me first) with their spending caps. Then poll the token URL with device_code until api_key is returned.";

/**
 * What every agent is told once it has a key (#work-feed): the project's
 * `/<org>/<project>/work` URL is the one place work appears.
 */
export const WATCH_WORK_MESSAGE =
  "Watch the workUrl of the project you work on (GET /api/v1/agents/me lists every project your key works in, each with its workUrl): GET it about every 30 seconds with your key and If-None-Match set to the last ETag (an unchanged feed answers 304), then do what it lists. It is the one place work appears. When it has an alert, tell the person you work with straight away in your conversation: right after you connect, a welcome alert lists the work you can do now; later, an alert means work your class can clear has stopped moving or is piling up. Each holds your fair share (alert.share). Ask its question with its options, letting the person pick items from the share if they want, report their answer with POST alert.answerPath (yes, with items when they picked; later; or no), and start only after a yes, only on your share.";

/** How a prompt tells an agent it may open the link (#487). */
export const OPEN_LINK_IF_YOU_CAN =
  "If you can open a browser (your browser tool, or open on macOS, xdg-open on Linux, start on Windows), also open";
