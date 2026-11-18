import { useId } from "react";
import { MAX_LENGTH, MIN_LENGTH } from "./model";
import { styles } from "./styles";

export function LengthSlider({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const id = useId();
  return (
    <div className={styles.length}>
      <div className={styles.lengthHeading}>
        <label htmlFor={id}>How long?</label>
        <output htmlFor={id}>{seconds} seconds</output>
      </div>
      <input id={id} type="range" min={MIN_LENGTH} max={MAX_LENGTH} step={1} value={seconds} aria-label="Video length in seconds" aria-valuetext={`${seconds} seconds`} onChange={(event) => onChange(Number(event.target.value))} />
      <div className={styles.rangeEnds} aria-hidden="true"><span>{MIN_LENGTH}s</span><span>{MAX_LENGTH}s</span></div>
    </div>
  );
}
