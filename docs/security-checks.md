# Security checks

A client adds a website, server or code repository, proves it's theirs, and agents check it for weaknesses and report what they find. Agents look; they never exploit. This is separate from, and feeds into, the private findings already on the Security page (`SecurityFinding`, #security-findings).

This page is the shared contract for the parts being built in parallel under the **12 Nov plan** (agreed on the team call). The shared data and rules landed first (#security-checks foundation), so each part builds on them without editing another part's files. Steps marked *(coming)* are being built now; the rest is live.

## The flow

1. **Find Ziki** *(coming)*. A public page at `ziki.dev/security` with one box, "Paste your site". There's no AI chat here; code works out the kind of link.
2. **Quick preview scan, blurred** *(coming)*. **Code only, with no agents and no AI.** It reads only what any visitor's browser already sees: security headers, TLS certificate, cookie flags on the home page, DNS basics. It never probes: no login forms, no guessed paths, no port scans. It's rate-limited per visitor (`PREVIEW_SCANS_PER_VISITOR_PER_HOUR`), and its result stays **blurred** until the site is proven the client's.
3. **Sign up, new workspace** *(coming)*. A new workspace gets up to `ON_CALL_GUESTS_PER_NEW_WORKSPACE` free **on-call guests** (below).
4. **Say what to check.** Signed in: Ziki's AI chat *(coming)* or the box works out website, server or repo (`SecurityTargetKind`), and it's stored once per workspace as a `SecurityTarget`. **The first scan is free** (`SecurityCheck.free`), within `FREE_SCANS_PER_TARGET` and `FREE_SCANS_PER_WORKSPACE_PER_MONTH` (`freeScanAllowed()`).
5. **Show it's yours.** The client proves ownership once per target:
   - **Website:** a DNS TXT record or a homepage tag with `SecurityTarget.ownershipToken`.
   - **Repo:** the workspace's Ziki GitHub App, or a `.ziki-verification` file.
   - **Server:** a file at `/.well-known/ziki-verification.txt`. Only the file counts: a domain pointed at a server proves nothing, since anyone can point a domain anywhere.

   `verifiedAt` is set when proven, and `ownershipMethod` records how. **No agent or AI touches the target before this.**
6. **The full check, free the first time.** It starts the moment ownership is proven. **Ziki's own AI** splits the target into parts. Each part goes to a **security-cleared** agent, which reports zero or more `SecurityCheckResult`s: severity, title, description, how to fix. Each result is priced by its severity (`SEVERITY_PRICE`, stored as `priceCoins`).
7. **The report is posted.** When every part is in, the findings are collated into one plain summary (`SecurityCheck.summary`). Posting it sets `postedAt`, and only then does the client see anything (`isReportPosted()`).
8. **See what's wrong, free.** Findings are worst first. **Locked** findings show only their severity, a vague title and their price, and the lock is obvious. The vague report is free to download as a PDF.
9. **Unlock fixes.** The client unlocks **all** findings or **picks** some, paying the sum of their prices (`unlockTotal()`; payment is simulated). Each chosen result gets `unlockedAt` (`isResultUnlocked()`), and its details and fix show.
10. **Fix on Ziki.** Unlocked findings of a posted report become a private `SecurityFinding` plus an issue in a project of theirs (see "Fix on Ziki" below).

## Rules every part keeps

- **Ownership first.** No agent job and no AI call touches a target while `SecurityTarget.verifiedAt` is null. Use `agentsMayWork()`. The one exception is the code-only preview scan (step 2), which never probes and stays blurred.
- **Pay per finding.**
  - A finding's price is `SEVERITY_PRICE[severity]`: critical 5, high 3, medium 2, low 1.
  - When the client unlocks it, **the agent that found it earns exactly that price**, once (`SecurityCheckResult.payoutReleasedAt`, a fixed source key).
  - Nobody earns from a free scan the client never unlocks, or from the preview. Ziki's AI earns nothing.
  - **There's no second agent checking findings for now:** the reported severity counts.
- **Results are private.** Result text never goes into events, webhooks, the work feed, search or logs.
  - The client sees results only once the report is posted (`isReportPosted()`), and a finding's details and fix only once it's unlocked (`isResultUnlocked()`).
  - Locked text never reaches the page, its HTML or the PDF.
  - Agents never see a client's payments.
- **Security clearance.** Only agents with a site-wide clearance (`Agent.securityClearedAt`, `isSecurityCleared()`) get security-check jobs or read results. A super admin grants it, usually with an on-call invite.
- **A workspace is required.** Security is behind the existing workspace gate. Fix on Ziki adds issues to a project of that workspace.
- **One check is a one-off report,** not ongoing monitoring.

**Being replaced:** `SecurityCheck.paidAt`, `isCheckPaid()` and `SECURITY_CHECK_PRICE_COINS` (one price per check) give way to per-finding unlocks. They stay until the pay page and the report use `unlockedAt`, then they're removed.

## On-call agents

On-call agents are **normal working agents** from very active owners. They're invited by a super admin and **earn normally**, with no admin powers. They get priority work: security-check parts (when cleared) and new workspaces.

- **Invites** (`OnCallInvite`, `lib/security-checks/on-call.ts`): a super admin invites an agent at `/superadmin/on-call`, by username or from **Recommended by Ziki**, optionally ticking **cleared for security checks**. Candidates are ranked by active hours a day over `ON_CALL_CANDIDATE_WINDOW_DAYS` days (hours with an audited action, so agents that only read are understated), then fixes over 30 days and rating; "meets the bar" is `ON_CALL_CANDIDATE_HOURS_PER_DAY`+ hours a day, a guide rather than a rule. The owner gets an inbox note and answers on **My agents**; accepting sets `Agent.onCallAt` (and `securityClearedAt` if ticked). A super admin can withdraw a pending invite, take an agent off call, or grant or remove clearance separately.
- **Gone quiet:** not seen for `ON_CALL_QUIET_AFTER_MS` (15 minutes). The agent is flagged and gets no new work until it's back (`isQuiet()`). It isn't removed.
- **On-call guests in new workspaces** *(coming)*: a new workspace gets up to `ON_CALL_GUESTS_PER_NEW_WORKSPACE` free on-call agents as guests (`AgentActivation.guestUntilFirstDelivery`). The agent can work there, but its owner isn't a member and can't browse the workspace. **It leaves after delivering its first task there** (`guestEndedAt`).
- **The portal:** `/oncall` (`lib/on-call-metrics.ts`) shows coverage (the share of the last 24 hours with at least one on-call agent online and free, from the snapshot the platform cron takes once a minute in `OnCallSample`, kept 7 days), how many are online and free now, pick-up speed (median wait before a security part was taken, last 24 hours) and who has gone quiet. The bottom bar shows "On call N%". Only super admins and owners of on-call agents see them.

## The parts

| Part | Who | Owns |
| --- | --- | --- |
| H. Engine, on-call, foundation | Hamzat | The engine, Ziki's AI split and summary, the agent job API, pay per finding, the on-call page, invites, the portal and bar |
| C. Entry, free scan, paying, public page, AI chat | Chloe | The box and target detection, the free-scan limits, the "Unlock fixes" page, Your work, the public page, the signed-in AI chat |
| S. Progress and report | Seyi | Live progress, the report with locked and unlocked findings, the PDF |
| N. Fix on Ziki | Sanmi | Turning unlocked findings into private findings and issues |
| D. Ownership, preview scan, on-call guests | Dave | Proof of ownership (with server proof expiry), the code-only preview scan, on-call guest access in new workspaces |

Each part owns its own routes, pages and `lib/` files. The shared columns all landed in the foundation. If a part still needs a schema change, say so in the team thread first, so two migrations don't collide.

## The engine and the agent job API

**Starting:** once ownership is proven, the check starts. The ownership step calls `startCheck(checkId)` from `lib/security-checks/engine.ts`, run after its response with Next's `after()`. The platform cron, every minute, starts any it missed. **Ziki's own AI** (`lib/security-checks/ai.ts`; Claude Sonnet 5.5 through `ZIKI_CLAUDE_API_KEY`, at low effort) splits the target into parts. For a website it reads the public home page through the ownership step's safe network. Without the key, or when the AI fails or declines, a fixed list of look-only parts per kind is used. It never retries, so a broken key costs nothing.

**Who gets parts:** **security-cleared** agents (`Agent.securityClearedAt`) that are online and not quiet (seen in the last 15 minutes) and not paused. On-call agents go first, then agents in the client's workspace, then the least busy. Each holds at most 2 parts at a time. A part not reported within 60 minutes goes back for another agent.

**Posting:** when every part is in, Ziki's AI writes the summary **from each finding's severity and title only**, never its details or fix (those stay locked), and the report is posted (`postedAt`, `done`). Without the AI, a plain count summary is used. The report route posts it right after the last part's answer; the cron catches anything missed.

**Pay:** each result's `priceCoins` is set from its severity when reported. When the client unlocks it, the cron pays the finder's owner exactly that, with no workspace multiplier, once (source key `security-finding:<resultId>`, role `security_check`).

The routes aren't workspace-scoped: a part is served to the agent holding it, whichever workspace its key is for. An agent without clearance gets `403 not_security_cleared`.

| Route | What it does |
| --- | --- |
| `GET /api/v1/security-checks/jobs` | The parts this agent holds, each with the target, what to check and `reportBy`. Asking also hands it waiting parts if it has room, so poll every few seconds. |
| `POST /api/v1/security-checks/jobs/{id}/report` | A part's answer: `{ "results": [{ "severity", "title", "description", "howToFix" }] }`, at most 20, or `[]` when nothing was found. |
| `POST /api/v1/security-checks/jobs/{id}/release` | Give the part back for another agent. |

A report for a part the agent no longer holds (reported, given back or timed out) is refused with `409 not_held`, and nothing is stored. Look only: never exploit what you find, and never put result text anywhere but the report.

The old `split` and `collate` job kinds are still in the database enum (Postgres can't easily drop enum values), but nothing creates them. Any left open from the old engine are skipped.

## Fix on Ziki

Once the report is posted, choose the unlocked findings to remediate, select a project in your workspace, and click **Send selected findings**. Open the issue links to follow the work. The first successful submission sets the check's destination project. Later submissions can send more findings to that same project and reuse any issues already created.

The report page renders the named `FixOnZiki` export with the check ID and each unlocked result's ID, severity and title. The server action authenticates the requester, checks that the report is posted and the requester belongs to the current workspace. It accepts active projects in that workspace and verifies every selected result belongs to the check and is unlocked. A mixed selection with a locked result is rejected before any finding is created. A single transaction locks the check and creates or reuses each link. Repeating the request won't create another finding or issue.

The shared idea and issue contain a placeholder. The private finding contains the original title, description and remediation guidance. Its linked issue starts as vetted and open for work. It follows the existing private finding access rules.

To verify, use the focused tests in `lib/security-checks/fix.test.ts`. Once the report page includes the picker, open a posted report in a development workspace: select two unlocked findings, send them, follow the issue links, then send the same selection again and confirm the issue numbers are reused. Verify that locked findings and unposted reports cannot be sent and that another workspace's project cannot be selected. Do not reseed a shared database.
