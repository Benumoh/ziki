
## 2026-11-12 — Fix on Ziki for paid security checks (#897)

- Started from the shared security-check models and the existing private finding conversion. The paid report has no remediation picker in Part 5 yet.
- Added a named picker, authenticated project lookup and an atomic submission. It locks the check, verifies the requester, payment, project and result IDs, and reuses linked findings on repeat requests.
- The existing converter creates a vetted issue with placeholder text. The result text is copied inside PostgreSQL into the private finding. The report page hookup belongs to Part 4.
- Full lint and type check passed. The full unit suite timed out after a Windows fork worker stopped responding. The focused run passed 60 tests across the picker, private finding workflow, vetted conversion and security engine. The repository recheck passed lint, typecheck and 36 tests across the two edited test files.
- Outcome: Part 5 is ready for PR review. An integrated report-page and PostgreSQL run remains outstanding because Part 4 is separate and the local Docker daemon is unavailable.

- PR #647 review: merged main at 321a15ea after #643 and #648. Fixed the version conflict at 0.1.121 and gated the picker lookup and locked submission on the shared posted-report check. Added regressions for paid, unposted checks.
- The version gate, Prisma generation, focused lint, full type check and all 38 affected tests passed. Ready to rerun GitHub CI on PR #647.

## 2026-11-12 — N1 per-finding unlock follow-up (#897)

- The existing #647 implementation is on main alongside Dave's #643 and Hamzat's H0 (#651). Fast-forwarded the existing branch to cad84e5f.
- Replaced check-wide payment with the shared posted-report and per-result unlock checks. Kept the existing transaction, private finding links and named picker. The shared converter now records that the client selected an unlocked finding.
- Seyi's report already mounts the picker. Its per-finding update should pass only unlocked results from posted reports.
- Fast-forwarded to fe40886f after the free-scan PR merged and bumped the package from 0.1.125 to 0.1.126.
- Verification: the version gate, diff check, and full recheck passed. Lint reported 28 warnings and no errors, typecheck passed, and all 1,809 unit tests passed. The focused run passed all 45 tests.
- Outcome: N1 is verified locally and ready for PR review. The repeat submission tests use mocked database calls. The report page integration is part of Seyi's follow-up.

## 2026-11-13 — Sync N1 with the report integration (#908)

- Merged main after Seyi's #659 and raised the package version from 0.1.137 to 0.1.138. Confirmed the report page passes only unlocked findings to the picker after posting.
- The version check, lint and all 1,894 unit tests passed. The first typecheck hit a local Node memory limit while running alongside lint. Retrying typecheck separately and verifying the final PR head in GitHub CI.

## 2026-11-14 — Rename the finding picker

- Updated the picker heading and submit button to Move to your app. The report still reads the existing result-to-finding-to-issue link. The new report pill is owned by Seyi.

## 2026-11-14 — Standalone move page

- Added the standalone picker with server-priced simulated payment and the existing transactional issue link. The report integration remains a separate change.

- Refreshed the move picker using the Security payment page's severity badges, rounded cards, and blue action button. Grouped project selection and total in the same card.

- Merged upstream main with Seyi's #723, wired its report button to the standalone route, and raised the version to 0.1.176.

- Browser verification on the migrated local demo: opened Seyi's report, followed Move to your app, moved a sample result, and verified the reopened report links to the same Issue #245.

## 2026-11-15 — PR #730 review

- Shared the simulated payment write between unlock and move. The move still writes the linked issue in the same transaction. Moved the page loader into server-only code and added tests for requester scope and mixed prices. Renamed the button to Pay and move.

## 2026-11-16 — Bulk selection on the move page

- Added Select all and Clear selection for findings that can still be moved. Updated the picker to use Zik and Ziks, the currency name in upstream main.

## 2026-11-17 — Stack scan results on upstream main

- Preserved the prototype in a local stash and fast-forwarded to 0d3a55f1. Stacked Quick Scan and Quick checks using upstream rows, severity styles, and checkout links.
- Full verification passed with the regenerated Prisma client: lint, typecheck, and all 2,285 unit tests.

- Restored the posted report summary in the scan header. It shows the total and severity counts in place of the progress bar.
- Matched the artifact summary treatment and linked its action to upstream checkout, prioritizing critical findings that still need fixing.
- Renamed the agent results section to Deeper scan to match upstream terminology.

## 2026-11-18 — Deeper scan payment gate

- Objective and starting point: require 20 Ziks before a new deeper scan starts; upstream `121a186b` started agents immediately after adding a site. Seyi owns the payment UI.
- Checkpoint 1 — Investigation: wallet ledger and check `paidAt`/`free` fields already support transactional charging. Reuse these, preserve historical free checks and the separate 10-Zik rescan, and enforce payment at engine boundaries. No migration or shared database reseed is needed.

- Checkpoint 2 - Implementation: added read-only quote and explicit pay/start actions, transactional 20-Zik debit with idempotent reuse, engine startup/pickup/report/fallback guards, and payment-required data for Seyi. Documented the integration contract and retained the existing sign-in target return flow. Version is 0.1.245.
- Access limitation: the Ziki mistake registry could not be read because this environment's HTTPS request failed; no API write was attempted.

- Checkpoint 3 - Initial verification: lint passed (32 warnings, no errors); 2,268/2,270 unit tests passed, including all 20 new cases. One existing fallback expectation needed the new guard, and the PDF font test exceeded 5 seconds. Typecheck found stale generated Prisma/Next route files after updating main.
- Registry correction: retried read-only access with approved network access, verified chrome--junkie's agent identity, and read the project mistake registry; it returned no entries.
- Review: kept free-quick-scan quotas counting first scans rather than the historical `free` flag, so changing admission payment cannot bypass the existing optional limits. Added payment guards to report collation as well.

- Checkpoint 4 - Recheck: regenerated Prisma client and Next route types without touching database data. Lint and typecheck passed; 2,269/2,270 tests passed. Updated one historical-free engine fixture to include its payment fields under the stricter guard. Consolidated new behavioral coverage into the existing security and action suites, following repo test organization, and omitted two redundant mocked forwarding checks.

- Checkpoint 5 - Final verification: required affected recheck passed: lint clean on changed files, typecheck with no errors, and all 90 tests in the 3 affected files passed, including 18 new behavioral cases. The full-run remainder passed before that targeted repair. Runtime was Node 24.18.0 (repo requests Node 22). `git diff --check` passed. Updated README, security-check integration guide and schema field comments.
- Outcome: backend complete locally on `feat/deeper-scan-payment-gate`, based on upstream `121a186b`; uncommitted and not pushed. Seyi must connect checkout and use `paymentRequired` instead of showing live progress while unpaid. Browser checkout and real PostgreSQL concurrency remain unverified; the retry/rollback tests use transaction doubles. No database was seeded/reset, and no production state was changed.

- Checkpoint 6 - Push preparation: upstream main is still 121a186b (0.1.244). Expanded the Seyi handoff in docs/security-checks.md with action responses, screen states, recovery, sign-in/workspace return, wallet/borrowing behavior, quick-scan-only limitations, and the integration checklist. The owner explicitly authorized this push.
- Checkpoint 7 - Authorized publication: final affected recheck passed again (lint, typecheck, 90 tests). Handoff is complete; proceeding with the authorized commit and fork push. Remote publication verification is reported in chat; Seyi UI/browser integration remains outstanding.

- Checkpoint 8 - Documentation correction: removed the team-specific Seyi handoff from the feature guide at the owner's request. Kept only general feature documentation and server entry points; the agent prompt is supplied in chat instead. Documentation-only change; checked the diff and links, with no implementation changes.

## 2026-11-18 — PR #827 upstream conflict resolution

- Objective and starting point: PR #827 was open with a clean local working tree, but GitHub reported merge conflicts after main advanced to `18820855` (0.1.246).
- Checkpoint 1 — Investigation and resolution: merged upstream main into the existing `feat/deeper-scan-payment-gate` branch without rewriting history. The only conflict was package.json's version; resolved to 0.1.247, the next patch after main. Preserved upstream's wallet banner, borrowing prompt, selection and scan summary changes. Backend payment behavior is unchanged.
- Outcome: conflict resolved locally; verification is pending before the merge commit and any push.

- Checkpoint 2 — Verification: full verification passed lint (32 warnings, no errors) and typecheck; 2,267/2,268 unit tests passed. The only failure was the existing PDF font test exceeding its 5-second timeout. The unchanged-state recheck declined to rerun it; the isolated `pnpm exec vitest run tests/security/security-checks.test.ts` then passed all 41 tests without changing code or timeouts. `git diff --check` passed and no unmerged paths remain.
- Outcome: ready as a local merge commit at version 0.1.247. Push awaits the owner's approval under their earlier do-not-push-without-asking instruction; PR #827 has not yet received this conflict resolution.

- Checkpoint 3 — New upstream merge: main advanced again to `306f55ad` through PR #831, adding the three-step scan page and moving main to 0.1.247. Merged it into the existing branch cleanly and raised this branch to 0.1.248. No manual UI or backend conflict resolution was needed; verification follows before publication.

- Checkpoint 4 — Final verification for the refreshed resolution: the full run passed lint (0 errors, 32 warnings), typecheck and all 2,271 unit tests across 167 files. The prior PDF timeout did not recur. No unmerged paths or whitespace errors remain. Preserved main's three-step scan UI and its paymentRequired/Start-event integration hook.
- Outcome: resolution complete locally at version 0.1.248, ready for the approved publication step. No push has been performed; awaiting the owner's explicit push approval.

## 2026-11-18 — Wallet Activity labels for security payments

- Objective and starting point: the Ziks Activity list calls every `check_payment` an unlock, including the 20-Zik deeper scan and 10-Zik rescan. Confirmed PR #827 merged; created the owner-approved `feat/wallet-activity-label-fix` branch from upstream main `08dc6715` (0.1.248), preserving the previous branch.
- Checkpoint 1 — Investigation: the immutable ledger already distinguishes scan admission (`deeper-scan:`), rescans (`rescan:`) and finding unlocks (`check:`) in sourceKey. Update only the Activity query/label selection; no payment, accounting, schema or stored history change is required.

- Checkpoint 2 — Implementation: the wallet Activity query now reads sourceKey, and its local label formatter distinguishes deeper scans and rescans before falling back to the existing kind labels. Updated the security-check guide; version is 0.1.249. No new tests assert static copy, in keeping with the repository test rules; existing required verification follows.

- Checkpoint 3 — Verification: full verification passed lint (0 errors, 32 warnings) and typecheck. All 2,259 tests that ran passed, but Vitest exited with two worker-startup timeout errors before the on-call invitation and My stakes files could run. An isolated rerun of those two files passed all 14 tests without code/configuration changes. This is full-run coverage plus a targeted recovery, not a single clean full-suite exit. `git diff --check` passed.
- Outcome: display-only fix complete locally on `feat/wallet-activity-label-fix` at version 0.1.249. Deeper scan/rescan labels use existing reference keys; unlock and all other activity labels keep their prior behavior. No database writes, ledger changes or browser verification were performed. Commit/push publication requires the owner's approval; no push or follow-up PR has been made.
