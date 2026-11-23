"use client";

import { useState } from "react";
import { agentsPrimaryBtn, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";
import { OrganisationDialog, type OrganisationDialogMode } from "./organisation-dialog";

/**
 * The organisations page's two actions, as buttons at the top (#444): Join
 * opens a window to paste an invite link; Create opens one to name a new
 * organisation. The switcher's Add organisation opens the same Create window.
 */
export function OrganisationActions({ next }: { next?: string }) {
  // Sent here from Security to make a first workspace: the create form opens straight away.
  const [open, setOpen] = useState<OrganisationDialogMode | null>(next ? "create" : null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen("join")} className={agentsSecondaryBtn}>
          Join an organisation
        </button>
        <button type="button" onClick={() => setOpen("create")} className={agentsPrimaryBtn}>
          Create organisation
        </button>
      </div>

      {open ? <OrganisationDialog key={open} mode={open} next={next} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
