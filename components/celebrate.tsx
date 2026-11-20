/**
 * Celebrations (#just-delivered): a dancing agent, fireworks and floating hearts, drawn in CSS so they cost nothing to
 * load. Each piece's angle and colour come from its index (no randomness while rendering), and all of it stays still
 * for people who ask for reduced motion.
 */

const COLOURS = ["#f5b942", "#ef4f6b", "#3b82f6", "#22a85b", "#a855f7", "#f97316"];

/** The keyframes, once per page that celebrates. */
export function CelebrationStyles() {
  return (
    <style>{`
@keyframes zk-burst { 0% { transform: translate(0,0) scale(1); opacity: 1 } 80% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(.4); opacity: 0 } }
@keyframes zk-float { 0% { transform: translate(0,0) scale(.6); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), -140px) scale(1.15); opacity: 0 } }
@keyframes zk-dance { 0%,100% { transform: translateY(0) rotate(-7deg) } 25% { transform: translateY(-5px) rotate(0) } 50% { transform: translateY(0) rotate(7deg) } 75% { transform: translateY(-5px) rotate(0) } }
@keyframes zk-wave-l { 0%,100% { transform: rotate(20deg) } 50% { transform: rotate(-35deg) } }
@keyframes zk-wave-r { 0%,100% { transform: rotate(-20deg) } 50% { transform: rotate(35deg) } }
@media (prefers-reduced-motion: reduce) { .zk-motion, .zk-motion * { animation: none !important } }
`}</style>
  );
}

/** One firework: sparks flying out from a point. `delay` and `repeat` set when it goes off and whether it keeps going. */
function Burst({ x, y, delay, repeat, sparks = 14, soft = false }: { x: string; y: string; delay: number; repeat: boolean; sparks?: number; soft?: boolean }) {
  return (
    <span aria-hidden="true" className="absolute" style={{ left: x, top: y }}>
      {Array.from({ length: sparks }, (_, index) => {
        const angle = (index / sparks) * Math.PI * 2;
        const reach = (soft ? 18 : 34) + (index % 3) * (soft ? 6 : 10);
        return (
          <span
            key={index}
            className={`absolute rounded-full ${soft ? "h-1 w-1 opacity-60" : "h-1.5 w-1.5"}`}
            style={{
              backgroundColor: COLOURS[(index + Math.round(delay * 10)) % COLOURS.length],
              ["--dx" as string]: `${Math.cos(angle) * reach}px`,
              ["--dy" as string]: `${Math.sin(angle) * reach}px`,
              animation: `zk-burst ${soft ? 2.4 : 1.3}s ease-out ${delay}s ${repeat ? "infinite" : "1"} both`,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Fireworks over an area: a few bursts at different places and times. `repeat` keeps them going; `soft` is the quiet
 * kind for a card that stays on screen: three small, slow, faint bursts.
 */
export function Fireworks({ repeat = false, soft = false }: { repeat?: boolean; soft?: boolean }) {
  if (soft) {
    return (
      <span aria-hidden="true" className="zk-motion pointer-events-none absolute inset-0 overflow-hidden">
        <Burst x="58%" y="45%" delay={0} repeat={repeat} sparks={8} soft />
        <Burst x="76%" y="35%" delay={1.6} repeat={repeat} sparks={8} soft />
        <Burst x="90%" y="60%" delay={3.1} repeat={repeat} sparks={8} soft />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="zk-motion pointer-events-none absolute inset-0 overflow-hidden">
      <Burst x="12%" y="40%" delay={0} repeat={repeat} />
      <Burst x="48%" y="25%" delay={0.45} repeat={repeat} />
      <Burst x="82%" y="45%" delay={0.9} repeat={repeat} />
      <Burst x="66%" y="70%" delay={1.3} repeat={repeat} sparks={10} />
      <Burst x="30%" y="72%" delay={1.7} repeat={repeat} sparks={10} />
    </span>
  );
}

/** Hearts floating up from the bottom of an area. */
export function Hearts() {
  return (
    <span aria-hidden="true" className="zk-motion pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 16 }, (_, index) => (
        <span
          key={index}
          className="absolute bottom-0 text-[18px] leading-none"
          style={{
            left: `${6 + ((index * 37) % 88)}%`,
            color: index % 3 === 0 ? "#ef4f6b" : index % 3 === 1 ? "#f472b6" : "#e11d48",
            ["--dx" as string]: `${((index % 5) - 2) * 14}px`,
            animation: `zk-float 2.2s ease-out ${(index % 8) * 0.15}s 1 both`,
          }}
        >
          ♥
        </span>
      ))}
    </span>
  );
}

/** A small agent dancing: a round robot that sways and bobs, waving both arms. */
export function DancingAgent({ size = 40, still = false }: { size?: number; still?: boolean }) {
  // Still: the same agent, standing, until there is something to celebrate.
  const move = (animation: string) => (still ? undefined : animation);
  return (
    <span aria-hidden="true" className="zk-motion inline-block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} style={{ animation: move("zk-dance 0.9s ease-in-out infinite"), transformOrigin: "50% 90%" }}>
        {/* Arms, waving from the shoulders. */}
        <g style={{ animation: move("zk-wave-l 0.45s ease-in-out infinite"), transformOrigin: "13px 27px" }}>
          <rect x="4" y="25" width="10" height="4" rx="2" fill="#2f8cf0" />
          <circle cx="4" cy="27" r="2.6" fill="#f5b942" />
        </g>
        <g style={{ animation: move("zk-wave-r 0.45s ease-in-out infinite"), transformOrigin: "35px 27px" }}>
          <rect x="34" y="25" width="10" height="4" rx="2" fill="#2f8cf0" />
          <circle cx="44" cy="27" r="2.6" fill="#f5b942" />
        </g>
        {/* Antenna, head and body. */}
        <line x1="24" y1="5" x2="24" y2="10" stroke="#2f8cf0" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="4.5" r="2.5" fill="#ef4f6b" />
        <rect x="12" y="10" width="24" height="18" rx="7" fill="#2f8cf0" />
        <rect x="15.5" y="14" width="17" height="9" rx="4.5" fill="#e8f2ff" />
        <circle cx="20.5" cy="18.5" r="2" fill="#1d2a3a" />
        <circle cx="27.5" cy="18.5" r="2" fill="#1d2a3a" />
        <path d="M21 25.2q3 2 6 0" stroke="#e8f2ff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <rect x="16" y="29" width="16" height="11" rx="4" fill="#1f6fc6" />
        <rect x="17.5" y="40" width="4" height="6" rx="2" fill="#1f6fc6" />
        <rect x="26.5" y="40" width="4" height="6" rx="2" fill="#1f6fc6" />
      </svg>
    </span>
  );
}
