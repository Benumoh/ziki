"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AreaCropper } from "@/components/area-cropper";
import { CaptureError, MAX_RECORDING_SECONDS, captureScreenFrame, startScreenRecording, type ScreenRecording } from "@/components/idea-capture";
import { BASE_PATH } from "@/lib/base-path";

type Upload = { key: string; name: string; id?: string; error?: string };

/**
 * A chat box's attachments, the same on Your App and Marketing (#idea-chat): + opens a menu with Attach files,
 * Record screen and Capture area; the last two attach what's on screen (kept as images). Each file uploads as it's added; `ids` are the ones that made it.
 * `controls` is the row of buttons beside +, `chips` the files waiting to go, `dialog` the crop step of a capture.
 */
export function useChatAttachments({ disabled = false }: { disabled?: boolean } = {}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ url: string; blob: Blob } | null>(null);
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const recorderRef = useRef<ScreenRecording | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The + menu, and the box it sits in for closing it on a click outside.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape or a click outside closes the + menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  async function attach(files: FileList | File[] | null) {
    for (const file of Array.from(files ?? []).slice(0, 5)) {
      const key = `${file.name}-${Math.random().toString(36).slice(2)}`;
      setUploads((list) => [...list, { key, name: file.name }]);
      const body = new FormData();
      body.set("file", file);
      try {
        const res = await fetch(`${BASE_PATH}/api/uploads`, { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        setUploads((list) => list.map((u) => (u.key !== key ? u : res.ok && data.id ? { ...u, id: data.id } : { ...u, error: data.error ?? "Upload failed" })));
      } catch {
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: "Upload failed" } : u)));
      }
    }
  }

  function captureFailed(thrown: unknown) {
    setError(thrown instanceof CaptureError ? thrown.message : "Couldn't use the screen. Try again.");
  }

  async function captureArea() {
    setError(null);
    try {
      const blob = await captureScreenFrame();
      setCrop({ url: URL.createObjectURL(blob), blob });
    } catch (thrown) {
      captureFailed(thrown);
    }
  }

  function closeCrop() {
    if (crop) URL.revokeObjectURL(crop.url);
    setCrop(null);
  }

  function keepCapture(blob: Blob) {
    closeCrop();
    void attach([new File([blob], `screen-capture-${Date.now()}.png`, { type: "image/png" })]);
  }

  function keepRecording(frames: Blob[]) {
    recorderRef.current = null;
    setRecording(null);
    const stamp = Date.now();
    void attach(frames.map((frame, index) => new File([frame], `screen-recording-${stamp}-${index + 1}.jpg`, { type: "image/jpeg" })));
  }

  async function toggleRecording() {
    if (recorderRef.current) {
      keepRecording(await recorderRef.current.stop());
      return;
    }
    setError(null);
    try {
      recorderRef.current = await startScreenRecording({ onTick: (seconds) => setRecording({ seconds }), onEnd: keepRecording });
      setRecording({ seconds: 0 });
    } catch (thrown) {
      captureFailed(thrown);
    }
  }

  // The + menu: Attach files, Record screen and Capture area, under one button so the box stays clean. A recording
  // under way shows beside +, so it can be stopped.
  const item = "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-zk-text hover:bg-zk-chip disabled:cursor-default disabled:opacity-40";
  const controls: ReactNode = (
    <div ref={menuRef} className="relative flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setMenuOpen((value) => !value)}
        disabled={disabled}
        aria-label="Add files or capture the screen"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Add"
        className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text disabled:opacity-40 ${menuOpen ? "bg-zk-chip text-zk-text" : ""}`}
      >
        <svg viewBox="0 0 24 24" className={`h-5 w-5 transition ${menuOpen ? "rotate-45" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void attach(event.target.files); event.target.value = ""; }} />
      {menuOpen ? (
        <div role="menu" aria-label="Add" className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-zk-border bg-zk-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <button type="button" role="menuitem" className={item} onClick={() => {
              setMenuOpen(false);
              fileRef.current?.click();
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zk-text2"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
            Attach files
          </button>
          <button type="button" role="menuitem" className={item} disabled={Boolean(recording)} onClick={() => {
              setMenuOpen(false);
              void toggleRecording();
            }}>
            <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /></span>
            Record screen
          </button>
          <button type="button" role="menuitem" className={item} disabled={Boolean(recording)} onClick={() => {
              setMenuOpen(false);
              void captureArea();
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zk-text2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /></svg>
            Capture area
          </button>
        </div>
      ) : null}
      {recording ? (
        <button
          type="button"
          onClick={() => void toggleRecording()}
          aria-pressed={true}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-zk-bad-bd bg-zk-bad-soft px-2.5 text-[11px] font-semibold text-zk-bad-fg transition"
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
          {`Stop recording · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")} of ${MAX_RECORDING_SECONDS / 60}:00`}
        </button>
      ) : null}
    </div>
  );

  const chips: ReactNode = uploads.length ? (
    <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
      {uploads.map((u) => (
        <li key={u.key} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${u.error ? "bg-zk-bad-bg text-zk-bad-fg" : "bg-zk-chip text-zk-text2"}`}>
          <span className="max-w-48 truncate">{u.name}</span>
          {u.error ? <span>· {u.error}</span> : !u.id ? <span>· uploading…</span> : null}
          <button type="button" aria-label={`Remove ${u.name}`} onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))} className="ml-0.5 rounded-full px-1 hover:bg-zk-border">×</button>
        </li>
      ))}
    </ul>
  ) : null;

  const dialog: ReactNode = crop ? (
    <div role="dialog" aria-modal="true" aria-label="Crop the capture" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-[min(60rem,100%)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-4 shadow-2xl">
        <AreaCropper
          imageSrc={crop.url}
          onCropComplete={(blob, url) => {
            URL.revokeObjectURL(url);
            keepCapture(blob);
          }}
          onUseFull={() => keepCapture(crop.blob)}
          onRetake={() => {
            closeCrop();
            void captureArea();
          }}
          onCancel={closeCrop}
        />
      </div>
    </div>
  ) : null;

  return {
    /** How many files are attached or uploading. */
    count: uploads.length,
    ids: uploads.filter((u) => u.id).map((u) => u.id!),
    uploading: uploads.some((u) => !u.id && !u.error),
    error,
    clear: () => {
      setUploads([]);
      setError(null);
    },
    controls,
    chips,
    dialog,
  };
}
