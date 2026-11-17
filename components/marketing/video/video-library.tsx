import { Badge } from "@/components/ui/badge";
import { MOCK_TEMPLATES, type FinishedVideo, type StudioTab, type VideoTemplate } from "./model";
import { styles } from "./styles";

type Props = {
  tab: Exclude<StudioTab, "create">;
  projectName: string;
  videos: readonly FinishedVideo[];
  disabled: boolean;
  onTemplate: (template: VideoTemplate) => void;
};

export function VideoLibrary({ tab, projectName, videos, disabled, onTemplate }: Props) {
  const inspiration = tab === "inspiration";
  if (tab === "videos") {
    return (
      <>
        <h1>My videos</h1>
        <p className={styles.subtitle}>Everything you have made for {projectName}.</p>
        {videos.length ? (
          <div className={styles.libraryGrid}>
            {videos.map((video) => (
              <article key={video.id} className={styles.card}>
                <div className={styles.libraryPicture} aria-hidden="true"><span style={{ aspectRatio: video.aspectRatio.replace(":", "/") }} /></div>
                <h2>{video.title}</h2>
                <p className={styles.hint}>{video.seconds}s · {video.aspectRatio}</p>
                <Badge className={styles.tag}>Delivered</Badge>
              </article>
            ))}
          </div>
        ) : <div className={styles.empty}>Your finished videos will appear here.</div>}
      </>
    );
  }

  return (
    <>
      <h1>{inspiration ? "Inspiration" : "Templates"}</h1>
      <p className={styles.subtitle}>{inspiration ? "See what other businesses make. Try any idea with your own product." : "Start from a ready structure. Every scene can be changed."}</p>
      <div className={styles.libraryGrid}>
        {MOCK_TEMPLATES.map((template) => (
          <article key={template.id} className={styles.card}>
            <div className={styles.libraryPicture} aria-hidden="true"><span style={{ aspectRatio: template.aspectRatio.replace(":", "/") }} /></div>
            <h2>{template.title}</h2>
            <p className={styles.hint}>{template.aspectRatio} · {template.category}</p>
            <button type="button" className={styles.link} disabled={disabled} onClick={() => onTemplate(template)}>{inspiration ? "Try this idea" : "Use template"}</button>
          </article>
        ))}
      </div>
    </>
  );
}
