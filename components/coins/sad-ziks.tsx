/**
 * A sad Zik coin with an empty pocket, for "you don't have enough Ziks" moments (17 Nov, Hamzat: the borrow offer
 * was too plain). The tear and the coin's wobble move only with motion allowed.
 */
export function SadZiks() {
  return (
    <svg width="96" height="80" viewBox="0 0 96 80" fill="none" aria-hidden="true" className="mx-auto">
      {/* An empty pocket, turned out. */}
      <path d="M64 46h26v16a10 10 0 0 1-10 10h-6a10 10 0 0 1-10-10z" fill="var(--zk-chip)" stroke="var(--zk-border)" strokeWidth="2" />
      <path d="M70 54c3 3 7 3 10 0" stroke="var(--zk-muted)" strokeWidth="2" strokeLinecap="round" />
      {/* The coin, wobbling a little. */}
      <g className="motion-safe:[animation:zk-sad-wobble_2.4s_ease-in-out_infinite] [transform-box:fill-box] [transform-origin:center]">
        <circle cx="36" cy="38" r="26" fill="#fcd34d" stroke="#f59e0b" strokeWidth="3" />
        <circle cx="36" cy="38" r="19" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 4" />
        {/* Sad eyes and mouth. */}
        <path d="M25 34l6-3M47 34l-6-3" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="29" cy="37" r="2.2" fill="#451a03" />
        <circle cx="43" cy="37" r="2.2" fill="#451a03" />
        <path d="M28 49c4-5 12-5 16 0" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
        {/* A tear. */}
        <path
          d="M45 41c1.8 2.6 2.6 4 2.6 5.2a2.6 2.6 0 0 1-5.2 0c0-1.2.8-2.6 2.6-5.2z"
          fill="#38bdf8"
          className="motion-safe:[animation:zk-sad-tear_2.4s_ease-in_infinite]"
        />
      </g>
    </svg>
  );
}
