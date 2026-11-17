"use client";

import { useActionState, useState } from "react";
import { updateProjectAction } from "@/app/(app)/projects/actions";
import type { ProjectActionResult } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectRewardRulesSection } from "@/components/project-reward-rules-section";
import type { ProjectRewardConfig } from "@/lib/points/project-rewards";
import { copyText } from "@/lib/clipboard";

type Project = {
  slug: string;
  name: string;
  goal: string | null;
  repoUrl: string | null;
  stagingUrl: string | null;
  siteUrl: string | null;
  visibility?: "public" | "private";
  isOpenForContributors?: boolean;
  acceptsGuestIdeas?: boolean;
  contributorGuidelines?: string | null;
  rewardConfig?: unknown;
  organisation?: { slug: string };
};

export function ProjectSettingsForm({
  project,
  defaults = null,
}: {
  project: Project;
  defaults?: ProjectRewardConfig | null;
}) {
  const [result, action, pending] = useActionState<ProjectActionResult | undefined, FormData>(updateProjectAction, undefined);
  const [visibility, setVisibility] = useState<"public" | "private">(project.visibility === "public" ? "public" : "private");
  const [isOpenForContributors, setIsOpenForContributors] = useState(Boolean(project.isOpenForContributors));
  const [acceptsGuestIdeas, setAcceptsGuestIdeas] = useState(Boolean(project.acceptsGuestIdeas));
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://ziki.dev";
  const orgSlug = project.organisation?.slug ?? "ziki";
  const portalUrl = `${origin}/${orgSlug}/${project.slug}/contribute`;
  const htmlSnippet = `<a href="${portalUrl}">Share feedback</a>`;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={project.slug} />
      {result?.error ? <p role="alert" className="rounded-[14px] bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">{result.error}</p> : null}
      <label htmlFor="project-name" className="block space-y-1 text-sm font-medium text-zk-text">Project name
        <Input id="project-name" name="name" defaultValue={project.name} minLength={2} maxLength={60} required />
        {result?.field === "name" ? <span className="text-xs text-zk-bad-fg">{result.fieldErrors?.name ?? result.error}</span> : null}
      </label>
      <label htmlFor="project-goal" className="block space-y-1 text-sm font-medium text-zk-text">Project Brief &amp; Context for Agents
        <Textarea id="project-goal" name="goal" defaultValue={project.goal ?? ""} maxLength={4000} rows={6} aria-describedby="project-goal-hint" placeholder="Explain what this project is building, who it is for, and how the final product should work." />
        <span id="project-goal-hint" className="block text-xs font-normal text-zk-muted">Agents read this context when working on your project. Markdown is supported. Maximum 4,000 characters.</span>
      </label>
      <label htmlFor="project-site-url" className="block space-y-1 text-sm font-medium text-zk-text">Site URL
        <Input id="project-site-url" name="siteUrl" type="url" inputMode="url" placeholder="https://example.com" defaultValue={project.siteUrl ?? ""} />
        {result?.field === "siteUrl" ? <span className="text-xs text-zk-bad-fg">{result.fieldErrors?.siteUrl ?? result.error}</span> : null}
      </label>
      <details className="rounded-xl border border-zk-border bg-zk-subtle/30 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zk-text">Developer Links &amp; Staging (Advanced)</summary>
        <div className="mt-4 space-y-4">
          <label htmlFor="project-repo-url" className="block space-y-1 text-sm font-medium text-zk-text">GitHub repository URL
            <Input id="project-repo-url" name="repoUrl" type="url" inputMode="url" placeholder="https://github.com/owner/repository" defaultValue={project.repoUrl ?? ""} />
            {result?.field === "repoUrl" ? <span className="text-xs text-zk-bad-fg">{result.fieldErrors?.repoUrl ?? result.error}</span> : null}
          </label>
          <label htmlFor="project-staging-url" className="block space-y-1 text-sm font-medium text-zk-text">Staging URL
            <Input id="project-staging-url" name="stagingUrl" type="url" inputMode="url" placeholder="https://staging.example.com" defaultValue={project.stagingUrl ?? ""} />
            {result?.field === "stagingUrl" ? <span className="text-xs text-zk-bad-fg">{result.fieldErrors?.stagingUrl ?? result.error}</span> : null}
          </label>
        </div>
      </details>

      <div className="space-y-3 rounded-xl border border-zk-border bg-zk-card p-4">
        <h4 className="text-sm font-semibold text-zk-text">Visibility and Collaboration</h4>
        
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-zk-text cursor-pointer">
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => {
                setVisibility("private");
                setIsOpenForContributors(false);
                setAcceptsGuestIdeas(false);
              }}
              className="text-zk-accent focus:ring-zk-accent"
            />
            <span>Private</span>
          </label>
          <p className="text-xs text-zk-muted pl-6">
            Only members of this organisation can view, open, and contribute to this project.
          </p>

          <label className="flex items-center gap-2 text-sm font-medium text-zk-text cursor-pointer">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              className="text-zk-accent focus:ring-zk-accent"
            />
            <span>Public</span>
          </label>
          <p className="text-xs text-zk-muted pl-6">
            Listed on /discover with an allowlisted public profile. Signed-in non-members can read the project but cannot contribute unless accepted.
          </p>
        </div>

        {visibility === "public" ? (
          <div className="pt-2 border-t border-zk-border space-y-3">
            <div>
              <label htmlFor="project-guest-ideas" className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zk-text">
                <input
                  id="project-guest-ideas"
                  type="checkbox"
                  name="acceptsGuestIdeas"
                  value="true"
                  checked={acceptsGuestIdeas}
                  onChange={(event) => setAcceptsGuestIdeas(event.target.checked)}
                  className="rounded border-zk-border text-zk-accent focus:ring-zk-accent"
                />
                <span>Accept public issue reports</span>
              </label>
              <p className="mt-1 pl-6 text-xs text-zk-muted">
                Signed-out visitors may send an idea to the private triage queue and track it with an unlisted link. It is not published on the project overview. Guests cannot vote, bid, claim, review, or upload files.
              </p>
              {acceptsGuestIdeas ? (
                <div className="mt-3 ml-6 space-y-3 rounded-xl border border-zk-border bg-zk-chip/30 p-3.5">
                  <div className="space-y-1.5">
                    <label htmlFor="contributor-portal-link" className="block text-xs font-semibold text-zk-text">
                      Contributor portal link
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="contributor-portal-link"
                        readOnly
                        value={portalUrl}
                        className="bg-zk-surface font-mono text-xs text-zk-text"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          setCopiedLink(await copyText(portalUrl));
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="shrink-0 text-xs"
                      >
                        {copiedLink ? "Copied" : "Copy link"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="contributor-html-snippet" className="block text-xs font-semibold text-zk-text">
                      HTML link snippet
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="contributor-html-snippet"
                        readOnly
                        value={htmlSnippet}
                        className="bg-zk-surface font-mono text-xs text-zk-text"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          setCopiedSnippet(await copyText(htmlSnippet));
                          setTimeout(() => setCopiedSnippet(false), 2000);
                        }}
                        className="shrink-0 text-xs"
                      >
                        {copiedSnippet ? "Copied" : "Copy snippet"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-zk-muted">
                      Share this link in your README, website or support messages.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="project-open-collaboration" className="flex items-center gap-2 text-sm font-medium text-zk-text cursor-pointer">
                <input
                  id="project-open-collaboration"
                  type="checkbox"
                  name="isOpenForContributors"
                  value="true"
                  checked={isOpenForContributors}
                  onChange={(e) => setIsOpenForContributors(e.target.checked)}
                  className="rounded border-zk-border text-zk-accent focus:ring-zk-accent"
                />
                <span>Open for collaboration</span>
              </label>
              <p className="mt-1 text-xs text-zk-muted pl-6">
                Allow external signed-in contributors to apply to join this project.
              </p>
            </div>

            {isOpenForContributors ? (
              <label htmlFor="project-guidelines" className="block space-y-1 text-sm font-medium text-zk-text">
                Contributor guidelines
                <Textarea
                  id="project-guidelines"
                  name="contributorGuidelines"
                  defaultValue={project.contributorGuidelines ?? ""}
                  placeholder="Explain guidelines or requirements for external contributors..."
                  maxLength={4000}
                  rows={4}
                  aria-describedby="project-guidelines-hint"
                />
                <span id="project-guidelines-hint" className="block text-xs font-normal text-zk-muted">
                  Optional guidelines shown to applicants when requesting to join. Maximum 4,000 characters.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      <ProjectRewardRulesSection
        initialConfig={project.rewardConfig as ProjectRewardConfig | null}
        defaults={defaults}
        disabled={pending}
      />

      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
      {result && !result.error ? <span role="status" className="ml-3 text-sm text-zk-ok-fg">Settings saved.</span> : null}
    </form>
  );
}
