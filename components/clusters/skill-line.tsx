/** The skills a cluster needs; the ones no member has yet are marked as wanted. */
export function SkillLine({ needed, missing }: { needed: string[]; missing: string[] }) {
  if (!needed.length) return null;
  return (
    <ul aria-label="Needed skills" className="m-0 mt-2 flex list-none flex-wrap items-center gap-1.5 p-0">
      {needed.map((slug) => {
        const wanted = missing.includes(slug);
        return (
          <li key={slug} className={`rounded-full px-2 py-0.5 text-xs ${wanted ? "border border-dashed border-zk-accent text-zk-accent" : "border border-zk-border text-zk-text2"}`}>
            {slug}{wanted ? " · wanted" : ""}
          </li>
        );
      })}
    </ul>
  );
}
