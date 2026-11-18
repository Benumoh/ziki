import { useId, type RefObject } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PROMPT_LENGTH } from "./model";
import { styles } from "./styles";

type Props = {
  value: string;
  references: readonly string[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onInsert: (reference: string) => void;
  onImprove: () => void;
  onInspiration: () => void;
};

export function PromptEditor({ value, references, inputRef, onChange, onInsert, onImprove, onInspiration }: Props) {
  const id = useId();
  return (
    <div>
      <h2><label htmlFor={id}>Prompt</label></h2>
      <p className={styles.intro} id={`${id}-hint`}>
        {references.length ? `Use ${references.join(", ")} to point at your files.` : "Describe what you want. One line per scene works best."}
      </p>
      <div className={styles.promptBox}>
        <Textarea
          id={id}
          ref={inputRef}
          className={styles.promptInput}
          value={value}
          maxLength={MAX_PROMPT_LENGTH}
          aria-describedby={`${id}-hint ${id}-count`}
          placeholder={"Describe the video you want to make…\n\nWrite one line for each scene. For example:\nA busy morning turns calm as the first cup is poured."}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className={styles.promptFooter}>
          <span id={`${id}-count`}>{value.length}/10,000</span>
          <div className={styles.pills}>
            {references.map((reference) => (
              <button key={reference} type="button" className={styles.pill} aria-label={`Insert ${reference} in the prompt`} onClick={() => onInsert(reference)}>{reference}</button>
            ))}
            <button type="button" className={styles.improve} onClick={onImprove}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m4 20 13-13m-2-4v5m-3-2h6m2 5v5m-2-2h4" /></svg>
              Improve my prompt
            </button>
          </div>
        </div>
      </div>
      <button type="button" className={`${styles.link} ${styles.inspirationLink}`} onClick={onInspiration}>Need inspiration? Browse examples from other businesses</button>
    </div>
  );
}
