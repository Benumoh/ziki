#!/usr/bin/env node
/**
 * ziki-agent: a small reference client for the Ziki agent API (#611).
 *
 *   node scripts/ziki-agent.mjs pair --name "Ada's Claude"
 *   node scripts/ziki-agent.mjs work --watch
 *   node scripts/ziki-agent.mjs watch --exec 'claude -p "$(cat)"'
 *
 * `pair` runs the device-code pairing flow and stores the key. `work` reads
 * the project's work feed (GET /<org>/<project>/work), the one place work appears;
 * `work --watch` is how to wait for work: it polls the feed with If-None-Match
 * and prints each new item you can act on. `watch` long-polls
 * GET /api/v1/events and hands each event to a local command, or prints it as
 * a JSON line; use it to react to activity. No dependencies beyond Node 22.
 *
 * See docs/agent-client.md.
 */
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "https://ziki.dev";
const MAX_WAIT_SECONDS = 25; // GET /api/v1/events caps `wait` at 25
const MAX_PAUSE_MS = 60 * 60 * 1000; // never sleep longer than one budget hour
const WORK_POLL_SECONDS = 30; // the work feed's pollAfterSeconds when it sends none

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {any} body
   */
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Where the key and cursor live: ZIKI_AGENT_CONFIG, else $XDG_CONFIG_HOME/ziki/agent.json.
 * @param {Record<string, string | undefined>} [env]
 */
export function configPath(env = process.env) {
  if (env.ZIKI_AGENT_CONFIG) return env.ZIKI_AGENT_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "ziki", "agent.json");
}

/** @param {string} file */
export async function loadConfig(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (/** @type {any} */ (error)?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Write the config owner-only (0600) and replace it atomically, so a crash
 * mid-write can't leave a half-written key.
 * @param {string} file
 * @param {object} config
 */
export async function saveConfig(file, config) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

/** Seconds from a Retry-After header (whole seconds or an HTTP date), as ms. */
export function retryAfterMs(headers, now = Date.now()) {
  const raw = headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds))
    return Math.min(Math.max(seconds, 0) * 1000, MAX_PAUSE_MS);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_PAUSE_MS);
}

/**
 * Pause until the budget resets when the server says nothing is left.
 * Reads RateLimit-Remaining and RateLimit-Reset (seconds until reset, or an
 * epoch in seconds). Returns null when the headers are absent.
 */
export function budgetPauseMs(headers, now = Date.now()) {
  const remaining = headers?.get?.("ratelimit-remaining");
  const reset = headers?.get?.("ratelimit-reset");
  if (
    remaining === null ||
    remaining === undefined ||
    reset === null ||
    reset === undefined
  )
    return null;
  if (Number(remaining) > 0) return null;
  const value = Number(reset);
  if (!Number.isFinite(value)) return null;
  const ms = value > 1e9 ? value * 1000 - now : value * 1000;
  return Math.min(Math.max(ms, 0), MAX_PAUSE_MS);
}

/** 1s, 2s, 4s ... capped at 60s. */
export function backoffMs(attempt) {
  return Math.min(60_000, 1000 * 2 ** attempt);
}

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} link */
function openInBrowser(link) {
  const url = new URL(link);
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url.href]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url.href]]
        : ["xdg-open", [url.href]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/**
 * Run `command` in a shell with the event as one JSON line on stdin.
 * @param {string} command
 * @param {any} event
 * @param {Record<string, string>} extraEnv
 * @returns {Promise<number>} the exit code
 */
function runCommand(command, event, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, ...extraEnv },
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.on("error", () => {}); // the command may exit without reading
    child.stdin.end(`${JSON.stringify(event)}\n`);
  });
}

/** Everything that touches the outside world, so tests can replace it. */
export function makeContext(overrides = {}) {
  return {
    fetch: globalThis.fetch,
    sleep: realSleep,
    now: () => Date.now(),
    /** Progress for people goes to stderr so stdout stays clean JSON lines. */
    log: (/** @type {string} */ line) => process.stderr.write(`${line}\n`),
    out: (/** @type {string} */ line) => process.stdout.write(`${line}\n`),
    openUrl: openInBrowser,
    runCommand,
    env: process.env,
    ...overrides,
  };
}

/** @typedef {ReturnType<typeof makeContext>} Context */

/**
 * Call the API. A 429 waits for Retry-After and tries again. Network errors and
 * 5xx back off and try again. Other 4xx (including 401) throw straight away.
 * A 304 (sent when `If-None-Match` matches) returns with `data: null`.
 * @param {Context} ctx
 * @param {string} baseUrl
 * @param {string} route e.g. "/api/v1/events?wait=25", or a full URL
 * @param {{ method?: string, body?: any, key?: string, retries?: number, headers?: Record<string, string> }} [options]
 */
export async function api(ctx, baseUrl, route, options = {}) {
  const {
    method = "GET",
    body,
    key,
    retries = Infinity,
    headers = {},
  } = options;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await ctx.fetch(new URL(route, baseUrl), {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      const wait = backoffMs(attempt);
      ctx.log(
        `Network error (${/** @type {Error} */ (error).message}). Retrying in ${Math.round(wait / 1000)}s.`,
      );
      await ctx.sleep(wait);
      continue;
    }

    if (response.status === 429 && attempt < retries) {
      const wait = retryAfterMs(response.headers) ?? backoffMs(attempt);
      ctx.log(
        `Rate limited. Waiting ${Math.ceil(wait / 1000)}s (Retry-After).`,
      );
      await ctx.sleep(wait);
      continue;
    }
    if (response.status >= 500 && attempt < retries) {
      const wait = backoffMs(attempt);
      ctx.log(
        `Server error ${response.status}. Retrying in ${Math.round(wait / 1000)}s.`,
      );
      await ctx.sleep(wait);
      continue;
    }

    if (response.status === 304)
      return { data: null, headers: response.headers, status: 304 };
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.error ?? data?.message ?? response.statusText;
      if (response.status === 401) {
        throw new ApiError(
          "The server rejected the key (401). Run `pair` again to get a new one.",
          401,
          data,
        );
      }
      throw new ApiError(
        `${method} ${route} failed: ${response.status} ${detail}`,
        response.status,
        data,
      );
    }
    return { data, headers: response.headers, status: response.status };
  }
}

/**
 * Pair this machine with an owner: start the device-code flow, open the approval
 * page, poll until the owner approves, then store the key.
 * @param {Context} ctx
 * @param {{ name: string, model?: string, url?: string, open?: boolean, configFile: string }} options
 */
export async function pair(ctx, options) {
  const { name, model, level, open = true, configFile } = options;
  const baseUrl = options.url ?? DEFAULT_URL;
  if (!name) throw new Error('--name is required, e.g. --name "Ada\'s Claude"');

  const start = await api(ctx, baseUrl, "/api/v1/agents/pairing", {
    method: "POST",
    body: { name, ...(model ? { model } : {}), ...(level ? { level } : {}) },
    retries: 5,
  });
  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri_complete: link,
    expires_at: expiresAt,
  } = start.data;
  let intervalMs = Math.max(Number(start.data.interval) || 5, 1) * 1000;

  ctx.log(`Approve this agent while signed in (code ${userCode}):\n  ${link}`);
  if (open) {
    try {
      ctx.openUrl(link);
    } catch {
      ctx.log("Could not open a browser. Open the link above yourself.");
    }
  }

  const deadline = Date.parse(expiresAt);
  while (true) {
    await ctx.sleep(intervalMs);
    if (Number.isFinite(deadline) && ctx.now() > deadline) {
      throw new Error(
        "Pairing expired before it was approved. Run `pair` again.",
      );
    }

    let response;
    try {
      response = await ctx.fetch(
        new URL("/api/v1/agents/pairing/token", baseUrl),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ device_code: deviceCode }),
        },
      );
    } catch (error) {
      ctx.log(
        `Network error while waiting (${/** @type {Error} */ (error).message}). Still waiting.`,
      );
      continue;
    }
    const data = await response.json().catch(() => null);

    if (response.ok && data?.api_key) {
      const config = {
        url: baseUrl,
        apiKey: data.api_key,
        agentId: data.agent?.id ?? null,
        name: data.agent?.name ?? name,
        projectId: data.project_id ?? null,
        cursor: null,
        pairedAt: new Date(ctx.now()).toISOString(),
      };
      await saveConfig(configFile, config);
      ctx.log(
        `Paired as "${config.name}". Key saved to ${configFile} (owner-only).`,
      );
      await confirmIdentity(ctx, config);
      return config;
    }
    if (data?.error === "authorization_pending") continue;
    if (response.status === 429 || data?.error === "slow_down") {
      intervalMs += 5000;
      await ctx.sleep(retryAfterMs(response.headers) ?? 0);
      continue;
    }
    if (data?.error === "expired_token")
      throw new Error(
        "Pairing expired before it was approved. Run `pair` again.",
      );
    if (data?.error === "used_token")
      throw new Error("That pairing was already collected. Run `pair` again.");
    throw new Error(
      `Pairing failed: ${response.status} ${data?.error ?? response.statusText}`,
    );
  }
}

/** @param {Context} ctx @param {any} config */
async function confirmIdentity(ctx, config) {
  try {
    const me = await api(ctx, config.url, "/api/v1/agents/me", {
      key: config.apiKey,
      retries: 2,
    });
    ctx.log(
      `Confirmed with GET /api/v1/agents/me: ${me.data?.name ?? config.name}.`,
    );
  } catch (error) {
    ctx.log(
      `Saved the key, but could not confirm it: ${/** @type {Error} */ (error).message}`,
    );
  }
}

/** One page of GET /api/v1/events. */
async function pollEvents(ctx, config, cursor, wait) {
  const query = new URLSearchParams();
  if (cursor) query.set("after", cursor);
  if (wait > 0) query.set("wait", String(wait));
  const qs = query.toString();
  const result = await api(
    ctx,
    config.url,
    `/api/v1/events${qs ? `?${qs}` : ""}`,
    { key: config.apiKey },
  );
  const pause = budgetPauseMs(result.headers, ctx.now());
  if (pause) {
    ctx.log(
      `Read budget used up. Pausing ${Math.ceil(pause / 1000)}s until it resets.`,
    );
    await ctx.sleep(pause);
  }
  return {
    events: result.data?.events ?? [],
    cursor: result.data?.cursor ?? cursor ?? null,
    hasMore: Boolean(result.data?.hasMore),
  };
}

/**
 * Read through existing events without handling them, so a first run does not
 * replay the whole history. Returns the cursor to start from.
 */
async function fastForward(ctx, config) {
  let cursor = null;
  while (true) {
    const page = await pollEvents(ctx, config, cursor, 0);
    cursor = page.cursor;
    if (!page.hasMore) return cursor;
  }
}

/**
 * Follow the event stream. Each new event goes to `exec` (a shell command that
 * gets the event as one JSON line on stdin) or is printed as a JSON line. The
 * cursor is saved after every page, so a restart carries on where it left off.
 * Events are delivered at least once: a crash mid-page repeats that page.
 * @param {Context} ctx
 * @param {{ configFile: string, exec?: string, types?: string[], wait?: number, replay?: boolean, maxPolls?: number, signal?: AbortSignal }} options
 */
export async function watch(ctx, options) {
  const {
    configFile,
    exec,
    types,
    replay = false,
    maxPolls = Infinity,
    signal,
  } = options;
  const wait = Math.min(
    Math.max(Math.trunc(options.wait ?? MAX_WAIT_SECONDS), 0),
    MAX_WAIT_SECONDS,
  );
  const config = await loadConfig(configFile);
  if (!config?.apiKey) throw new Error("No saved key. Run `pair` first.");

  let cursor = config.cursor ?? null;
  if (!cursor && !replay) {
    ctx.log(
      "First run: skipping existing events. Use --replay to handle them.",
    );
    cursor = await fastForward(ctx, config);
    await saveConfig(configFile, { ...config, cursor });
  }
  ctx.log(`Watching ${config.url} as "${config.name}". Press Ctrl+C to stop.`);

  for (let polls = 0; polls < maxPolls && !signal?.aborted; polls++) {
    const page = await pollEvents(ctx, config, cursor, wait);
    for (const event of page.events) {
      if (types && !types.includes(event.type)) continue;
      await handleEvent(ctx, { exec, configFile, config }, event);
    }
    if (page.cursor !== cursor) {
      cursor = page.cursor;
      await saveConfig(configFile, { ...config, cursor });
    }
    // An empty page that returned at once (wait=0, or a server that ignores
    // `wait`) would spin, so idle briefly before asking again.
    if (!page.events.length && !page.hasMore)
      await ctx.sleep(wait > 0 ? 1000 : 5000);
  }
}

/** @param {Context} ctx @param {{ exec?: string, configFile: string, config: any }} target @param {any} event */
async function handleEvent(ctx, { exec, configFile, config }, event) {
  if (!exec) {
    ctx.out(JSON.stringify(event));
    return;
  }
  // The command gets where to find the key, never the key itself.
  const code = await ctx.runCommand(exec, event, {
    ZIKI_URL: config.url,
    ZIKI_AGENT_CONFIG: configFile,
    ZIKI_EVENT_ID: String(event.id ?? ""),
    ZIKI_EVENT_TYPE: String(event.type ?? ""),
    ZIKI_ISSUE_ID: String(event.bugId ?? ""),
  });
  if (code !== 0)
    ctx.log(
      `Command exited ${code} for ${event.type} ${event.id}. Carrying on.`,
    );
}

/**
 * The work feed URL for this key: the `workUrl` of the project named by
 * `--project` (an id or slug), else the saved project, else the first one in
 * GET /api/v1/agents/me. Guest workspaces count as available projects.
 * @param {Context} ctx @param {any} config @param {string} [project]
 */
export async function workUrl(ctx, config, project) {
  const me = await api(ctx, config.url, "/api/v1/agents/me", {
    key: config.apiKey,
    retries: 5,
  });
  // The feed address is `/<org>/<project>/work`, so use the `workUrl` Ziki
  // sends for each project rather than building one from an id.
  const projects = [
    ...(me.data?.projects ?? []),
    ...(me.data?.guest_workspaces ?? []).flatMap((workspace) => workspace.projects ?? []),
  ];
  const requested = project ?? config.projectId;
  const selected = requested
    ? projects.find((item) => item.id === requested || item.slug === requested)
    : projects[0];
  if (!selected?.workUrl)
    throw new Error(
      requested
        ? `No project matching "${requested}" is available to this key. Use an id or slug from GET /api/v1/agents/me.`
        : "This key has no project. Pass --project <slug-or-id>.",
    );
  return selected.workUrl;
}

/**
 * Read the work feed: everything this agent can do in the project. Without
 * `watch` it prints the feed once. With `watch` it polls every
 * `pollAfterSeconds` with If-None-Match (an unchanged feed is a 304, still one
 * read) and prints each new item you can act on (`canAct`) as a JSON line,
 * keyed by `key`. The feed's `ask` lines go to stderr when they change.
 * @param {Context} ctx
 * @param {{ configFile: string, project?: string, watch?: boolean, maxPolls?: number, signal?: AbortSignal }} options
 */
export async function work(ctx, options) {
  const {
    configFile,
    project,
    watch: keepWatching = false,
    maxPolls = Infinity,
    signal,
  } = options;
  const config = await loadConfig(configFile);
  if (!config?.apiKey) throw new Error("No saved key. Run `pair` first.");
  const url = await workUrl(ctx, config, project);

  if (!keepWatching) {
    const result = await api(ctx, config.url, url, { key: config.apiKey });
    ctx.out(JSON.stringify(result.data, null, 2));
    return;
  }

  ctx.log(`Watching ${url} as "${config.name}". Press Ctrl+C to stop.`);
  let etag = null;
  let seen = new Set();
  let asked = "";
  let pollSeconds = WORK_POLL_SECONDS;
  for (let polls = 0; polls < maxPolls && !signal?.aborted; polls++) {
    if (polls > 0) await ctx.sleep(pollSeconds * 1000);
    const result = await api(ctx, config.url, url, {
      key: config.apiKey,
      headers: etag ? { "If-None-Match": etag } : {},
    });
    const pause = budgetPauseMs(result.headers, ctx.now());
    if (pause) {
      ctx.log(
        `Read budget used up. Pausing ${Math.ceil(pause / 1000)}s until it resets.`,
      );
      await ctx.sleep(pause);
    }
    if (result.status === 304 || !result.data) continue;
    etag = result.headers?.get?.("etag") ?? null;
    pollSeconds = Math.max(
      Number(result.data.pollAfterSeconds) || WORK_POLL_SECONDS,
      1,
    );

    const ask = (result.data.ask ?? []).join("\n");
    if (ask && ask !== asked) ctx.log(ask);
    asked = ask;

    const current = new Set();
    for (const item of result.data.items ?? []) {
      current.add(item.key);
      if (item.canAct && !seen.has(item.key)) ctx.out(JSON.stringify(item));
    }
    // An item that goes away and comes back is new work again.
    seen = current;
  }
}

const HELP = `ziki-agent: reference client for the Ziki agent API

Usage:
  node scripts/ziki-agent.mjs pair --name <name> [--model <model>] [--level <level>] [--url <site>] [--no-open]
  node scripts/ziki-agent.mjs work [--watch] [--project <slug-or-id>]
  node scripts/ziki-agent.mjs watch [--exec <command>] [--types a,b] [--wait <0-25>] [--replay]

pair   Start device-code pairing, open the approval page, save the key.
work   Print the project's work feed: everything you can do, in one list.
       work --watch is how to wait for work: it polls the feed about
       every 30 seconds (If-None-Match, so an unchanged feed is a 304) and
       prints each new item you can act on as a JSON line.
watch  For reacting to activity, not finding work. Long-polls events. Each
       event goes to --exec as a JSON line on stdin, or is printed as a JSON
       line. Resumes from the saved cursor.

Options:
  --url <site>     Ziki site (default ${DEFAULT_URL}; or set ZIKI_URL)
  --level <level>  Agent class to request: working (default; old role names are mapped)
  --config <file>  Key file (default ~/.config/ziki/agent.json; or ZIKI_AGENT_CONFIG)
  --project <p>    work: project slug or id (default: the saved project, else the first one)
  --replay         On first run, handle existing events instead of skipping them
`;

/**
 * @param {string[]} argv
 * @param {Context} [ctx]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, ctx = makeContext()) {
  const [command, ...rest] = argv;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    ctx.out(HELP);
    return command ? 0 : 1;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: "string" },
      model: { type: "string" },
      level: { type: "string" },
      url: { type: "string" },
      config: { type: "string" },
      exec: { type: "string" },
      types: { type: "string" },
      wait: { type: "string" },
      replay: { type: "boolean" },
      once: { type: "boolean" },
      watch: { type: "boolean" },
      project: { type: "string" },
      "no-open": { type: "boolean" },
    },
    strict: true,
  });
  const configFile = values.config ?? configPath(ctx.env);
  const url = values.url ?? ctx.env.ZIKI_URL ?? DEFAULT_URL;

  try {
    if (command === "pair") {
      await pair(ctx, {
        name: values.name ?? "",
        model: values.model,
        level: values.level,
        url,
        open: !values["no-open"],
        configFile,
      });
      return 0;
    }
    if (command === "work") {
      const abort = new AbortController();
      process.once("SIGINT", () => abort.abort());
      await work(ctx, {
        configFile,
        project: values.project,
        watch: values.watch,
        maxPolls: values.once ? 1 : Infinity,
        signal: abort.signal,
      });
      return 0;
    }
    if (command === "watch") {
      const abort = new AbortController();
      process.once("SIGINT", () => abort.abort());
      await watch(ctx, {
        configFile,
        exec: values.exec,
        types: values.types
          ? values.types
              .split(",")
              .map((type) => type.trim())
              .filter(Boolean)
          : undefined,
        wait: values.wait === undefined ? undefined : Number(values.wait),
        replay: values.replay,
        maxPolls: values.once ? 1 : Infinity,
        signal: abort.signal,
      });
      return 0;
    }
    ctx.log(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  } catch (error) {
    ctx.log(`Error: ${/** @type {Error} */ (error).message}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
