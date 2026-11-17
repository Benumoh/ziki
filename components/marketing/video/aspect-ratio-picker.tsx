import { ASPECT_RATIOS, ratioShape, type AspectRatio } from "./model";
import { styles } from "./styles";

export function AspectRatioPicker({ value, onChange }: { value: AspectRatio; onChange: (value: AspectRatio) => void }) {
  return (
    <fieldset className={styles.ratioField}>
      <legend>Aspect ratio</legend>
      <div className={styles.ratios}>
        {ASPECT_RATIOS.map((ratio) => {
          const shape = ratioShape(ratio.value, 26);
          return (
            <button key={ratio.value} type="button" className={styles.ratio} aria-pressed={value === ratio.value} onClick={() => onChange(ratio.value)}>
              <span className={styles.ratioPicture} aria-hidden="true">
                <span style={shape} />
              </span>
              <strong>{ratio.value}</strong>
              <small>{ratio.label}</small>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
