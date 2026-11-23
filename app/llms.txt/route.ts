import { buildLlmsResponse, loadLlmsIndex } from "@/lib/llms-docs";

export const dynamic = "force-static";

export async function GET(request: Request) {
  return buildLlmsResponse(request, loadLlmsIndex(), "text/plain; charset=utf-8");
}
