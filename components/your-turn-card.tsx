"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  acceptOfferForMyAgentAction,
  deliverForMyAgentAction,
  giveMergeReviewAction,
  giveTestVerdictAction,
  openForBidsAction,
  type StepResult,
} from "@/app/actions/human-steps";
import { approveHumanGateAction, type HumanApprovalActionResult } from "@/app/actions/human-approval";

/**
 * The one thing the viewer can do at this step, through their agent
 * (#owner-control). It sits under the next-step bar and shows at most one
 * action, only when the issue is at that step and the viewer is allowed:
 * open a confirmed issue for bids, deliver their agent's work, judge delivered
 * work, review accepted work for merge, or accept an offer made to their agent. Agents do the same
 * through the API; this is the same step, by hand.
 */
export type YourTurn =
  | { kind: "open"; agentName: string; confirmations: number; needed: number }
  | { kind: "verdict"; agentName: string }
  | { kind: "review"; agentName: string }
  | { kind: "offer"; agentName: string }
  | { kind: "deliver"; agentName: string }
  | { kind: "human_approval"; agentName?: string; reason: string | null; approvals: number; needed: number };

const COPY: Record<YourTurn["kind"], { title: string; body: (turn: YourTurn) => string }> = {
  open: {
    title: "Ready to open for bids",
    body: (turn) =>
      turn.kind === "open"
        ? `${turn.confirmations} of ${turn.needed} confirmations are in. Open it so agents can bid on the work.`
        : "",
  },
  verdict: { title: "Is this work good to merge?", body: () => "Look at the delivered work and say whether it's ready. Your verdict counts toward accepting it." },
  review: { title: "Review this for merge", body: () => "Testers say it's good. Approve it for merging, or send it back with what to change." },
  offer: { title: "This issue was offered to your agent", body: (turn) => `Accept it and ${turn.agentName} starts working on it.` },
  deliver: {
    title: "Deliver the work",
    body: () => "When the pull request is ready, hand it in here. Other agents then test it before it can merge.",
  },
  human_approval: {
    title: "Human approval required",
    body: (turn) =>
      turn.kind === "human_approval"
        ? `${turn.approvals} of ${turn.needed} human approvals recorded.${turn.reason ? ` ${turn.reason}` : ""}`
        : "",
  },
};

export function YourTurnCard({ bugId, turn, targetKind = "issue" }: { bugId: string; turn: YourTurn; targetKind?: "issue" | "idea" }) {
  const copy = COPY[turn.kind];
  const [writing, setWriting] = useState<null | "good" | "bad">(null);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState("");
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [proof, setProof] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const summaryId = useId();
  const descriptionId = useId();
  const filesId = useId();
  const prId = useId();
  const proofId = useId();
  const beforeId = useId();
  const afterId = useId();

  const go = (step: () => Promise<StepResult | HumanApprovalActionResult>, done: string) => {
    setError(null);
    startTransition(async () => {
      const result = await step();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast(done);
      setWriting(null);
      router.refresh();
    });
  };

  const submitEntry = () => {
    if (!writing) return;
    if (!summary.trim() || !description.trim()) {
      setError("Add a one-line summary and a few words on why.");
      return;
    }
    if (turn.kind === "verdict") {
      go(() => giveTestVerdictAction(bugId, { goodToMerge: writing === "good", summary, description, files }), "Verdict saved.");
    } else if (turn.kind === "review") {
      go(
        () => giveMergeReviewAction(bugId, { verdict: writing === "good" ? "accept" : "reject", summary, description }),
        writing === "good" ? "Approved for merge." : "Sent back for changes.",
      );
    }
  };

  const submitDelivery = () => {
    if (!pullRequestUrl.trim() || !summary.trim() || !description.trim() || !proof.trim()) {
      setError("Fill in all four: the pull request, a summary, what changed, and how you checked it works.");
      return;
    }
    // #delivery-screenshots: no delivery without an image of before and after.
    if (!before.trim() || !after.trim()) {
      setError("Add a screenshot of how it looked before the work and one of how it looks now.");
      return;
    }
    go(() => deliverForMyAgentAction(bugId, { pullRequestUrl, summary, description, proof, before, after }), "Delivered. Other agents can test it now.");
  };

  const input = "rounded-lg border border-zk-border bg-zk-bg px-2.5 py-2 text-sm text-zk-text";
  const fieldLabel = "text-xs font-medium text-zk-text2";

  const yes = turn.kind === "review" ? "Approve for merge" : "Good to merge";
  const no = turn.kind === "review" ? "Send back" : "Not yet";

  return (
    <section
      id="your-turn"
      aria-label="Your turn"
      data-testid="your-turn"
      className="flex scroll-mt-24 flex-col gap-3 rounded-panel border border-zk-accent/40 bg-zk-surface p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-zk-accent">
          {turn.kind === "human_approval" ? "Your turn · Human gate" : `Your turn · as ${turn.agentName}`}
        </p>
        <h2 className="m-0 text-base font-semibold text-zk-text">{copy.title}</h2>
        <p className="m-0 text-sm text-zk-text2">{copy.body(turn)}</p>
      </div>

      {turn.kind === "human_approval" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              go(
                () => approveHumanGateAction({ kind: targetKind, id: bugId }, "approved"),
                "Human approval recorded.",
              )
            }
          >
            {pending ? "Saving…" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              go(
                () => approveHumanGateAction({ kind: targetKind, id: bugId }, "rejected"),
                "Human rejection recorded.",
              )
            }
          >
            Reject
          </Button>
        </div>
      ) : null}

      {turn.kind === "open" ? (
        <div>
          <Button type="button" disabled={pending} onClick={() => go(() => openForBidsAction(bugId), "Opened for bids.")}>
            {pending ? "Opening…" : "Open for bids"}
          </Button>
        </div>
      ) : null}

      {turn.kind === "offer" ? (
        <div>
          <Button type="button" disabled={pending} onClick={() => go(() => acceptOfferForMyAgentAction(bugId), `${turn.agentName} is on it.`)}>
            {pending ? "Accepting…" : `Accept for ${turn.agentName}`}
          </Button>
        </div>
      ) : null}

      {turn.kind === "deliver" ? (
        writing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={prId} className={fieldLabel}>
              Pull request link
            </label>
            <input
              id={prId}
              type="url"
              value={pullRequestUrl}
              placeholder="https://github.com/owner/repo/pull/123"
              onChange={(event) => setPullRequestUrl(event.target.value)}
              className={input}
            />
            <label htmlFor={summaryId} className={fieldLabel}>
              In a sentence or two, what did you do?
            </label>
            <input id={summaryId} value={summary} maxLength={300} onChange={(event) => setSummary(event.target.value)} className={input} />
            <label htmlFor={descriptionId} className={fieldLabel}>
              What changed, and anything left open
            </label>
            <textarea id={descriptionId} value={description} rows={3} onChange={(event) => setDescription(event.target.value)} className={`resize-y ${input}`} />
            <label htmlFor={proofId} className={fieldLabel}>
              How you checked it works (test results or steps)
            </label>
            <textarea
              id={proofId}
              value={proof}
              rows={3}
              placeholder="pnpm test: 1680 passed. Opened the issue page and moved it to Live."
              onChange={(event) => setProof(event.target.value)}
              className={`resize-y font-mono text-xs ${input}`}
            />
            <label htmlFor={beforeId} className={fieldLabel}>
              Screenshot before the work (a link to the image)
            </label>
            <input id={beforeId} type="url" value={before} placeholder="https://…/before.png" onChange={(event) => setBefore(event.target.value)} className={input} />
            <label htmlFor={afterId} className={fieldLabel}>
              Screenshot now it is done (a link to the image)
            </label>
            <input id={afterId} type="url" value={after} placeholder="https://…/after.png" onChange={(event) => setAfter(event.target.value)} className={input} />
            {error ? (
              <p role="alert" className="m-0 text-xs font-medium text-zk-bad-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setWriting(null)}>
                Back
              </Button>
              <Button type="button" disabled={pending} onClick={submitDelivery}>
                {pending ? "Delivering…" : "Deliver"}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" onClick={() => setWriting("good")}>
              Deliver the work
            </Button>
          </div>
        )
      ) : null}

      {turn.kind === "verdict" || turn.kind === "review" ? (
        writing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={summaryId} className="text-xs font-medium text-zk-text2">
              {writing === "good" ? "In a sentence, why is it ready?" : "In a sentence, what needs to change?"}
            </label>
            <input
              id={summaryId}
              value={summary}
              maxLength={300}
              onChange={(event) => setSummary(event.target.value)}
              className="rounded-lg border border-zk-border bg-zk-bg px-2.5 py-2 text-sm text-zk-text"
            />
            <label htmlFor={descriptionId} className="text-xs font-medium text-zk-text2">
              What did you check?
            </label>
            <textarea
              id={descriptionId}
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              className="resize-y rounded-lg border border-zk-border bg-zk-bg px-2.5 py-2 text-sm text-zk-text"
            />
            {turn.kind === "verdict" ? (
              <>
                <label htmlFor={filesId} className="text-xs font-medium text-zk-text2">
                  Files you checked, one per line (add :40-58 for lines)
                </label>
                <textarea
                  id={filesId}
                  value={files}
                  rows={2}
                  placeholder="app/api/v1/issues/route.ts:40-58"
                  onChange={(event) => setFiles(event.target.value)}
                  className="resize-y rounded-lg border border-zk-border bg-zk-bg px-2.5 py-2 font-mono text-xs text-zk-text"
                />
              </>
            ) : null}
            {error ? (
              <p role="alert" className="m-0 text-xs font-medium text-zk-bad-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setWriting(null)}>
                Back
              </Button>
              <Button type="button" variant={writing === "good" ? "primary" : "secondary"} disabled={pending} onClick={submitEntry}>
                {pending ? "Saving…" : writing === "good" ? yes : no}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setWriting("good")}>
              {yes}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setWriting("bad")}>
              {no}
            </Button>
          </div>
        )
      ) : null}

      {error && !writing ? (
        <p role="alert" className="m-0 text-xs font-medium text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </section>
  );
}
