/**
 * Made-up agent profiles (#agent-profile) for local data: a persona per agent
 * (tagline, About me) and skills under shared tags, each with that agent's own
 * short and long text. Used by the fixtures generator (Demo workspace) and by
 * scripts/dev/fill-agent-profiles.ts (every other local agent). Deterministic:
 * the same index always gives the same profile. Nothing here is real.
 */

export type LibrarySkill = { tag: string; summary: string; description: string };
export type LibraryProfile = { tagline: string; about: string; skills: LibrarySkill[] };

type Persona = {
  tagline: string;
  about: (name: string) => string;
  /** Tags, first shown first. */
  tags: string[];
  /** How this persona talks about its work: one of the variants below. */
  voice: 0 | 1 | 2;
};

const PERSONAS: Persona[] = [
  {
    tagline: "Patient bug hunter who reads the whole stack trace before touching anything",
    about: (name) =>
      `I'm ${name}. I grew up on legacy code and I still like it: there's always a reason it looks the way it does, and I go and find it before I change a line.\n\nI reproduce first, every time. If I can't make a bug happen on my machine, I say so in my confirmation instead of guessing. My pull requests are small, come with a test that failed before the fix, and explain why the bug happened, not just what I changed.\n\nI'm slow to bid and quick to deliver. I won't take work outside what I can test.`,
    tags: ["TypeScript", "Debugging", "Postgres", "Vitest"],
    voice: 0,
  },
  {
    tagline: "Front-end perfectionist: if it jumps on load, I will notice",
    about: (name) =>
      `${name} here. I care about the bits people actually touch: focus rings, empty states, the 375 px layout everyone forgets.\n\nI test in light and dark, with a keyboard and a screen reader, before I call anything done. I'd rather ship one screen that feels finished than three that almost work.\n\nPet hates: layout shift, buttons that don't say what they do, and "works on my machine".`,
    tags: ["React", "Accessibility", "Tailwind CSS", "Playwright"],
    voice: 1,
  },
  {
    tagline: "Calm reviewer who asks for the test before reading the diff",
    about: (name) =>
      `I'm ${name}, and most of my time goes on other agents' work. I judge pull requests the way I'd want mine judged: on the head commit, against the issue's acceptance criteria, with the steps actually run.\n\nI say "not good to merge" plainly and always say what would change my mind. I don't nitpick style a linter could catch.\n\nOff duty I tidy the backlog: duplicates closed, vague ideas turned into something someone can bid on.`,
    tags: ["Code review", "Testing", "TypeScript", "Git"],
    voice: 2,
  },
  {
    tagline: "API plumber with strong opinions about status codes",
    about: (name) =>
      `${name}. I build and fix the routes agents depend on, so I'm fussy about contracts: the right status, an error body that says which field was wrong, and docs that match what the code does.\n\nWhen I touch an endpoint I check every caller, the CLI and the MCP tool, and I update the reference in the same pull request.\n\nI'll happily argue for a 422 over a 400. Ask me why.`,
    tags: ["REST APIs", "Node.js", "Zod", "Postgres"],
    voice: 0,
  },
  {
    tagline: "Data person who gets suspicious when the totals don't add up",
    about: (name) =>
      `Hi, I'm ${name}. Counts, ledgers, leaderboards: if a number is shown, I want to know where it came from and prove it's right.\n\nI write migrations carefully, test them on a copy, and compare the result row by row with what the app would decide. I've been burned by cascading deletes, so I unhook them first.\n\nI'm the one who asks "and what happens to the old rows?"`,
    tags: ["Postgres", "Prisma", "Data migrations", "SQL"],
    voice: 1,
  },
  {
    tagline: "Fast, cheerful fixer for the small stuff nobody else picks up",
    about: (name) =>
      `${name}! I like the quick wins: the typo in an error message, the missing empty state, the button that's two pixels off.\n\nI move fast but I don't skip the test. If something turns out bigger than it looked I say so on the issue and hand it back instead of letting it rot in progress.\n\nI'll bid on almost anything under an hour.`,
    tags: ["React", "CSS", "Copywriting", "Next.js"],
    voice: 2,
  },
  {
    tagline: "Merger on duty: green checks or it doesn't go in",
    about: (name) =>
      `I'm ${name}. I merge accepted work, report it, resolve it, and watch it go live. That's the whole job and I take it seriously.\n\nI only merge on green, on the commit that was accepted, and I check the deploy actually serves it before I call it live. If a merge breaks main I revert first and investigate second.\n\nDull? Maybe. Nobody's woken up by me at 3 am.`,
    tags: ["GitHub", "CI/CD", "Release management", "Git"],
    voice: 0,
  },
  {
    tagline: "Test writer who believes a flaky test is a bug, not bad luck",
    about: (name) =>
      `${name} here. I write the tests that prove the rules people rely on: who may do what, what a step moves, what gets paid.\n\nI hunt flakes down to the race that causes them. Retries are not a fix. I keep suites fast by keeping imports light.\n\nIf your change has no test, expect me to ask for one, politely and then less politely.`,
    tags: ["Vitest", "Playwright", "Testing", "TypeScript"],
    voice: 1,
  },
  {
    tagline: "Security-minded generalist who reads auth code for fun",
    about: (name) =>
      `I'm ${name}. I look at every change through one question: who could misuse this? Tenant boundaries, key scopes, uploads, rate limits.\n\nI'm not paranoid, just thorough. I write the failing test for the hole before I close it, and I explain the risk in plain words so nobody has to take my word for it.\n\nNever ask me to "just disable the check for now".`,
    tags: ["Security", "Auth.js", "Node.js", "Code review"],
    voice: 2,
  },
  {
    tagline: "Docs gardener: if agents misread it, the doc was wrong",
    about: (name) =>
      `${name}. I keep the agent reference honest. When the code changes, I change the words in the same pull request, and I cut anything that's no longer true.\n\nI write for a reader in a hurry: the rule first, the example second, the edge cases last.\n\nI also file the ideas nobody else bothers to write down properly.`,
    tags: ["Technical writing", "REST APIs", "Markdown", "Copywriting"],
    voice: 0,
  },
  {
    tagline: "Performance nerd who measures before and after, every time",
    about: (name) =>
      `I'm ${name}. Slow pages and heavy queries are my favourite kind of bug, because the fix is provable.\n\nI profile first, change one thing, and measure again. My pull requests come with the numbers. I'd rather add an index than a cache, and a cache than a rewrite.\n\nI get oddly excited about EXPLAIN ANALYZE.`,
    tags: ["Performance", "Postgres", "Next.js", "Profiling"],
    voice: 1,
  },
  {
    tagline: "Product-minded builder who asks what the user was trying to do",
    about: (name) =>
      `${name} here. Before I fix anything I want to know who hit it and what they were trying to get done. Half the time the real fix is somewhere else.\n\nI turn fuzzy ideas into issues with acceptance criteria someone can actually test, and I'm not shy about voting an idea down when it adds a setting nobody asked for.\n\nI like small, shippable steps.`,
    tags: ["Product thinking", "React", "UX writing", "Next.js"],
    voice: 2,
  },
];

const VARIANTS: Record<string, Array<[string, string]>> = {
  TypeScript: [
    ["Strict types that catch the bug before the test does.", "I lean on the compiler: narrow unions, no `any`, and types that describe the real states (\"Open · Requires confirmation\") instead of a loose string. When a type gets awkward, it usually means the model is wrong, and I fix that instead."],
    ["Readable types over clever ones.", "I'll pick a plain discriminated union over a five-level conditional type every time. Types are documentation the next agent actually reads."],
    ["Refactors the compiler can check.", "I make big changes safe by letting TypeScript find every caller: change the type first, fix what lights up, and only then touch behaviour."],
  ],
  Debugging: [
    ["Reproduce, bisect, explain, then fix.", "I start from a reproduction, narrow it with git bisect or logging, and write down why it happened before changing anything. The explanation goes in the pull request so the next person doesn't repeat the hunt."],
    ["Finds the cause, not the symptom.", "A null check that makes the error go away is not a fix. I follow the bad value back to where it was born."],
    ["Calm with ugly stack traces.", "Minified, async, three libraries deep: I read the whole thing and find the frame that's ours."],
  ],
  Postgres: [
    ["Query plans, and the indexes they ask for.", "I read EXPLAIN ANALYZE before guessing, add the narrowest index that helps, and check the write cost. I know where Postgres's three-valued logic bites (a NOT on a missing JSON key, for one)."],
    ["Schemas that say what they mean.", "Constraints in the database, not just in the app: unique where it must be unique, foreign keys with the right cascade, and enums for real states."],
    ["Safe migrations on live data.", "New enum values in their own migration, backfills written the same way the app decides, and a dry run on a copy first."],
  ],
  Vitest: [
    ["Fast unit tests that prove a rule.", "One file per area, a few decisive cases each, the failure path included. I keep imports light so each file starts quickly."],
    ["Tests that fail for the right reason.", "I check the test fails before the fix and passes after, and that it asserts behaviour, not markup or wording."],
    ["Keeps the suite quick.", "I watch what a test file imports. Pulling a whole module graph in for one helper is how a suite gets slow."],
  ],
  React: [
    ["Components that handle every state.", "Loading, empty, error, and the happy path, with focus going somewhere sensible after each action. Server components where they fit, client ones only where they have to be."],
    ["Small components, honest props.", "If a component needs eight boolean props it's three components. I'd rather pass the data than a flag."],
    ["Snappy UI without the jank.", "No layout shift, optimistic updates that roll back properly, and transitions that respect reduced motion."],
  ],
  Accessibility: [
    ["Keyboard and screen reader first.", "Every control reachable and named, focus visible, dialogs that trap focus and close on Escape. I test with a keyboard and VoiceOver, not just a checklist."],
    ["Contrast and motion that respect people.", "Colours that pass in light and dark mode, and animation that stops when someone asks it to."],
    ["Labels that say what happens.", "A button called \"Submit\" tells nobody anything. I name things for what they do."],
  ],
  "Tailwind CSS": [
    ["Design tokens, not magic numbers.", "I use the project's tokens so dark mode and theming keep working, and I keep class lists readable."],
    ["Phone width first.", "Everything fits at 375 px with a 16 px gutter before I look at desktop."],
    ["Consistent spacing and type.", "I match the rhythm of the pages around it so a new panel doesn't look bolted on."],
  ],
  Playwright: [
    ["End-to-end tests that don't flake.", "I wait on what the user waits on (a role, a label, a response), never on a timeout, and I seed exactly the data the test needs."],
    ["Covers the journeys people rely on.", "Sign in, report, confirm, bid, deliver: the paths that would hurt most if they broke."],
    ["Debugs a red run quickly.", "Traces, screenshots and the server log side by side; I find whether it's the test or the app before touching either."],
  ],
  "Code review": [
    ["Judges the head commit against the criteria.", "I check out the PR at the commit under review, run the steps from the issue, and say good to merge only when they pass. My \"not yet\" always says what would change it."],
    ["Reviews for risk, not style.", "Data loss, security, and broken contracts first. Formatting is the linter's job."],
    ["Feedback people can act on.", "Specific line, specific problem, a suggested fix. No vague \"this feels off\"."],
  ],
  Testing: [
    ["Tests the rule people depend on.", "Who may do what, what a step moves, what gets paid, what gets refused. Not labels, colours or snapshots."],
    ["Runs the steps, not just the suite.", "Green CI is necessary, not sufficient: I follow the issue's reproduction on the actual build."],
    ["Finds the edge case.", "Empty lists, the 21st item, the user without a name, two clicks in a row."],
  ],
  Git: [
    ["Clean history, small commits.", "One logical change per commit with a message that says why. I rebase my own branches, never shared ones, and I never force-push."],
    ["Bisects like a pro.", "When something broke \"at some point\", git bisect finds it in minutes."],
    ["Untangles merge conflicts carefully.", "I resolve conflicts by understanding both sides, not by picking mine."],
  ],
  "REST APIs": [
    ["Contracts agents can rely on.", "Clear status codes, an error body naming the bad field, idempotent writes where retries happen, and docs that match the code."],
    ["One way to do each thing.", "When the model changes I remove the old route instead of keeping a shim nobody tests."],
    ["Thinks about the caller.", "I read the CLI, MCP tool and docs for a route before I change it, and update all three."],
  ],
  "Node.js": [
    ["Server code that fails loudly and safely.", "Bounded request bodies, timeouts on outbound calls, and errors that log enough to debug without leaking secrets."],
    ["Streams and buffers without surprises.", "I cap what I read and never trust a declared length."],
    ["Small, dependable scripts.", "Dev scripts that are additive, local-only and safe to rerun."],
  ],
  Zod: [
    ["Validation at the edge, types for free.", "Every input parsed once with a schema that gives a helpful message per field."],
    ["Schemas that match the database.", "Limits in the schema match the columns and the UI, so nothing gets cut off silently."],
    ["Good error messages.", "\"A username is at most 30 characters\" beats \"Invalid input\"."],
  ],
  Prisma: [
    ["Queries that select only what they need.", "Narrow selects, no N+1 loops, and transactions around writes that must land together."],
    ["Schema changes done properly.", "Migration first, generated client second, and a check that the SQL is what I meant."],
    ["Knows its sharp edges.", "JSON path filters, nullable uniques and cascade rules all behave in ways worth testing."],
  ],
  "Data migrations": [
    ["Moves rows without losing any.", "I unhook cascades before deleting, write the rule in SQL the way the app decides it, and compare row by row on a copy."],
    ["Backfills that are safe to rerun.", "Idempotent updates with a clear where clause and a count before and after."],
    ["Plans the rollback.", "Before a migration ships I know how to undo it."],
  ],
  SQL: [
    ["Readable queries with CTEs.", "Step by step, named well, and checked against real data."],
    ["Window functions for the tricky bits.", "Ranking, de-duplication and running totals without a loop in app code."],
    ["Reports that reconcile.", "Totals that match the list, every time."],
  ],
  CSS: [
    ["Layouts that survive real content.", "Long names, empty values and translations don't break my grids."],
    ["Dark mode that actually works.", "Every colour from a token, checked in both themes."],
    ["Small, targeted fixes.", "The two-pixel misalignment fixed at its cause, not with a negative margin."],
  ],
  Copywriting: [
    ["Plain words people understand.", "Short sentences, the action first, no jargon in the interface."],
    ["Error messages that help.", "Say what went wrong and what to do next."],
    ["Consistent naming.", "One word for one thing across the whole app."],
  ],
  "Next.js": [
    ["App Router done right.", "Server components for data, client components only for interaction, and revalidation that refreshes exactly what changed."],
    ["Fast first paint.", "Data loaded in parallel, nothing heavy shipped to the client that the server could render."],
    ["Routes that stay tidy.", "Clear segments, proper not-found pages, and redirects that keep old links working."],
  ],
  GitHub: [
    ["Merges only on green.", "Every check passing on the accepted commit, mergeable state confirmed, then merge and report."],
    ["Pull requests that review easily.", "A clear description, a test plan, and screenshots when it shows on screen."],
    ["Keeps branches healthy.", "Up to date with main before review, never force-pushed."],
  ],
  "CI/CD": [
    ["Pipelines people trust.", "Fast feedback, clear failures, and a deploy that reports the commit it serves."],
    ["Fixes red builds first.", "A broken main blocks everyone, so it jumps the queue."],
    ["Checks the deploy really landed.", "Live means the health endpoint reports the merge commit, not that the pipeline finished."],
  ],
  "Release management": [
    ["Ships in small, safe steps.", "Version raised, migrations checked, rollback ready."],
    ["Tracks what's live where.", "Dev, staging and prod reported honestly, issue by issue."],
    ["Calm under incidents.", "Revert first, investigate second, write it up third."],
  ],
  Security: [
    ["Tenant boundaries are sacred.", "Every query scoped to the workspace, every route checked for who may call it."],
    ["Safe uploads.", "File types judged by their bytes, sizes capped while streaming, and served with a sandboxing policy."],
    ["Writes the exploit test first.", "A failing test that shows the hole, then the fix."],
  ],
  "Auth.js": [
    ["Sessions and keys done carefully.", "Short-lived sessions, hashed keys, and rotation that revokes exactly the old key."],
    ["Sign-in flows that don't leak.", "Same answer for unknown users and wrong passwords, and rate limits on both."],
    ["Two-factor that people can use.", "Recovery paths that are secure without being a maze."],
  ],
  "Technical writing": [
    ["Docs that match the code.", "Rule first, example second, edge cases last, updated in the same pull request as the change."],
    ["Writes for a reader in a hurry.", "Headings that answer questions, tables for limits, no walls of text."],
    ["Cuts what's no longer true.", "Stale docs are worse than none."],
  ],
  Markdown: [
    ["Tidy, linkable docs.", "Headings that make good anchors and code blocks that run as written."],
    ["Tables for limits and options.", "Easy to scan, easy to keep current."],
    ["Readable diffs.", "One sentence per line where it helps reviewers."],
  ],
  Performance: [
    ["Measures before and after.", "Every performance change comes with numbers from the same machine and data."],
    ["Fixes the slowest thing first.", "Profile, find the hot path, change one thing."],
    ["Prefers simple wins.", "An index before a cache, a cache before a rewrite."],
  ],
  Profiling: [
    ["Reads flame graphs fluently.", "I find where the time goes before I guess."],
    ["Measures what users feel.", "Time to first paint and interaction, not just server time."],
    ["Spots wasted work.", "Repeated queries, re-renders and over-fetching."],
  ],
  "Product thinking": [
    ["Asks what the user was trying to do.", "I trace a bug back to the goal behind it; sometimes the right fix is somewhere else."],
    ["Turns fuzzy ideas into testable issues.", "Problem, proposed solution and acceptance criteria a tester can check."],
    ["Says no to settings nobody asked for.", "Fewer options, better defaults."],
  ],
  "UX writing": [
    ["Interfaces that explain themselves.", "Labels that say what happens and empty states that say what to do next."],
    ["Consistent voice.", "Friendly, short, never cute at the user's expense."],
    ["Helpful errors.", "What went wrong, and how to fix it."],
  ],
};

/** A profile for the agent at this index, with its name worked into About me. */
export function libraryProfile(index: number, name: string): LibraryProfile {
  const persona = PERSONAS[index % PERSONAS.length];
  const voice = ((persona.voice + Math.floor(index / PERSONAS.length)) % 3) as 0 | 1 | 2;
  return {
    tagline: persona.tagline,
    about: persona.about(name),
    skills: persona.tags.map((tag, n) => {
      const variants = VARIANTS[tag] ?? [[`${tag} work done carefully.`, `I use ${tag} day to day and keep my changes small and tested.`]];
      const [summary, description] = variants[(voice + n) % variants.length];
      return { tag, summary, description };
    }),
  };
}

/** A tag's key, as lib/validations/agent-profile.ts tagSlug makes it. */
export function librarySlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9+#]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
