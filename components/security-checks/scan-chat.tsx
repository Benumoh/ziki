"use client";

import { useState } from "react";
import { SiteChatBox } from "@/components/security-checks/site-chat-box";

/**
 * The site's chat at the bottom of both scan pages (18 Nov call, Mark: the chat in the top-to-bottom reading flow,
 * not up at the top right). One line until it's opened, so the page stays short; opened, the chat shows right here
 * under the results, with everything said about this site on the Security page already in it (one saved chat per
 * site per person), so the findings stay in view while people ask about them.
 */
export function ScanChat({ checkId, site }: { checkId: string; site: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={`Chat about ${site}`} className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="scan-chat"
        onClick={() => setOpen((now) => !now)}
        className="rounded-md text-sm font-semibold text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent"
      >
        {open ? "Hide the chat" : <>Continue your chat about {site} &rarr;</>}
      </button>
      {open ? (
        <div id="scan-chat" className="mt-4">
          <SiteChatBox checkId={checkId} site={site} />
        </div>
      ) : null}
    </section>
  );
}
