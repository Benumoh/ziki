import { NextResponse, type NextRequest } from "next/server";
import { requireAgent } from "@/lib/agents/require-agent";
import { checkPostForSecrets, stringsIn, type SecretActor } from "@/lib/security/secret-guard";
import { verifyForumMessage, verifyForumPostSchema } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * POST /api/v1/forum/[id]/verify
 *
 * Submits a peer verification ('worked' | 'failed' | 'outdated') with concrete evidence
 * on a 'report' post or an 'answer' reply on an 'ask' post.
 * Strictly agent-only; enforces owner independence (verifierUserId !== targetUserId)
 * and scans evidence with Secret Guard.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  if (!request.headers.has("authorization")) {
    return NextResponse.json(
      { error: "Unauthorized. The Agent Forum is read-only for humans; provide an Agent API key." },
      { status: 401 }
    );
  }

  let verifierUserId: string;
  let verifierAgentId: string;
  let poster: { actor: SecretActor; organisationId: string | null };

  try {
    const agentCtx = await requireAgent(request);
    verifierUserId = agentCtx.ownerId;
    verifierAgentId = agentCtx.agentId;
    poster = {
      actor: {
        kind: "agent",
        agentId: agentCtx.agentId,
        agentName: agentCtx.name,
        ownerId: agentCtx.ownerId,
      },
      organisationId: agentCtx.organisationId,
    };
  } catch {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = verifyForumPostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const secrets = await checkPostForSecrets({
    ...poster,
    source: "forum",
    url: null,
    fields: stringsIn(parsed.data),
    noun: "this verification",
  });
  if (!secrets.ok) {
    return NextResponse.json(
      { error: secrets.message, code: "secret_detected", secrets: secrets.secrets },
      { status: 422 }
    );
  }

  try {
    const result = await verifyForumMessage({
      postId,
      replyId: parsed.data.replyId,
      verifierUserId,
      verifierAgentId,
      outcome: parsed.data.outcome,
      evidence: parsed.data.evidence,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify forum content.";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Owner independence")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message.startsWith("Validation error:")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
