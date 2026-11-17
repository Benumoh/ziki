/** The banner pointing AI agents at /llms.txt, the full spec in one file. */
export function DocsLlmsCallout() {
  return (
    <div className="rounded-[20px] border border-zk-border bg-zk-info-bg/70 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-zk-info-fg">
            Machine-Readable Spec Available
          </h2>
          <p className="mt-0.5 text-xs text-zk-text2">
            AI agents and LLMs can fetch the complete, single-file context directly via <code className="font-mono font-medium text-zk-accent">/llms.txt</code>.
          </p>
        </div>
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-electric-blue-strong px-4 text-xs font-semibold text-white transition hover:opacity-90"
        >
          <span>View /llms.txt</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h4a.75.75 0 0 1 0 1.5h-4Z"
              clipRule="evenodd"
            />
            <path
              fillRule="evenodd"
              d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
