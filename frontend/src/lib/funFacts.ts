// Composes the one-line "fun fact" for a spotlight highlight from its stats.
// Keyed by the backend's canonical categories with a default, so an unknown
// future category degrades to a generic sentence instead of breaking the card.
// Only settled contracts (result yes/no) may claim a market "closed".

import type { Highlight } from "../api/types";
import { fmtCents, fmtCompact, fmtDuration } from "./format";

const LABELS: Record<string, string> = {
  long_shot: "Long shot",
  stunner: "Stunner",
  photo_finish: "Photo finish",
  rollercoaster: "Rollercoaster",
  marathon: "Marathon",
  whale: "Whale",
};

export function categoryLabel(category: string): string {
  return LABELS[category] ?? category.replace(/_/g, " ");
}

const FACTS: Record<string, (h: Highlight, duration: string | null) => string> = {
  long_shot: (h) => {
    const payout = Math.round(100 / Math.max(1, h.min_price));
    return `Traded as low as ${fmtCents(h.min_price)} before settling YES — a ${payout}× payout for believers.`;
  },
  stunner: (h) =>
    `The market hit ${fmtCents(h.max_price)} — near-certainty — and then it settled NO.`,
  photo_finish: (h, duration) =>
    `A true toss-up: averaged ${fmtCents(h.vwap)} across ${duration != null ? `${duration} of` : "its"} trading` +
    `${h.result ? ` before settling ${h.result.toUpperCase()}` : ""}.`,
  rollercoaster: (h) =>
    `Swung from ${fmtCents(h.min_price)} to ${fmtCents(h.max_price)}` +
    `${h.result ? ` before closing at ${fmtCents(h.last_price)}` : ` — last seen at ${fmtCents(h.last_price)}`}.`,
  marathon: (h, duration) =>
    `${duration != null ? duration : "Months"} on the tape — ${fmtCompact(h.traded_volume)} contracts traded.`,
  whale: (h) =>
    `${fmtCompact(h.traded_volume)} contracts across ${fmtCompact(h.n_trades)} trades — one of the heaviest tapes in the archive.`,
};

export function composeFunFact(h: Highlight): string {
  const duration = fmtDuration(h.first_trade, h.last_trade);
  const fact = FACTS[h.category];
  if (fact) return fact(h, duration);
  return (
    `Opened at ${fmtCents(h.first_price)}, ${h.result ? "closed" : "now"} at ${fmtCents(h.last_price)} ` +
    `on ${fmtCompact(h.traded_volume)} contracts.`
  );
}
