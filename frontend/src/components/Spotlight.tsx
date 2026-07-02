// Rotating "fun fact" card surfacing interesting contracts from /api/highlights.
// Auto-advances every 9s via a self-rescheduling timeout keyed on the index
// (StrictMode-safe: cleanup clears it; manual nav restarts the countdown).
// Decorative section: renders nothing while loading or on error.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useHighlights } from "../api/queries";
import { NO_COLOR, YES_COLOR } from "../charts/uplot";
import { Chip } from "../components/Chip";
import Sparkline from "../components/Sparkline";
import { categoryLabel, composeFunFact } from "../lib/funFacts";
import { fmtCompact, fmtRange, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

export default function Spotlight() {
  const query = useHighlights();
  const items = query.data ?? [];
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Start somewhere different on every visit ("a section that changes").
  useEffect(() => {
    if (items.length) setIdx(Math.floor(Math.random() * items.length));
  }, [items.length]);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % items.length), 9000);
    return () => clearTimeout(t);
  }, [idx, paused, items.length]);

  if (items.length === 0) return null;

  const item = items[Math.min(idx, items.length - 1)];
  const accent = liftAccent(item.color ?? FALLBACK_ACCENT);
  const sparkStroke = item.result === "yes" ? YES_COLOR : item.result === "no" ? NO_COLOR : accent;
  const step = (d: number) => setIdx((i) => (i + d + items.length) % items.length);

  return (
    <div className="mt-12">
      <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
        <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Spotlight</p>
        <span className="flex-1" />
        <button type="button" onClick={() => step(-1)} className="cursor-pointer font-mono text-sm text-ink-1 hover:text-ink-0">
          ‹
        </button>
        <span className="font-mono text-2xs text-ink-2 tabular-nums">
          {String(idx + 1).padStart(2, "0")} / {items.length}
        </span>
        <button type="button" onClick={() => step(1)} className="cursor-pointer font-mono text-sm text-ink-1 hover:text-ink-0">
          ›
        </button>
      </div>

      <Link
        to={`/contract/${encodeURIComponent(item.ticker)}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="block min-h-[132px] rounded-md border border-line border-l-[3px] bg-bg-1 p-4 transition-colors hover:bg-bg-2"
        style={{ borderLeftColor: accent }}
      >
        <div key={item.ticker} className="animate-spot-in flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1 basis-[320px]">
            <div className="flex items-center gap-3">
              <Chip style={{ color: accent, borderColor: accent }}>{categoryLabel(item.category)}</Chip>
              {item.result === "yes" || item.result === "no" ? (
                <Chip tone={item.result === "yes" ? "yes" : "no"}>{item.result}</Chip>
              ) : null}
            </div>
            <p className="my-3 text-lg leading-snug">{composeFunFact(item)}</p>
            {/* Ticker always shown: two-sided game markets share one title, and the
                side (e.g. …-IND vs …-NYG) is what makes a YES/NO fact readable. */}
            <div className="truncate font-mono text-sm text-ink-1">
              {item.title || item.ticker}
              {item.title && item.title !== item.ticker ? (
                <span className="text-ink-2"> · {item.ticker}</span>
              ) : null}
            </div>
            <div className="mt-1 font-mono text-2xs text-ink-2">
              {item.group ? `${item.group} · ` : ""}
              {fmtCompact(item.traded_volume)} vol · {fmtRange(item.first_trade, item.last_trade)}
            </div>
          </div>
          <div className="shrink-0">
            <Sparkline points={item.sparkline} stroke={sparkStroke} endDot className="h-14 w-44" />
          </div>
        </div>
      </Link>
    </div>
  );
}
