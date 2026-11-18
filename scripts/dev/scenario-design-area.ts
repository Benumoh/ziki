/**
 * Local scenario: redesign proposals for the Design area (#9, PR 1), so the
 * Design list and a proposal's page can be worked on and shown locally.
 *
 *   pnpm db:scenario:design-area
 *
 * In the Demo organisation's Demo project (`pnpm db:fixtures` first), five
 * proposals from one agent, "Mira's Design Agent", whose owner Mira is a plain
 * member, so demo@fixtures.local (the owner) may decide them:
 * - two waiting: one linked to an Open issue, one not linked to any issue;
 * - one approved (chosen on a second Open issue) and one superseded on that issue;
 * - one rejected.
 * Each has one to three small generated PNG mockups, stored as uploads are
 * (an Attachment uploaded by the proposal's beneficiary), and some have an
 * HTTPS preview address.
 *
 * Plus, in an organisation of its own ("Design Elsewhere"), one waiting
 * proposal that must never appear in Demo.
 *
 * People (all *@scenario.local, password ziki-demo-password, the fixtures' local one):
 * - theo@scenario.local: a plain Demo member, to see the area without decision buttons;
 * - outsider@scenario.local: owner of Design Elsewhere only, never a Demo member
 *   (a rerun takes back the Demo membership that `pnpm db:fixtures` gives every local account).
 *
 * Additive only: it never resets or reseeds. Its rows have fixed ids
 * (`scn-design-*`) and fixed emails (`*@scenario.local`), and a rerun deletes and
 * recreates just this scenario's proposals, mockups, agents and its own
 * organisation. It refuses to run against anything but a local database.
 * A later `pnpm db:fixtures` deletes the Demo rows; run this again after it.
 * The script prints the Design page and each proposal's address.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { deflateSync } from "node:zlib";

const DEMO_ORGANISATION_SLUG = "demo";
const DEMO_PROJECT_SLUG = "demo";
const DEMO_OWNER_EMAIL = "demo@fixtures.local";
const P = "scn-design";
const PASSWORD = "ziki-demo-password";
const BASE = "http://localhost:3001";

const OTHER_ORGANISATION = { id: `${P}-org-elsewhere`, slug: "scn-design-elsewhere", name: "Design Elsewhere" };
const OTHER_PROJECT = { id: `${P}-project-elsewhere`, slug: "web", name: "Web" };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

// ---------------------------------------------------------------------------
// A tiny PNG writer (RGB, 8 bits), enough for flat wireframe mockups.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [0, 2, 4].map((at) => Number.parseInt(value.slice(1 + at, 3 + at), 16)) as Rgb;

class Canvas {
  readonly pixels: Buffer;
  constructor(readonly width: number, readonly height: number, background: string) {
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  rect(x: number, y: number, w: number, h: number, color: string): this {
    const [r, g, b] = hex(color);
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row += 1) {
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col += 1) {
        const at = (row * this.width + col) * 3;
        this.pixels[at] = r;
        this.pixels[at + 1] = g;
        this.pixels[at + 2] = b;
      }
    }
    return this;
  }

  circle(cx: number, cy: number, radius: number, color: string): this {
    const [r, g, b] = hex(color);
    for (let row = cy - radius; row <= cy + radius; row += 1) {
      for (let col = cx - radius; col <= cx + radius; col += 1) {
        if (row < 0 || col < 0 || row >= this.height || col >= this.width) continue;
        if ((row - cy) ** 2 + (col - cx) ** 2 > radius ** 2) continue;
        const at = (row * this.width + col) * 3;
        this.pixels[at] = r;
        this.pixels[at + 1] = g;
        this.pixels[at + 2] = b;
      }
    }
    return this;
  }

  /** Grey bars standing in for a line of text. */
  text(x: number, y: number, widths: number[], color = "#c7cdd8"): this {
    let at = x;
    for (const w of widths) {
      this.rect(at, y, w, 8, color);
      at += w + 8;
    }
    return this;
  }

  png(): Buffer {
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let row = 0; row < this.height; row += 1) {
      raw[row * (stride + 1)] = 0;
      this.pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.writeUInt8(8, 8); // bit depth
    header.writeUInt8(2, 9); // RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/** The app frame every desktop mockup starts from: a top bar and a light page. */
function desktop(accent: string): Canvas {
  return new Canvas(640, 400, "#f5f7fb").rect(0, 0, 640, 44, "#ffffff").rect(0, 44, 640, 1, "#e3e7ef").rect(20, 16, 80, 12, accent).text(470, 18, [40, 40, 50]);
}

const MOCKUPS: Record<string, () => Buffer> = {
  "onboarding-checklist": () => {
    const c = desktop("#2563eb").rect(40, 72, 360, 300, "#ffffff").text(60, 92, [140, 60], "#334155").rect(60, 116, 320, 10, "#e3e7ef").rect(60, 116, 128, 10, "#2563eb");
    for (let i = 0; i < 4; i += 1) {
      const y = 148 + i * 52;
      c.rect(60, y, 320, 40, i === 1 ? "#eff6ff" : "#ffffff").rect(72, y + 12, 16, 16, i < 2 ? "#2563eb" : "#cbd5e1").text(100, y + 16, [120 - i * 10, 70]);
    }
    return c.rect(424, 72, 176, 140, "#ffffff").text(440, 92, [90], "#334155").text(440, 116, [120, 20]).text(440, 136, [100]).rect(440, 168, 96, 28, "#2563eb").png();
  },
  "onboarding-welcome": () =>
    desktop("#2563eb").rect(160, 80, 320, 260, "#ffffff").circle(320, 140, 30, "#dbeafe").text(220, 190, [110, 90], "#334155").text(210, 214, [80, 60, 80]).text(240, 232, [70, 90]).rect(250, 276, 140, 36, "#2563eb").png(),
  "inline-table": () => {
    const c = desktop("#0f766e").rect(30, 64, 580, 316, "#ffffff").rect(30, 64, 580, 36, "#f1f5f9").text(48, 78, [60, 120, 80, 60], "#64748b");
    for (let i = 0; i < 6; i += 1) {
      const y = 104 + i * 44;
      c.rect(30, y + 43, 580, 1, "#e2e8f0").text(48, y + 18, [40, 180 - i * 12, 60, 50]);
    }
    // The row being edited in place: a focused input and Save / Cancel.
    return c.rect(36, 192, 568, 40, "#ecfdf5").rect(104, 198, 260, 28, "#ffffff").rect(104, 198, 260, 2, "#0f766e").rect(484, 200, 52, 24, "#0f766e").rect(544, 200, 52, 24, "#e2e8f0").png();
  },
  "inline-hover": () => {
    const c = desktop("#0f766e").rect(30, 64, 580, 316, "#ffffff");
    for (let i = 0; i < 6; i += 1) {
      const y = 76 + i * 50;
      c.rect(30, y + 49, 580, 1, "#e2e8f0").text(48, y + 20, [40, 200 - i * 14, 60]);
      if (i === 2) c.rect(30, y, 580, 49, "#f0fdfa").rect(560, y + 14, 22, 22, "#99f6e4");
    }
    return c.png();
  },
  "inline-phone": () => {
    const c = new Canvas(360, 640, "#f5f7fb").rect(0, 0, 360, 56, "#ffffff").rect(16, 22, 70, 12, "#0f766e");
    for (let i = 0; i < 7; i += 1) {
      const y = 72 + i * 74;
      c.rect(16, y, 328, 62, i === 1 ? "#ecfdf5" : "#ffffff").text(32, y + 18, [160 - i * 8]).text(32, y + 38, [60, 40]);
    }
    return c.rect(32, 162, 220, 26, "#ffffff").rect(32, 186, 220, 2, "#0f766e").png();
  },
  "calm-dashboard": () => {
    const c = desktop("#64748b");
    const tiles = ["#e0e7ef", "#e7ece4", "#efe7e0", "#e4e2ee"];
    tiles.forEach((tile, i) => c.rect(30 + i * 148, 64, 136, 88, tile).text(44 + i * 148, 80, [70], "#64748b").rect(44 + i * 148, 108, 60, 22, "#94a3b8"));
    c.rect(30, 168, 384, 212, "#ffffff");
    for (let i = 0; i < 8; i += 1) c.rect(54 + i * 44, 340 - i * 18 - (i % 2) * 20, 26, 20 + i * 18 + (i % 2) * 20, "#cbd5e1");
    return c.rect(430, 168, 180, 212, "#ffffff").text(446, 188, [90], "#64748b").text(446, 214, [130]).text(446, 236, [110]).text(446, 258, [120]).png();
  },
  "fab-list": () => {
    const c = desktop("#db2777").rect(30, 64, 580, 316, "#ffffff");
    for (let i = 0; i < 6; i += 1) c.rect(30, 116 + i * 44, 580, 1, "#f1f5f9").text(48, 90 + i * 44, [200 - i * 16, 40]);
    return c.circle(568, 340, 28, "#db2777").rect(556, 338, 24, 4, "#ffffff").rect(566, 328, 4, 24, "#ffffff").png();
  },
  "sidebar-nav": () => {
    const c = desktop("#7c3aed").rect(0, 45, 168, 355, "#ffffff").rect(168, 45, 1, 355, "#e3e7ef");
    for (let i = 0; i < 6; i += 1) c.rect(12, 64 + i * 40, 144, 30, i === 0 ? "#ede9fe" : "#ffffff").text(28, 75 + i * 40, [70 + (i % 3) * 14]);
    return c.rect(192, 64, 420, 316, "#ffffff").text(212, 84, [160], "#334155").text(212, 112, [300]).text(212, 132, [260]).png();
  },
  "sidebar-collapsed": () => {
    const c = desktop("#7c3aed").rect(0, 45, 56, 355, "#ffffff").rect(56, 45, 1, 355, "#e3e7ef");
    for (let i = 0; i < 6; i += 1) c.rect(14, 64 + i * 40, 28, 28, i === 0 ? "#ede9fe" : "#f1f5f9");
    return c.rect(80, 64, 532, 316, "#ffffff").text(100, 84, [180], "#334155").text(100, 112, [380]).png();
  },
  "elsewhere-login": () =>
    new Canvas(640, 400, "#111827").rect(200, 70, 240, 260, "#1f2937").text(240, 100, [120], "#9ca3af").rect(230, 150, 180, 30, "#374151").rect(230, 196, 180, 30, "#374151").rect(230, 252, 180, 34, "#f59e0b").png(),
};

type ProposalSpec = {
  key: string;
  title: string;
  body: string;
  previewUrl: string | null;
  status: "proposed" | "approved" | "rejected" | "superseded";
  /** Which Open issue it is for, if any: the first or the second the scenario picks. */
  issue: 0 | 1 | null;
  mockups: string[];
  ago: number;
  decidedAgo?: number;
};

const PROPOSALS: ProposalSpec[] = [
  {
    key: "onboarding",
    title: "A first-week checklist instead of the welcome tour",
    body: `New teams skip the five-step tour and then can't find where to invite a colleague.

**Proposal:** replace the tour with a checklist that stays on the home page until it's done:

1. Create your first task
2. Invite a colleague
3. Set a due date
4. Finish a task

Progress shows as a bar at the top. Each item opens the screen it talks about. The checklist hides itself once all four are done, and "Dismiss" hides it early.`,
    previewUrl: "https://example.com/design/onboarding-checklist",
    status: "proposed",
    issue: null,
    mockups: ["onboarding-checklist", "onboarding-welcome"],
    ago: 2 * HOUR,
  },
  {
    key: "inline-edit",
    title: "Edit a task's title right in the list",
    body: `Today renaming a task opens its page, then the edit form, then saves back to the page.

**Proposal:** click a title in the list to edit it in place. Enter saves, Esc cancels, and the row shows Save and Cancel while it is being edited. On a phone, tapping the title opens the same inline field under it.

The hover state shows a pencil at the end of the row, so it's discoverable without a tour.`,
    previewUrl: "https://example.com/design/inline-edit",
    status: "proposed",
    issue: 0,
    mockups: ["inline-table", "inline-hover", "inline-phone"],
    ago: 5 * HOUR,
  },
  {
    key: "calm-dashboard",
    title: "Calmer dashboard colours",
    body: `The dashboard uses four saturated colours for the summary tiles, so nothing stands out when something is actually late.

**Proposal:** muted tiles by default; only an overdue count turns red.`,
    previewUrl: "https://example.com/design/calm-dashboard",
    status: "approved",
    issue: 1,
    mockups: ["calm-dashboard"],
    ago: 4 * DAY,
    decidedAgo: 3 * DAY,
  },
  {
    key: "sidebar",
    title: "Move the dashboard sections into a sidebar",
    body: `A left sidebar for the dashboard's sections, collapsible to icons, instead of the tabs across the top.`,
    previewUrl: null,
    status: "superseded",
    issue: 1,
    mockups: ["sidebar-nav", "sidebar-collapsed"],
    ago: 4 * DAY + 2 * HOUR,
    decidedAgo: 3 * DAY,
  },
  {
    key: "fab",
    title: "A floating New task button",
    body: `A round "+" button fixed at the bottom right of every list, so a task can be added from anywhere.`,
    previewUrl: null,
    status: "rejected",
    issue: null,
    mockups: ["fab-list"],
    ago: 6 * DAY,
    decidedAgo: 5 * DAY,
  },
];

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const organisation = await db.organisation.findUnique({ where: { slug: DEMO_ORGANISATION_SLUG }, select: { id: true, slug: true } });
    if (!organisation) throw new Error(`No "${DEMO_ORGANISATION_SLUG}" organisation in this database. Run pnpm db:fixtures first.`);
    const project = await db.project.findUnique({
      where: { organisationId_slug: { organisationId: organisation.id, slug: DEMO_PROJECT_SLUG } },
      select: { id: true, slug: true },
    });
    if (!project) throw new Error(`No "${DEMO_PROJECT_SLUG}" project in the Demo organisation.`);
    const owner = await db.user.findUnique({ where: { email: DEMO_OWNER_EMAIL }, select: { id: true } });
    if (!owner) throw new Error(`No ${DEMO_OWNER_EMAIL} account. Run pnpm db:fixtures first.`);

    const now = Date.now();
    const at = (ago: number) => new Date(now - ago);
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    // Start over: agents cascade to their proposals, proposals to their mockups,
    // and our own organisation to its project, memberships and proposal.
    await db.attachment.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.redesignProposal.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.agent.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.organisation.deleteMany({ where: { id: OTHER_ORGANISATION.id } });

    // People.
    const person = async (key: string, name: string, withPassword: boolean) =>
      db.user.upsert({
        where: { email: `${key}@scenario.local` },
        create: { id: `${P}-user-${key}`, email: `${key}@scenario.local`, name, emailVerified: new Date(now), emailNotifications: false, ...(withPassword ? { passwordHash } : {}) },
        update: { name, ...(withPassword ? { passwordHash } : {}) },
        select: { id: true },
      });
    const mira = await person("mira", "Mira Designer", false);
    const theo = await person("theo", "Theo Member", true);
    const outsider = await person("outsider", "Olu Outsider", true);

    // Mira and Theo are plain members of Demo; the outsider is never one.
    for (const user of [mira, theo]) {
      await db.membership.upsert({
        where: { organisationId_userId: { organisationId: organisation.id, userId: user.id } },
        create: { organisationId: organisation.id, userId: user.id, role: "member" },
        update: { role: "member" },
      });
    }
    await db.membership.deleteMany({ where: { organisationId: organisation.id, userId: outsider.id } });

    // Mira's agent proposes every Demo design, so the Demo owner may decide them.
    const agent = await db.agent.create({
      data: { id: `${P}-agent-mira`, ownerUserId: mira.id, name: "Mira's Design Agent", activations: { create: { organisationId: organisation.id, level: "working" } } },
      select: { id: true },
    });

    // Two Open issues to link designs to: the first takes a waiting design, the second the decided pair.
    const issues = await db.bug.findMany({
      where: { organisationId: organisation.id, projectId: project.id, status: "open", substatus: "open", isDeleted: false, track: "product" },
      orderBy: { number: "asc" },
      take: 2,
      select: { id: true, number: true, title: true },
    });
    if (issues.length < 2) throw new Error("The Demo project needs two Open issues. Run pnpm db:fixtures first.");

    const created: { id: string; title: string; status: string; issue: number | null }[] = [];
    for (const spec of PROPOSALS) {
      const id = `${P}-${spec.key}`;
      const issue = spec.issue === null ? null : issues[spec.issue];
      const decidedAt = spec.decidedAgo === undefined ? null : at(spec.decidedAgo);
      await db.redesignProposal.create({
        data: {
          id,
          organisationId: organisation.id,
          projectId: project.id,
          bugId: issue?.id ?? null,
          authorAgentId: agent.id,
          onBehalfOfUserId: mira.id,
          title: spec.title,
          body: spec.body,
          previewUrl: spec.previewUrl,
          status: spec.status,
          approverId: spec.status === "approved" ? owner.id : null,
          approvedAt: spec.status === "approved" ? decidedAt : null,
          createdAt: at(spec.ago),
          updatedAt: decidedAt ?? at(spec.ago),
        },
      });
      for (const [index, mockup] of spec.mockups.entries()) {
        const data = MOCKUPS[mockup]();
        await db.attachment.create({
          data: {
            id: `${id}-mockup-${index + 1}`,
            // Mockups are uploaded by the proposal's beneficiary (lib/redesigns.ts).
            uploaderId: mira.id,
            redesignProposalId: id,
            filename: `${mockup}.png`,
            contentType: "image/png",
            size: data.length,
            data: new Uint8Array(data),
            createdAt: at(spec.ago + MIN),
          },
        });
      }
      created.push({ id, title: spec.title, status: spec.status, issue: issue?.number ?? null });
    }

    // Another organisation, with a waiting proposal that Demo must never show.
    await db.organisation.create({
      data: {
        id: OTHER_ORGANISATION.id,
        slug: OTHER_ORGANISATION.slug,
        name: OTHER_ORGANISATION.name,
        memberships: { create: { userId: outsider.id, role: "owner" } },
        projects: { create: { id: OTHER_PROJECT.id, slug: OTHER_PROJECT.slug, name: OTHER_PROJECT.name, workflow: { create: {} } } },
      },
    });
    const otherAgent = await db.agent.create({
      data: { id: `${P}-agent-outsider`, ownerUserId: outsider.id, name: "Olu's Agent", activations: { create: { organisationId: OTHER_ORGANISATION.id, level: "working" } } },
      select: { id: true },
    });
    const otherId = `${P}-elsewhere-login`;
    await db.redesignProposal.create({
      data: {
        id: otherId,
        organisationId: OTHER_ORGANISATION.id,
        projectId: OTHER_PROJECT.id,
        authorAgentId: otherAgent.id,
        onBehalfOfUserId: outsider.id,
        title: "Dark sign-in page (another organisation)",
        body: "A dark sign-in page with the logo above the form. This proposal belongs to Design Elsewhere and must never show in Demo.",
        previewUrl: "https://example.com/design/dark-sign-in",
        status: "proposed",
        createdAt: at(30 * MIN),
      },
    });
    const otherMockup = MOCKUPS["elsewhere-login"]();
    await db.attachment.create({
      data: { id: `${otherId}-mockup-1`, uploaderId: outsider.id, redesignProposalId: otherId, filename: "elsewhere-login.png", contentType: "image/png", size: otherMockup.length, data: new Uint8Array(otherMockup) },
    });

    const design = `${BASE}/${organisation.slug}/${project.slug}/design`;
    console.log(`Scenario ready. Sign in as ${DEMO_OWNER_EMAIL} (decides), theo@scenario.local (plain member) or outsider@scenario.local (another organisation).`);
    console.log(`Design page: ${design}   (all of them: ${design}?view=all)`);
    for (const proposal of created) {
      console.log(`  ${proposal.status.padEnd(10)} ${design}/${proposal.id}   ${proposal.title}${proposal.issue ? `   (issue #${proposal.issue}: ${BASE}/${organisation.slug}/${project.slug}/${proposal.issue})` : ""}`);
    }
    console.log(`  old link   ${BASE}/redesigns/${created[0].id}`);
    console.log(`Another organisation: ${BASE}/${OTHER_ORGANISATION.slug}/${OTHER_PROJECT.slug}/design/${otherId}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
