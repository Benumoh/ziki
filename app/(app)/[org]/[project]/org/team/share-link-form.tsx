"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/components/ui/toast";
import { createShareLinkAction, type CreateShareLinkActionResult } from "@/app/(app)/organisations/actions";

/**
 * Creates a shareable invite link. The limits are the ones an owner can set:
 * how long it lasts, and whether one person, a set number, or anyone can use it.
 */
export function ShareLinkForm({ organisationId }: { organisationId: string }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [result, action, pending] = useActionState<CreateShareLinkActionResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await createShareLinkAction(previous, formData);
      if (next.ok) {
        setCreatedUrl(next.url);
        setLabel("");
      }
      return next;
    },
    undefined,
  );

  useEffect(() => {
    if (createdUrl) document.getElementById("new-share-link")?.focus();
  }, [createdUrl]);

  async function copy() {
    if (!createdUrl) return;
    toast((await copyText(createdUrl)) ? "Invite link copied." : "Couldn't copy. Select the link and copy it.");
  }

  const formError = result && !result.ok ? result.error : null;

  return (
    <div className="mt-4 space-y-4">
      {createdUrl ? (
        <div role="status" className="space-y-3 rounded-xl border border-zk-border bg-zk-tint p-4">
          <p className="text-sm font-medium text-zk-text">
            Invite link ready. Send it to anyone who should join — you can also copy it from the list below.
          </p>
          <label htmlFor="new-share-link" className="sr-only">
            Invite link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-share-link"
              readOnly
              value={createdUrl}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" onClick={copy} className="shrink-0 whitespace-nowrap">
              Copy link
            </Button>
          </div>
        </div>
      ) : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="organisationId" value={organisationId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="share-expires" className="block text-sm font-medium text-zk-text">
              Stops working after
            </label>
            <Select id="share-expires" name="expiresDays" defaultValue="7" disabled={pending}>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="share-uses" className="block text-sm font-medium text-zk-text">
              How many people
            </label>
            <Select id="share-uses" name="maxUses" defaultValue="unlimited" disabled={pending}>
              <option value="1">One person, then it stops</option>
              <option value="10">10 people</option>
              <option value="25">25 people</option>
              <option value="unlimited">Anyone until it expires</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="share-label" className="block text-sm font-medium text-zk-text">
            Note <span className="font-normal text-zk-muted">(optional)</span>
          </label>
          <Input
            id="share-label"
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Design team, offsite, …"
            maxLength={60}
            autoComplete="off"
            disabled={pending}
          />
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-zk-bad-fg">
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </form>
    </div>
  );
}
