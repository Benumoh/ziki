import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FILE_LIMITS, countFiles, type CreateSource, type StudioAsset, type VideoUse } from "./model";
import { styles } from "./styles";

type Props = {
  source: CreateSource;
  files: readonly StudioAsset[];
  urlOpen: boolean;
  url: string;
  videoUse: VideoUse;
  onSource: (source: CreateSource) => void;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onAsset: () => void;
  onToggleUrl: () => void;
  onUrl: (url: string) => void;
  onAddUrl: () => void;
  onVideoUse: (use: VideoUse) => void;
};

export function CreateFrom({ source, files, urlOpen, url, videoUse, onSource, onFiles, onRemove, onAsset, onToggleUrl, onUrl, onAddUrl, onVideoUse }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const counts = countFiles(files);

  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Create from</h2>
      <div className={styles.sources} role="group" aria-label="Input type">
        {([ ["media", "Media"], ["image", "Image"], ["text", "Text"] ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={source === value} onClick={() => onSource(value)}>
            {label}
          </button>
        ))}
      </div>

      {source === "text" ? (
        <p className={styles.sourceNote}>Describe your idea in the prompt below. No files needed.</p>
      ) : (
        <>
          <div className={styles.counters}>
            <strong>{source === "image" ? "First frame" : "Media files"}</strong>
            {source === "media" && (
              <span role="status" className={styles.countValues}>
                <span aria-label={`${counts.photo} of ${FILE_LIMITS.photo} photos`}>Img: {counts.photo}/{FILE_LIMITS.photo}</span>
                <span aria-label={`${counts.clip} of ${FILE_LIMITS.clip} clips`}>Vid: {counts.clip}/{FILE_LIMITS.clip}</span>
                <span aria-label={`${counts.audio} of ${FILE_LIMITS.audio} audio files`}>Aud: {counts.audio}/{FILE_LIMITS.audio}</span>
              </span>
            )}
          </div>
          <div
            className={styles.uploadBar}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <input
              ref={input}
              type="file"
              hidden
              multiple={source === "media"}
              accept={source === "image" ? "image/*" : "image/*,video/*,audio/*"}
              onChange={(event) => {
                onFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <Button type="button" variant="ghost" className={styles.uploadTrigger} onClick={() => input.current?.click()}>
              {source === "image" ? "Drop or click to upload an image" : "Drop or click to upload"}
            </Button>
            {source === "media" && (
              <div className={styles.uploadActions}>
                <Button type="button" variant="ghost" className={styles.softButton} onClick={onAsset}>Asset</Button>
                <Button type="button" variant="ghost" className={styles.softButton} aria-expanded={urlOpen} aria-controls={`${id}-url`} onClick={onToggleUrl}>URL</Button>
              </div>
            )}
          </div>
          {urlOpen && source === "media" && (
            <div className={styles.urlRow} id={`${id}-url`}>
              <Input
                type="url"
                aria-label="File link"
                placeholder="Paste a link to a photo, clip or audio file"
                value={url}
                onChange={(event) => onUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); onAddUrl(); }
                  if (event.key === "Escape") onToggleUrl();
                }}
                className={styles.field}
              />
              <Button type="button" variant="secondary" className={styles.softButton} onClick={onAddUrl}>Add</Button>
            </div>
          )}
          {files.length > 0 && (
            <ul className={styles.files} aria-label="Selected files">
              {files.map((file, index) => (
                <li key={file.id} className={styles.fileTile} title={file.name}>
                  <span className={styles.fileKind}>{file.kind === "photo" ? "Photo" : file.kind === "clip" ? "Clip" : "Audio"}</span>
                  {/* Local blob URLs need a native image, never an image proxy. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {file.previewUrl && <img src={file.previewUrl} alt="" />}
                  <span className={styles.fileRef}>@{index + 1}</span>
                  <button type="button" className={styles.removeFile} aria-label={`Remove file ${index + 1}: ${file.name}`} onClick={() => onRemove(file.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
          {source === "media" && counts.clip > 0 && (
            <fieldset className={styles.videoUse}>
              <legend>What should we do with your video?</legend>
              <div className={styles.pills}>
                {(["Reference", "Extend", "Edit"] as const).map((use) => (
                  <button key={use} type="button" className={styles.pill} aria-pressed={videoUse === use} onClick={() => onVideoUse(use)}>{use}</button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
