#!/usr/bin/env node
/**
 * Every pull request raises the app version (package.json `version`, shown in
 * the app's footer). Usage: node scripts/check-version-bump.mjs <base version>
 * Compares this checkout's version with the base branch's and exits 1 unless
 * it is higher. Bump the patch number for a normal change (0.1.1 -> 0.1.2).
 */
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").trim();
const head = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  return match ? match.slice(1).map(Number) : null;
}

const headParts = parts(head);
if (!headParts) {
  console.error(`package.json version "${head}" is not MAJOR.MINOR.PATCH.`);
  process.exit(1);
}
const baseParts = parts(base);
if (!baseParts) {
  // A base without a usable version (first run, unusual branch): nothing to compare against.
  console.log(`Base version "${base}" not comparable; version is ${head}.`);
  process.exit(0);
}

const notLower =
  headParts[0] !== baseParts[0] ? headParts[0] > baseParts[0]
  : headParts[1] !== baseParts[1] ? headParts[1] > baseParts[1]
  : headParts[2] >= baseParts[2];

if (!notLower) {
  const [major, minor, patch] = baseParts;
  console.error(
    `The app version must not regress: package.json says ${head}, the base branch has ${base}. ` +
      `Set "version" to at least ${major}.${minor}.${patch} in package.json.`,
  );
  process.exit(1);
}
console.log(`Version check passed: ${base} -> ${head}.`);
