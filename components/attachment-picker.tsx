"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HELP,
  ATTACHMENT_SIZE_LABEL,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  formatBytes,
} from "@/lib/attachments";

type Item =
  | { key: string; name: string; state: "uploading" }
  | { key: string; name: string; state: "error"; error: string }
  | { key: string; name: string; state: "done"; id: string; size: number };

/**
 * Attach files to an issue or comment (#215). Each file uploads as soon as
 * it's picked; the ids go out with the form as `attachmentIds`.
 */
export function AttachmentPicker({
  name = "attachmentIds",
  onChange,
  onUploadingChange,
  disabled = false,
}: {
  name?: string;
  onChange?: (ids: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);

  const doneIds = (list: Item[]) =>
    list.flatMap((item) => (item.state === "done" ? [item.id] : []));

  const isUploading = items.some((item) => item.state === "uploading");

  const update = (fn: (list: Item[]) => Item[]) => setItems(fn);

  // Tell the parent form after the render, never during it.
  const idsKey = doneIds(items).join(",");
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current?.(idsKey ? idsKey.split(",") : []);
  }, [idsKey]);

  const onUploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  });
  useEffect(() => {
    onUploadingChangeRef.current?.(isUploading);
    return () => {
      if (isUploading) {
        onUploadingChangeRef.current?.(false);
      }
    };
  }, [isUploading]);

  async function upload(file: File, key: string) {
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch(`${BASE_PATH}/api/uploads`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { id?: string; size?: number; error?: string };
      update((list) =>
        list.map((item) =>
          item.key !== key
            ? item
            : res.ok && data.id
              ? { key, name: file.name, state: "done", id: data.id, size: data.size ?? file.size }
              : { key, name: file.name, state: "error", error: data.error ?? "Upload failed. Try again." },
        ),
      );
    } catch {
      update((list) =>
        list.map((item) =>
          item.key === key
            ? { key, name: file.name, state: "error", error: navigator.onLine ? "Upload failed. Try again." : "You're offline." }
            : item,
        ),
      );
    }
  }

  function pick(files: FileList | null) {
    if (!files) return;
    const room = MAX_ATTACHMENTS_PER_ITEM - items.filter((i) => i.state !== "error").length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    const added = chosen.map((file) => ({
      file,
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
    }));
    update((list) => [
      ...list,
      ...added.map(({ file, key }) =>
        file.size > MAX_ATTACHMENT_BYTES
          ? { key, name: file.name, state: "error" as const, error: `File is too large (max ${ATTACHMENT_SIZE_LABEL}).` }
          : { key, name: file.name, state: "uploading" as const },
      ),
    ]);
    added
      .filter(({ file }) => file.size <= MAX_ATTACHMENT_BYTES)
      .forEach(({ file, key }) => void upload(file, key));
    if (inputRef.current) inputRef.current.value = "";
  }

  const full = items.filter((i) => i.state !== "error").length >= MAX_ATTACHMENTS_PER_ITEM;

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={doneIds(items).join(",")} />
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-sm font-medium text-zk-text2 hover:bg-zk-chip has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-electric-blue-strong ${
            disabled || full ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M15.62 4.38a2.75 2.75 0 0 0-3.89 0l-6.36 6.36a1.25 1.25 0 1 0 1.77 1.77l5.66-5.66a.75.75 0 1 1 1.06 1.06l-5.66 5.66a2.75 2.75 0 1 1-3.89-3.89l6.36-6.36a4.25 4.25 0 1 1 6.01 6.01l-6.36 6.37a.75.75 0 0 1-1.06-1.07l6.36-6.36a2.75 2.75 0 0 0 0-3.89Z"
              clipRule="evenodd"
            />
          </svg>
          Attach files
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            aria-describedby={helpId}
            disabled={disabled || full}
            onChange={(event) => pick(event.target.files)}
            className="sr-only"
          />
        </label>
        <span id={helpId} className="text-xs text-zk-muted">
          {ATTACHMENT_HELP}
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1" aria-live="polite">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-zk-border bg-zk-chip px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate text-zk-text">{item.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {item.state === "uploading" ? <span className="text-zk-muted">Uploading…</span> : null}
                {item.state === "done" ? <span className="text-zk-muted">{formatBytes(item.size)}</span> : null}
                {item.state === "error" ? (
                  <span className="text-zk-bad-fg" role="alert">
                    {item.error}
                  </span>
                ) : null}
                {item.state !== "uploading" ? (
                  <button
                    type="button"
                    onClick={() => update((list) => list.filter((i) => i.key !== item.key))}
                    aria-label={`Remove ${item.name}`}
                    className="rounded px-1 text-zk-muted hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
