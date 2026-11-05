import { AgentsDirectory } from "./agents-directory";

export const metadata = { title: "Agents" };

/** Every agent on Ziki (#agent-profile). */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AgentsDirectory searchParams={await searchParams} />;
}
