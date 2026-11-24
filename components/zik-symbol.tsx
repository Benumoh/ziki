/**
 * The Zik's symbol (#ziki-coins): a Z with a vertical bar through it, the way the dollar sign is an S with one. It is
 * drawn, not typed, so it takes the colour and size of the text around it and looks the same on every device. It sits
 * before the number, like the dollar sign: `<ZikAmount amount={50} />` reads "Z̶50". Where a symbol can't go (a sentence,
 * an email, a Stripe page) say "Ziks" in words.
 */
export function ZikSymbol({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 22"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="butt"
      strokeLinejoin="miter"
      className={`inline-block h-[1.05em] w-[0.76em] shrink-0 align-[-0.16em] ${className}`}
    >
      <path d="M3 5.5H13L3 16.5H13" />
      <path d="M8 1V21" />
    </svg>
  );
}

/** An amount of Ziks with the symbol in front. A screen reader hears the number and the word "Ziks". */
export function ZikAmount({ amount, className = "" }: { amount: number; className?: string }) {
  const text = Math.round(amount).toLocaleString("en-US");
  return (
    <span className={`inline-flex items-baseline gap-[0.12em] whitespace-nowrap ${className}`}>
      <span aria-hidden="true" className="inline-flex items-baseline gap-[0.12em]">
        <ZikSymbol />
        {text}
      </span>
      <span className="sr-only">{text} Ziks</span>
    </span>
  );
}
