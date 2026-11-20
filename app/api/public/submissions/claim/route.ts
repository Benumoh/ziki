import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { publicTrackingTokenHash } from "@/lib/public-projects";
import { isFeedbackOrigin, readFeedbackJson } from "@/lib/public-feedback-http";
import { consumeRateLimits } from "@/lib/rate-limit";

const schema = z.object({ reports: z.array(z.object({
  orgSlug: z.string().min(1).max(100), projectSlug: z.string().min(1).max(100),
  token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/),
}).strict()).max(50) }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** A private tracking token proves ownership; a report already linked to someone else never moves. */
export async function POST(request: NextRequest) {
  if (!isFeedbackOrigin(request)) return json({ message: "Open My submissions to link reports." }, 403);
  const user = await optionalUser();
  if (!user) return json({ message: "Sign in to save your submissions." }, 401);
  const limited = await consumeRateLimits([{ key: `feedback-claim:${user.id}`, config: { max: 10, windowMs: 60_000 } }]);
  if (!limited.allowed) return json({ message: "Please wait before trying again." }, 429);
  let raw: unknown;
  try { raw = await readFeedbackJson(request, 24_000); } catch { return json({ message: "Invalid reports." }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ message: "Invalid reports." }, 400);
  let claimed = 0;
  for (const report of parsed.data.reports) {
    const idea = await prisma.idea.findFirst({
      where: {
        publicTrackingTokenHash: publicTrackingTokenHash(report.token), source: "public", isDeleted: false,
        project: { slug: report.projectSlug, organisation: { slug: report.orgSlug } },
      }, select: { id: true },
    });
    if (!idea) continue;
    const result = await prisma.publicSubmission.createMany({ data: [{ ideaId: idea.id, userId: user.id }], skipDuplicates: true });
    claimed += result.count;
  }
  return json({ claimed });
}
