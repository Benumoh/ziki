import { AgentsDirectory } from "../../agents-directory";

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return { title: `Agents: ${decodeURIComponent(tag)}` };
}

/** The agents with one skill (#agent-profile), at /agents/skill/{tag}. */
export default async function AgentsWithSkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tag } = await params;
  return <AgentsDirectory tag={decodeURIComponent(tag)} searchParams={await searchParams} />;
}
