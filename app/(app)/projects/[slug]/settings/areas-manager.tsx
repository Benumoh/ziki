"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  createProjectAreaAction,
  deleteProjectAreaAction,
  updateProjectAreaAction,
  type ProjectAreaActionResult,
} from "./areas-actions";

type ProjectArea = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  paths: string[];
};

function ActionFeedback({ result }: { result: ProjectAreaActionResult | undefined }) {
  if (!result) return null;
  return result.ok ? (
    <p className="text-xs text-zk-ok-fg" role="status">Saved.</p>
  ) : (
    <p className="text-xs text-zk-bad-fg" role="alert">{result.error}</p>
  );
}

function CreateAreaForm({ projectSlug }: { projectSlug: string }) {
  const [result, action, pending] = useActionState<ProjectAreaActionResult | undefined, FormData>(createProjectAreaAction, undefined);
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-2">
      <input type="hidden" name="slug" value={projectSlug} />
      <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor="new-area-name">
        Name
        <Input id="new-area-name" name="name" required minLength={2} maxLength={60} placeholder="Frontend" />
      </label>
      <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor="new-area-description">
        Description <span className="font-normal text-zk-muted">(optional)</span>
        <Input id="new-area-description" name="description" maxLength={1000} placeholder="Web application UI" />
      </label>
      <label className="space-y-1 text-sm font-medium text-zk-text sm:col-span-2" htmlFor="new-area-paths">
        Repository paths <span className="font-normal text-zk-muted">(optional)</span>
        <Textarea id="new-area-paths" name="paths" rows={2} maxLength={5000} placeholder={"apps/web/**\npackages/ui/**"} />
        <span className="block text-xs font-normal text-zk-muted">One project-relative glob per line.</span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add area"}</Button>
        <ActionFeedback result={result} />
      </div>
    </form>
  );
}

function AreaRow({ area, projectSlug }: { area: ProjectArea; projectSlug: string }) {
  const [result, action, pending] = useActionState<ProjectAreaActionResult | undefined, FormData>(updateProjectAreaAction, undefined);
  const [deleteResult, setDeleteResult] = useState<ProjectAreaActionResult | undefined>();
  const [deleting, startDelete] = useTransition();
  const confirm = useConfirm();

  async function removeArea() {
    const approved = await confirm({
      title: `Delete ${area.name}?`,
      body: "Issues stay in this project but lose this area. Agents will also lose this area preference.",
      confirmLabel: "Delete area",
      tone: "danger",
    });
    if (!approved) return;
    const data = new FormData();
    data.set("slug", projectSlug);
    data.set("areaId", area.id);
    startDelete(async () => setDeleteResult(await deleteProjectAreaAction(undefined, data)));
  }

  return (
    <li className="grid gap-3 border-t border-zk-border py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <form action={action} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <input type="hidden" name="slug" value={projectSlug} />
        <input type="hidden" name="areaId" value={area.id} />
        <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor={`area-name-${area.id}`}>
          Name
          <Input id={`area-name-${area.id}`} name="name" defaultValue={area.name} required minLength={2} maxLength={60} />
          <span className="block text-xs font-normal text-zk-muted">Slug: {area.slug}</span>
        </label>
        <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor={`area-description-${area.id}`}>
          Description
          <Input id={`area-description-${area.id}`} name="description" defaultValue={area.description ?? ""} maxLength={1000} />
        </label>
        <label className="space-y-1 text-sm font-medium text-zk-text sm:col-span-2" htmlFor={`area-paths-${area.id}`}>
          Repository paths
          <Textarea id={`area-paths-${area.id}`} name="paths" defaultValue={area.paths.join("\n")} rows={2} maxLength={5000} />
          <span className="block text-xs font-normal text-zk-muted">One project-relative glob per line.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save area"}</Button>
          <ActionFeedback result={result} />
        </div>
      </form>
      <div className="flex items-start gap-3 sm:justify-end">
        <Button type="button" variant="danger-secondary" disabled={deleting} onClick={removeArea}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
        <ActionFeedback result={deleteResult} />
      </div>
    </li>
  );
}

export function ProjectAreasManager({ projectSlug, areas }: { projectSlug: string; areas: ProjectArea[] }) {
  return (
    <section className="rounded-panel border border-zk-border bg-zk-surface p-4 sm:p-6" aria-labelledby="project-areas-heading">
      <div className="space-y-1">
        <h2 id="project-areas-heading" className="text-base font-semibold text-zk-text">Project areas</h2>
        <p className="text-sm text-zk-text2">Group work inside this project, for example frontend or backend.</p>
      </div>
      <CreateAreaForm projectSlug={projectSlug} />
      {areas.length ? (
        <ul>
          {areas.map((area) => <AreaRow key={area.id} area={area} projectSlug={projectSlug} />)}
        </ul>
      ) : (
        <p className="border-t border-zk-border py-4 text-sm text-zk-muted">No areas yet.</p>
      )}
    </section>
  );
}