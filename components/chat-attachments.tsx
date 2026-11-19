"use client";

import { useRef, useState, type ReactNode } from "react";
import { AreaCropper } from "@/components/area-cropper";
import { CaptureError, MAX_RECORDING_SECONDS, captureScreenFrame, startScreenRecording, type ScreenRecording } from "@/components/idea-capture";
import { BASE_PATH } from "@/lib/base-path";

type Upload = { key: string; name: string; id?: string; error?: string };

/**
 * A chat box's attachments, as Your App's box has them (#idea-chat): + attaches files, Record screen and Capture
 * area attach what's on screen (kept as images). Each file uploads as it's added; `ids` are the ones that made it.
 * `controls` is the row of buttons beside +, `chips` the files waiting to go, `dialog` the crop step of a capture.
 */
export function useChatAttachments({ disabled = false }: { disabled?: boolean } = {}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ url: string; blob: Blob } | null>(null);
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const recorderRef = useRef<ScreenRecording | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pill = "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition disabled:opacity-40";
  const controls: ReactNode = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="Attach files"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zk-text2 hover:bg-zk-chip hover:text-zk-text disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void attach(event.target.files); event.target.value = ""; }} />
      <button
        type="button"
        onClick={() => void toggleRecording()}
        disabled={disabled}
        aria-pressed={Boolean(recording)}
        className={`${pill} ${recording ? "border-zk-bad-bd bg-zk-bad-soft text-zk-bad-fg" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text"}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-red-500 ${recording ? "motion-safe:animate-pulse" : ""}`} />
        {recording
          ? `Stop recording · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")} of ${MAX_RECORDING_SECONDS / 60}:00`
          : "Record screen"}
      </button>
      <button
        type="button"
        onClick={() => void captureArea()}
        disabled={disabled || Boolean(recording)}
        className={`${pill} border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        </svg>
        Capture area
      </button>
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
