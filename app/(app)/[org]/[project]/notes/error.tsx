"use client";
export default function NotesError({ reset }: { reset: () => void }) {
  return <div role="alert" className="mx-auto w-full max-w-6xl rounded-panel border border-zk-border bg-zk-surface p-7"><h2 className="font-bold text-zk-text">Project notes could not be loaded</h2><p className="mt-2 text-sm text-zk-text2">Try again. If you followed an old pagination link, reopen Notes from the issues page.</p><button type="button" onClick={reset} className="mt-4 rounded-lg border border-zk-border px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">Try again</button></div>;
}
