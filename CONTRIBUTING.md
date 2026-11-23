# Contributing to Ziki Issues

Team **Zendor (Zedu-Endor)** — lead: [@Goodnessmbakara](https://github.com/Goodnessmbakara).

Ziki is a global, multi-tenant issue and task platform where organizations manage projects connected to their own GitHub repositories.

- **Ziki Core Platform Development**: This repository — [`emerjent/ziki`](https://github.com/emerjent/ziki) (renamed from `emerjent/bug-tracker`, formerly `zeduchat/bug-tracker`) — is Team Zendor's **Task 1** **Ziki Issues** project (HNG15). PRs for Ziki itself target **`emerjent/ziki:main`**.
  The legacy `Zedu-Endor/issue-tracker` fork is retired and no longer used.
- **Dynamic Project Repositories**: Across Ziki organizations, each project's target repository is dynamic and configurable by the organization/workspace owner in **Project Settings** (`repoUrl`). Agents working on issues in any project dynamically fetch `Project.repoUrl` (via `GET /api/v1/projects/{id}`) and open pull requests against that project's configured repository.

## Default branch

- Default branch: **`main`**
- Always branch from an up-to-date `main` of the target repository
- For Ziki core platform development, open PRs against `main` in `emerjent/ziki` — never against `zedu-hng` or other Zedu product repos
- For tenant projects on Ziki, open PRs against the project's configured repository (`Project.repoUrl`)

## Branch naming

Prefer a ticket when you have one:

```text
type/ENDOR-<ticket>-short-desc
```

Examples: `feat/ENDOR-12-issue-filters`, `fix/ENDOR-18-login-redirect`

For unticketed mini-project work:

```text
type/short-desc
```

Examples: `feat/create-issue-form`, `chore/seed-demo-data`

Allowed `type` prefixes: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

## Commits and PR titles

Use [Conventional Commits](https://www.conventionalcommits.org/):

- With a ticket: `type(ENDOR-xxx): summary`
- Without a ticket: `type: summary`

Examples:

- `feat(ENDOR-12): add status filter on issues list`
- `fix: prevent duplicate comment submit`
- `docs: clarify local Postgres port`

Keep the subject imperative and under ~72 characters. One logical change per commit when practical.

## Pull requests

1. One logical change per PR — keep diffs reviewable
2. Fill in the PR template (Summary + Test plan)
3. Target the repository configured for the project (`emerjent/ziki:main` for Ziki core development, or the workspace-configured `Project.repoUrl` for tenant projects)
4. Do not mix unrelated refactors with feature work
5. Never force-push (`git push --force`, `-f`, or `--force-with-lease`)
6. Do not commit secrets (`.env`, keys, credentials)
7. Verify once before pushing (`pnpm verify:ready`, then `pnpm verify:recheck` after fixes; see below)
8. Raise the app version: every PR increments `version` in `package.json` (the patch number for a normal change, `0.1.1` → `0.1.2`). The app shows it in the footer, and CI's "Version raised" step fails a PR whose version isn't higher than `main`'s. If `main` moved on while your PR was open, take the next number after `main`'s.

## Verification before pushing

Finish the whole change, tests included, before running any check. Then:

```bash
pnpm verify:ready     # once: lint, typecheck and the full unit suite (`pnpm check` is the same)
# fix every failure it reports, all together
pnpm verify:recheck   # the failing tests plus the tests the fixes affect
pnpm verify:status    # what each run covered, for the PR's test plan
```

`verify:ready` runs every phase even when one fails, keeps a complete log per phase, and reuses a pass only when nothing it depends on has changed. `verify:recheck` runs a full suite again only when a shared input changed (dependencies, configs, the Prisma schema, the runtime), and says so. Don't run tests, lint or typecheck between edits, and don't rerun the full suite after a passing recheck. AGENTS.md ("Testing") has the details.

CI is the release gate: on every PR it runs lint, typecheck, the unit suite, the standalone MCP package, the build, the Playwright end-to-end tests and the CLI scenarios, on the final commit. All PRs must pass CI before they can be merged.

## Testing Guidelines

We prioritize high test confidence. Every new route, server action, API endpoint, or utility should have accompanying unit or integration tests.

```bash
pnpm e2e           # Playwright end-to-end tests
pnpm test:cli      # CLI scenarios: locally only for agent API changes (docs/cli.md)
```

Diagnostic commands, for a specific question rather than routine use: `pnpm vitest run <file>` (one file), `pnpm verify:quick` (tests affected by your branch), `pnpm test:watch` (test-first work on one function).

### Backend Endpoint Testing (`app/api/**`, `app/**/route.ts`)

When adding or modifying backend route handlers, add the decisive cases to the matching file in the critical suite under `tests/` (see AGENTS.md, "The critical suite"):
- **Authentication & Authorization**: Verify that unauthenticated requests receive `401 Unauthorized` and role gates enforce `403 Forbidden` / `404 Not Found`.
- **Input Validation**: Check that malformed payloads or missing query parameters return `400 Bad Request`.
- **Rate Limiting**: Test rate-limited endpoints (e.g. `/api/uploads`, `/api/issues/similar`) to verify `429 Too Many Requests` behavior.
- **Database Interaction**: Mock `@/lib/prisma` calls cleanly with `vi.mock("@/lib/prisma")` to test both successful operations and DB failure handling (`500` / `503`).
- **Headers & Response Formatting**: Verify `Content-Type`, `Content-Disposition`, and cache control headers (e.g. for CSV export or attachment downloads).

### Server Actions Testing (`app/actions/**`)

- Test validation with invalid Zod payloads.
- Test permission checks (`requireUser`, `requireRole`, `requireAdmin`).

### Validations & Schemas

Zod schemas live in `lib/validations/issue.ts`. Keep unit tests covering happy and invalid cases when you change validation rules.

### Database Migrations

Production and CI environments use `prisma migrate deploy` to apply pending migrations. When changing `prisma/schema.prisma`:
1. Always create a corresponding migration folder under `prisma/migrations/<timestamp>_<name>/migration.sql`.
2. Ensure any new columns, tables, or enum values are included in the SQL migration.
3. Test migration applying locally with `pnpm db:migrate` before pushing.

## Autonomous Multi-Agent SDLC Guidelines

When contributing as or alongside autonomous agents:
- **Mistake Registry**: Check `GET /api/v1/projects/{id}/mistakes` (or `ziki_get_project_mistakes`) to learn from past anti-patterns.
- **Evidence Submissions**: Delivered work (`POST /api/v1/issues/{id}/delivery`) carries the pull request, a summary, a description, and visual screenshot proofs (`screenshots`) or test execution outputs (`testResults`), plus a delivery receipt (`receipt`: what was verified and how, what was not and why, and what the reviewer should test). Testers read the receipt from `GET /api/v1/issues/{id}/test-results` and judge against it.
- **Two-Stage Merge Gate**:
  - `manager` agents evaluate mergeability and test verdicts, then accept (status `ready_to_merge`) or reject (back to `in_progress`) the fix.
  - `merger` agents merge the accepted pull request on GitHub themselves after checking its checks pass, report it merged (`POST /api/v1/issues/{id}/pull-request-status`) and resolve it (`POST /api/v1/issues/{id}/resolve`). Ziki never calls GitHub: agents report what they see, and the latest independent report counts.
  - Every agent starts as a `working` agent (file, claim, deliver, confirm, triage, test); a organisation admin grants `manager` and `merger`. See [Agent Levels](./docs/llms/onboarding.md#agent-levels).
- **Finding Work**: Agents watch their project's work feed, `GET /<org>/<project>/work`, about every 30 seconds. It is the one place work appears. Events at `GET /api/v1/events` (or webhooks) are for reacting to activity.

## Continuous Deployment Flow

- **Production (Coolify)**:
  `emerjent/ziki` `main` deploys to production on Coolify (`ziki.dev`, formerly `issues.zedu.chat`). `GET https://ziki.dev/api/health` reports the deployed commit.

## Local development

Commands below run from the root of your clone of this repo.

### 1. Start Postgres

```bash
docker compose up -d
```

Postgres is mapped to **host port 5433**:

- User / password / db: `bugtracker` / `bugtracker` / `bugtracker`
- `DATABASE_URL=postgresql://bugtracker:bugtracker@localhost:5433/bugtracker`
### 2. Environment

```bash
cp .env.example .env
# set AUTH_SECRET (e.g. openssl rand -base64 32)
```

Never commit `.env`.

### 3. Install, migrate, seed

```bash
pnpm install
pnpm db:migrate    # first-time setup only (it runs `prisma migrate dev`)
pnpm db:seed       # empty database only: it wipes users
pnpm db:fixtures   # realistic Demo organisation; sign in as demo@fixtures.local / ziki-demo-password
```

On a database that already has accounts, don't use `db:migrate` or `db:seed`. Check with `pnpm exec prisma migrate status` and apply pending migrations with `pnpm exec prisma migrate deploy`.

The "Ignored build scripts" warning at the end of `pnpm install` is harmless, because `postinstall` still generates the Prisma client.

### 4. Run the app

```bash
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001). `GET /api/health` returns `{"status":"ok"}` once it is up.

- The server reports "Ready" in a few seconds, but the first request to each route compiles it first. The very first request after an install can take a minute or two. After that, responses are well under a second.
- Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, the log shows `googleConfigured: false`. That is expected locally: email/password sign-in is on.
- These warnings in the log are expected: "Slow filesystem detected" (Windows) and "The `middleware` file convention is deprecated".

Demo accounts and more detail: see [README.md](./README.md).

## Code hygiene

- Prefer small, focused PRs
- Match existing TypeScript / Next.js App Router patterns in this repo
- Do not commit `.env`, `.pem`, or credential files
- Do not force-push to any branch shared with the team
