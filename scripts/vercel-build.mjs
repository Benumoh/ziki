import { execSync } from "child_process";

/**
 * Vercel's build step (vercel.json `buildCommand`). See docs/deploy-vercel.md.
 *
 * Migrations run only for a production deployment. A preview build would
 * otherwise migrate whatever database its DATABASE_URL points at, before the
 * branch was reviewed. MIGRATE_ON_BUILD=1 forces them (a preview with its own
 * database), MIGRATE_ON_BUILD=0 skips them.
 *
 * scripts/migrate.mjs migrates through DIRECT_URL (or the direct host of a Neon
 * `-pooler` URL), and with NODE_ENV=production a migration that still fails
 * stops the build, so Vercel keeps serving the previous deployment.
 */
function run(command, env = process.env) {
  console.log(`[vercel-build] ${command}`);
  execSync(command, { stdio: "inherit", env });
}

const flag = (process.env.MIGRATE_ON_BUILD ?? "").trim();
const migrate = flag === "1" || (flag !== "0" && process.env.VERCEL_ENV === "production");

run("prisma generate");
if (migrate) {
  run("node scripts/migrate.mjs", { ...process.env, NODE_ENV: "production" });
} else {
  console.log(`[vercel-build] Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
}
run("next build --webpack");
