# Access-control audit

Daniel's part of the Ziki work split: security, access control and contributions. This records what was checked, what works, what was fixed, and what still needs a decision. Checked against `main` at `a80cd8b6` (16 Nov 2026), and rechecked after merging `main` at `18820855` and then `fded7612` (18 Nov 2026).

## The rules

| Who | Public project | Private project |
| --- | --- | --- |
| Signed-out visitor | Public overview, public issues (`/<org>/<project>/public-issues`), guest ideas when the project accepts them. App pages ask to sign in. | Nothing. It asks them to sign in, exactly as a project that doesn't exist does. |
| Newly registered user, or signed-in non-member | Opens the project and reads it. Can't contribute until they join (open project) or are accepted (request to join). | Nothing (404). |
| Accepted contributor (project member only) | Opens and contributes in that project only. Not an organisation member, never an admin. | Opens it only if they're a member of that project. |
| Organisation member | Every project in the organisation. | Every project in the organisation. |
| Organisation owner or admin | As a member, plus settings, join requests, invites, deleted issues and private security findings. | The same. |
| Site super admin | Everything. | Everything. |

A private project someone can't see always answers exactly like a missing one (404 or "Project not found" when signed in; the sign-in page when signed out). A request never confirms that a private project exists.

## Where it is enforced

| Surface | Gate | Result |
| --- | --- | --- |
| Every page under `/<org>/<project>` | `requireProject` (`lib/project-route.ts`): public, OR a member of the project, OR a member of its organisation | ✅ Works. Tested for every role in `tests/security/access-control-matrix.test.ts`. The site super admin looped between the page and the organisation switch on any organisation they don't belong to; fixed in #836. |
| Organisation area `/<org>/<project>/org/*` | Layout requires organisation membership. Invites and join requests are listed for owners and admins only. | ✅ Works. |
| Issue addresses `/<org>/<project>/<n>`, and the issue page's title and share tags | `findProjectIssue`. Signed out: public projects only. | ✅ Fixed in #679 (Ziki #930). |
| Public issues and project metadata | `findPublicProject`, `findPublicIssue`: public, unarchived, and never a security finding | ✅ Works. |
| Discover, sitemap, project SEO | `visibility: "public"`, unarchived. The sitemap's issues are also never deleted and never a security finding. | ✅ Works. Maria's SEO work uses the same rule. |
| Files `GET /api/attachments/{id}` | Signed in. Then: the finding's own rule for security evidence; organisation member, project member or a public project for issue files; project people only for idea files; admins only for files on deleted issues; the uploader only for files not yet attached | ✅ Works. Tested for every role. |
| Files via the agent API `GET /api/v1/attachments/{id}` | The agent's organisation only, and the finding rule | ✅ Works. |
| Agent API `/api/v1/*` | One key per organisation. Every project and issue lookup is limited to the key's organisation. | ✅ Works (`tests/security/project-scope.test.ts`, `agent-key.test.ts`). |
| Search, similar issues, autocomplete | The signed-in person's current organisation only | ✅ Works. |
| Server actions (comment, confirm, watch, vote, bid, award, report) | Organisation or project membership, or a public project for read-only actions. Bids and awards need an agent switched on in the organisation. | ✅ Works. |
| Project settings (visibility, open for contributors, guest ideas) | Organisation owners and admins. Private forces "open" and "guest ideas" off. | ✅ Works. |
| Reporter details on issue and workstream pages | Names only, never emails | ✅ Fixed in #689 (Ziki #949). |
| Private security findings | Ideas and issues carry a placeholder title and text. The details live in `SecurityFinding`, shown only through `canViewFinding`. | ✅ Works (`tests/security/security-findings.test.ts`). |

## Request to join

| Case | Behaviour | Status |
| --- | --- | --- |
| Public project, open for contributors | One-click Join adds a project membership | ✅ |
| Public project, not open | Request to join, with an optional note of up to 1000 characters | ✅ #679 (Ziki #931) |
| Private project | "Project not found". Nothing is filed. | ✅ #679 |
| Already a member | Refused | ✅ #679 |
| Duplicate while pending (also two sent at once) | Refused, backed by a unique key | ✅ #679 |
| Declined | Can ask again after 24 hours | ✅ #679 |
| Accepted, then removed | Can ask again straight away | ✅ #679 |
| Who decides | Organisation owners and admins, who are notified of each request | ✅ #679 |
| Deciding twice (double click, two admins) | Only the first decision counts | ✅ #679 |
| What acceptance grants | A project membership, never an organisation membership | ✅ (Chloe's call) |

## Open questions (product decisions, not bugs)

These are left as they are: changing them would change the product's requirements.

1. **Accepted contributors can't bring their agents.** An agent can only be switched on in an organisation its owner belongs to (`activateAgent`, `lib/agents/registry.ts`). Bids and claims go through agents. So a person who joined or was accepted into a project can report, comment, confirm and vote, but can't bid on that project's issues with an agent. Should a project membership allow switching an agent on for that project only?
2. **"Authorised maintainers".** The work split says owners *or authorised maintainers* approve requests. Ziki has no maintainer role yet: project memberships have no role, so only organisation owners and admins decide. Is that enough, or do we want a project-level maintainer?
3. **A project made private keeps its outside contributors.** Project members keep access after a public project goes private, and pending requests can still be accepted. That matches "private = its members", but owners may expect going private to close it. Should we warn, or remove outside members, when a project goes private?
4. **The organisation feedback portal names private projects.** `/<org>/feedback` (#832, merged after this audit's recheck) is open to signed-out visitors and lists every unarchived project in the organisation, private ones included, with its name, slug and visibility (`listOrgFeedbackProjects`, `lib/public-projects.ts`). It never shows a private project's goal or issues, and the code says private projects are supported on purpose, so customers can send feedback. But it confirms that a private project exists, which the rule above says nothing else does. Should the portal list private projects only when they opt in, or is a private project's name not secret?

## Evidence

- Merged: #679 (signed-out issue lookups, request to join), #689 (reporter emails).
- Tests: `tests/security/access-control-matrix.test.ts` (new: every role against public and private pages and files), `join-requests.test.ts`, `signed-out-issue-scope.test.ts`, `reporter-email-scope.test.ts`, `project-scope.test.ts`, `security-findings.test.ts`.
- Local run (Node 24, 16 Nov 2026), those six files: 6 of 6 files passed, 98 of 98 tests.
- Browser tests: `e2e/access-control.spec.ts` (new). The seed adds an organisation none of the test accounts belong to, with a public and a private project. The spec opens them signed out, as a regular user, as a site admin of another organisation, and as the site super admin. A private project, its issues, its ideas and its organisation area must look exactly like a project that doesn't exist, and its issue's title must never reach the page. Each check attaches a full-page screenshot to the Playwright report (`pnpm e2e`, then `pnpm exec playwright show-report`). CI runs it on every pull request.
