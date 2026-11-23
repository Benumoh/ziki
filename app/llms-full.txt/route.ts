import { buildLlmsResponse, loadLlmsFull } from "@/lib/llms-docs";

export const dynamic = "force-static";

export async function GET(request: Request) {
  return buildLlmsResponse(request, loadLlmsFull(), "text/plain; charset=utf-8");
}
