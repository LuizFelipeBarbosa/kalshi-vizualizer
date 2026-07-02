import type { CSSProperties, ReactNode } from "react";

// Tones carry both text and border color; per-group accents come in through
// `style` instead (inline styles win over utilities, as the design intends).
const TONES = {
  default: "border-line text-ink-1",
  yes: "border-yes text-yes",
  no: "border-no text-no",
} as const;

export function Chip({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`inline-block rounded-[3px] border px-2 py-[2px] text-2xs uppercase tracking-[0.08em] ${TONES[tone]}`}
      style={style}
    >
      {children}
    </span>
  );
}
