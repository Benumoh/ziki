import { useId } from "react";
import { SkeletonPage } from "@/components/ui/skeleton";
import { MOCK_IDEAS, MOCK_WEBSITE, type StartMode, type VideoIdea } from "./model";
import { styles } from "./styles";

type Props = {
  mode: StartMode;
  loading: boolean;
  selectedIdea: string | null;
  onMode: (mode: Exclude<StartMode, null>) => void;
  onIdea: (idea: VideoIdea) => void;
};

function IdeaPicture() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v3m5-3v3" />
    </svg>
  );
}

export function StartOptions({ mode, loading, selectedIdea, onMode, onIdea }: Props) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>How do you want to start?</h2>
      <p className={styles.intro}>Write your own idea, or let us suggest some.</p>
      <div className={styles.modes} role="group" aria-label="How to start">
        <button type="button" aria-pressed={mode === "own"} onClick={() => onMode("own")}>
          <span className={styles.modeIcon} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 15 11-11 4 4L9 19l-5 1 1-5Zm9-9 4 4" /></svg>
          </span>
          <span><strong>I have an idea</strong><small>Write it in the prompt</small></span>
        </button>
        <button type="button" aria-pressed={mode === "ideas"} onClick={() => onMode("ideas")}>
          <span className={styles.modeIcon}><IdeaPicture /></span>
          <span><strong>Give me ideas</strong><small>Made from your website</small></span>
        </button>
      </div>
      {mode === "ideas" && (
        <div className={styles.suggestions} aria-busy={loading}>
          <p className={styles.hint} role="status">
            {loading ? `Reading ${MOCK_WEBSITE}…` : `Made from ${MOCK_WEBSITE}. Tap one and watch the preview.`}
          </p>
          {loading ? (
            <SkeletonPage label="Suggesting video ideas…">
              <div className={styles.ideas}>
                {MOCK_IDEAS.map((idea) => <div key={idea.id} className={styles.ideaSkeleton} />)}
              </div>
            </SkeletonPage>
          ) : (
            <>
              <div className={styles.ideas}>
                {MOCK_IDEAS.map((idea) => (
                  <button key={idea.id} type="button" className={styles.idea} aria-pressed={selectedIdea === idea.id} onClick={() => onIdea(idea)}>
                    <span className={styles.ideaPicture}><IdeaPicture /></span>
                    <span><strong>{idea.title}</strong><small>{idea.seconds}s · {idea.aspectRatio}</small></span>
                  </button>
                ))}
              </div>
              <button type="button" className={styles.link} onClick={() => onMode("ideas")}>Show different ideas</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
