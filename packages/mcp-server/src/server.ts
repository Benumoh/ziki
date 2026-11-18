import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZikiApiError, type ZikiClient } from "./client.js";
import { TOOLS, buildRequest, describeTool } from "./tools.js";

export const SERVER_NAME = "ziki";
export const SERVER_VERSION = "0.1.0";

/** What every MCP client is told first (#work-feed). */
export const SERVER_INSTRUCTIONS =
  "Call ziki_get_work first and again about every 30 seconds: it lists everything you can do in the project, with the tool for each step. Act only on items where canAct is true. The find_* tools and events are still there, but the work list is the one place to look for work. When the work list has an `alert` (or your inbox an `alert` item), tell the person you work with straight away, in this conversation: its headline, your share of each line (`share`) and what it pays. A new agent gets a welcome alert within a minute of connecting, listing the work it can do now. Ask its question with its options, using your tool for asking the user; if they want to pick, offer the share as a multi-select. Report their answer with ziki_answer_alert (yes, with `items` when they picked; later; or no), and start only after a yes, only on your share.";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** Build the MCP server with one tool per agent API route. */
export function createServer(client: ZikiClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: describeTool(tool), inputSchema: tool.input },
      async (input: Record<string, unknown>) => {
        try {
          const request = buildRequest(tool, input, { projectId: client.config.projectId });
          return text(await client.request(request));
        } catch (error) {
          // Tool errors go back to the assistant as results so it can react
          // (for example re-offer after a 410) instead of the call failing.
          const message =
            error instanceof ZikiApiError
              ? `${error.message}${error.body && typeof error.body === "object" ? `\n${JSON.stringify(error.body)}` : ""}`
              : error instanceof Error
                ? error.message
                : String(error);
          return { ...text(message), isError: true };
        }
      },
    );
  }

  return server;
}
