import { agentsMutedClass } from "@/app/(app)/settings/agents/agents-ui";

/** One edit page's heading, what it is for, and its content. */
export function EditSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="edit-section-heading">
      <h1 id="edit-section-heading" className="text-xl font-extrabold text-zk-text">
        {title}
      </h1>
      <p className={`mt-1 ${agentsMutedClass}`}>{description}</p>
      <div className="mt-6 border-t border-zk-divider pt-6">{children}</div>
    </section>
  );
}
