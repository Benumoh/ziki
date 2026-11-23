import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "danger-secondary";

/**
 * Ziki's buttons (#flat-buttons, docs/style-guide.md): flat, never a shadow, gradient or lift; 10px corners; the same
 * height in every variant. Hover changes only the fill.
 */
const variants: Record<Variant, string> = {
  // Dark gray, white text; hover to black. One per view.
  primary: "bg-electric-blue-strong text-white hover:bg-zk-ink",
  // Ziki Blue, white text: the one call to action on a public page.
  accent: "bg-zk-blue text-white hover:bg-teal-600",
  // White with a thin line, black text.
  secondary: "bg-zk-surface text-zk-text border border-zk-border hover:bg-zk-chip",
  // No fill until hovered.
  ghost: "bg-transparent text-zk-text2 hover:bg-zk-chip hover:text-zk-text",
  danger: "bg-red-600 text-white hover:bg-red-700",
  "danger-secondary": "bg-zk-surface text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300",
};

export function Button({
  children,
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
}) {
  return (
    <button
      className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
