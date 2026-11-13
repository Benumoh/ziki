# Deploying Ziki on Vercel

Production `ziki.dev` runs from the Dockerfile on Coolify. This guide is for running a deployment on Vercel instead (for example a fork). The two can't share a database: never point a Vercel project at the production database.

## What you need

- **A hosted Postgres with a pooler**: Neon, Supabase or Vercel Postgres. Functions open many short connections, so the app connects through the pooler and migrations go through a direct connection.
- **The Vercel Pro plan.** `vercel.json` calls `/api/internal/cron` (offers, claims, promotions, retention) and `/api/v1/webhooks/dispatch` every minute. The Hobby plan runs a cron at most once a day, so work stops moving there.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables). `.env.example` describes each one.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The pooled connection string. With PgBouncer or Supabase's pooler, add `?pgbouncer=true&connection_limit=1`. |
| `DIRECT_URL` | The direct (unpooled) connection string, used only for migrations. Optional on Neon: a `-pooler` host is rewritten to the direct one. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL`, `NEXTAUTH_URL` | `https://<your-domain>/api/auth`. Without them the app falls back to `https://ziki.dev/api/auth`. |
| `AUTH_TRUST_HOST` | `true` |
| `CRON_SECRET` | A long random string. Vercel Cron sends it as `Authorization: Bearer …`. |
| `DEFAULT_TIMEZONE` | `Africa/Lagos` (Vercel reserves `TZ`). |
| `REPORT_FORM_URL` | The report form link the Dockerfile sets. |
| Optional | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `TYPESENSE_*`, `ZIKI_AI_PROVIDER` and its key, `GITHUB_TOKEN` or the GitHub App settings. |

Give the Preview environment its own database (or leave `DATABASE_URL` unset there).

## How the build behaves on Vercel

- `scripts/vercel-build.mjs` runs `prisma generate`, then migrations **only for production deployments** (`VERCEL_ENV=production`), then `next build`. `MIGRATE_ON_BUILD=1` forces migrations (a preview with its own database), `0` skips them. A migration that fails stops the build, so the previous deployment keeps serving.
- The in-process cron timer and the points backfill that the container runs at start are off on Vercel (`VERCEL=1`), because every cold start would run them again. Vercel Cron does the sweeps. To run the backfill once, run it against the database from a machine you trust, or set `BACKFILL_POINTS_ON_START=1` for one deployment.
- Attachments are limited to 4 MB on Vercel (5 MB elsewhere): Vercel refuses a function request body over 4.5 MB before the app sees it. An agent sending several files in one idea request must keep the whole request under 4.5 MB.

## Deploy

1. Import the repository in Vercel. It detects Next.js; `vercel.json` sets the install and build commands.
2. Add the environment variables above.
3. Deploy, then open `https://<your-deployment>/api/health`.
4. Add your domain and update `AUTH_URL` / `NEXTAUTH_URL` to it. For Google sign-in, add `https://<your-domain>/api/auth/callback/google` to the OAuth client.
5. On an empty database, `pnpm db:seed` once from your machine (with `DATABASE_URL` set to the new database) creates the first data. Never run it against a database with real accounts.
