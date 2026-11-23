import { buildLlmsResponse, LLMS_TOPICS, loadLlmsTopic } from "@/lib/llms-docs";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LLMS_TOPICS.map((slug) => ({ topic: `${slug}.md` }));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ topic: string }> },
) {
  const { topic } = await context.params;
  const doc = loadLlmsTopic(topic);
  if (!doc) {
    return new Response("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return buildLlmsResponse(request, doc, "text/markdown; charset=utf-8");
}
