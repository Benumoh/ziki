import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QUICK_CHANGES, placeholderCreditCosts, ratioShape, type QuickChange, type RenderTarget, type StudioState } from "./model";
import { styles } from "./styles";

type Props = {
  previewId: string;
  state: StudioState;
  projectName: string;
  onMake: (target: RenderTarget) => void;
  onScene: (scene: number) => void;
  onPlay: () => void;
  onQuickChange: (change: QuickChange) => void;
  onDownload: (format: "MP4" | "GIF") => void;
  onShare: () => void;
  onAgain: () => void;
};

export function VideoPreview({ previewId, state, projectName, onMake, onScene, onPlay, onQuickChange, onDownload, onShare, onAgain }: Props) {
  const lines = state.prompt.split("\n").map((line) => line.trim()).filter(Boolean);
  const shape = ratioShape(state.aspectRatio);
  const costs = placeholderCreditCosts(state.seconds);
  const target = state.renderTarget === "final" ? "final video" : "draft";

  if (state.stage === "making") {
    return (
      <section id={previewId} className={`${styles.card} ${styles.making}`} aria-label={`Making your ${target}`} tabIndex={-1}>
        <h2>Making your {target}</h2>
        <p className={styles.intro}>This usually takes about a minute.</p>
        <div className={styles.progress} role="progressbar" aria-label={`Making your ${target}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress}>
          <span style={{ width: `${state.progress}%` }} />
        </div>
        <ul className={styles.renderSteps}>
          {["Reading your prompt", "Planning the scenes", `Rendering the ${target}`].map((step, index) => (
            <li key={step} className={state.progress >= (index + 1) * 30 ? styles.stepDone : undefined}>
              <span aria-hidden="true">{state.progress >= (index + 1) * 30 ? "✓" : "○"}</span> {step}
            </li>
          ))}
        </ul>
        <p className="sr-only" role="status">Making your {target}. Please wait.</p>
      </section>
    );
  }

  return (
    <section id={previewId} className={styles.card} aria-label="Video preview" tabIndex={-1}>
      <div className={styles.previewHeading}>
        <h2>{state.stage === "final" ? "Your video is ready" : state.stage === "draft" ? "Your draft" : "Preview"}</h2>
        <Badge className={styles.tag}>{state.seconds}s · {state.aspectRatio}</Badge>
      </div>
      <div className={styles.previewFrame}>
        <div className={styles.phone} style={{ width: shape.width, aspectRatio: state.aspectRatio.replace(":", "/") }}>
          <span className={styles.previewTitle}>{state.title || projectName}</span>
          <button type="button" className={styles.play} aria-label={state.playing ? "Pause preview" : "Play preview"} onClick={onPlay} disabled={!lines.length}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {state.playing ? <path d="M6 5h4v14H6zm8 0h4v14h-4z" /> : <path d="m8 5 11 7-11 7V5Z" />}
            </svg>
          </button>
          <p className={styles.caption} aria-live="polite" aria-atomic="true">{lines[state.scene] || "Your video appears here. Pick an idea or write a scene."}</p>
          <div className={styles.playProgress} aria-hidden="true"><span style={{ width: `${lines.length ? ((state.scene + 1) / lines.length) * 100 : 0}%` }} /></div>
        </div>
      </div>
      <div className={styles.sceneButtons} role="group" aria-label="Scenes">
        {Array.from({ length: Math.max(1, lines.length) }, (_, scene) => (
          <button key={scene} type="button" className={styles.pill} aria-pressed={state.scene === scene} onClick={() => onScene(scene)}>Scene {scene + 1}</button>
        ))}
      </div>

      {state.stage === "ready" && (
        <>
          <Button type="button" className={styles.primaryButton} disabled={!lines.length || state.credits < costs.draft} onClick={() => onMake("draft")}>Create draft ({costs.draft} credits)</Button>
          <p className={`${styles.hint} ${styles.center}`}>You only pay for the final if you like the draft.</p>
        </>
      )}
      {state.stage === "draft" && (
        <>
          <Button type="button" className={styles.primaryButton} disabled={state.credits < costs.final || !lines.length} onClick={() => onMake("final")}>Create final video ({costs.final} credits)</Button>
          {state.dirty && <Button type="button" variant="secondary" className={styles.updateButton} disabled={state.credits < costs.draft || !lines.length} onClick={() => onMake("draft")}>Update draft ({costs.draft} credits)</Button>}
          <fieldset className={styles.quickChanges}>
            <legend>Quick changes</legend>
            <div className={styles.pills}>
              {QUICK_CHANGES.map((change) => <button key={change} type="button" className={styles.pill} aria-pressed={state.quickChanges.includes(change)} onClick={() => onQuickChange(change)}>{change}</button>)}
            </div>
          </fieldset>
        </>
      )}
      {state.stage === "final" && (
        <>
          <div className={styles.pills}>
            <Button type="button" variant="secondary" className={styles.softButton} onClick={() => onDownload("MP4")}>Download MP4</Button>
            <Button type="button" variant="secondary" className={styles.softButton} onClick={() => onDownload("GIF")}>Download GIF</Button>
          </div>
          <Button type="button" className={styles.primaryButton} onClick={onShare}>Share link</Button>
          <button type="button" className={styles.link} onClick={onAgain}>Make another video</button>
        </>
      )}
      {state.stage !== "final" && state.credits < (state.stage === "ready" ? costs.draft : costs.final) && <p role="status" className={styles.hint}>Not enough credits for this video.</p>}
    </section>
  );
}
