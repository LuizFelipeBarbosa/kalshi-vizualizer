// Event view — the event header, an overlaid multi-line price chart of every contract's
// trajectory, and the contract list. Hovering a contract row highlights its overlay line.
// Ported from the vanilla views/event.js.

import { useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";

import { useEvent } from "../api/queries";
import type { EventContract } from "../api/types";
import { Chip } from "../components/Chip";
import EventChart, { overlaySeries } from "../components/EventChart";
import type { EventChartHandle } from "../components/EventChart";
import { ErrorNote, Loading } from "../components/Status";
import { fmtCompact, fmtInt, fmtPct, fmtRange, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

export default function EventView() {
  const { ticker = "" } = useParams();
  const query = useEvent(ticker);
  const chartRef = useRef<EventChartHandle>(null);
  const overlay = useMemo(() => (query.data ? overlaySeries(query.data) : null), [query.data]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNote error={query.error} />;

  const data = query.data;
  const accent = liftAccent(data.color ?? FALLBACK_ACCENT);
  const { series, labels } = overlay!;

  return (
    <>
      <div className="mb-6">
        <Link to="/" className="text-sm text-ink-1 hover:text-ink-0">
          ‹ all events
        </Link>
        <div className="my-2 text-title tracking-[-0.01em]">{data.title || data.event_ticker}</div>
        <div className="font-mono text-sm text-ink-1">
          <Chip style={{ color: accent, borderColor: accent }}>{data.group || ""}</Chip>
          {" \u00A0 "}
          {fmtInt(data.n_contracts)} contracts · {fmtCompact(data.total_volume)} vol ·{" "}
          {fmtRange(data.first_trade, data.last_trade)}
        </div>
      </div>

      <div className="my-4 rounded-md border border-line bg-bg-1 p-4">
        <EventChart ref={chartRef} series={series} labels={labels} />
        {labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 font-mono text-2xs text-ink-1">
            {labels.map((l) => (
              <span key={l.ticker} className="flex items-center gap-3">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
                {l.title}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Contracts</p>
        </div>
        <div className="mt-4 border-t border-line">
          {data.contracts.map((c) => (
            <Link
              key={c.ticker}
              to={`/contract/${encodeURIComponent(c.ticker)}`}
              onMouseEnter={() => chartRef.current?.focusSeries(c.ticker)}
              onMouseLeave={() => chartRef.current?.focusSeries(null)}
              className="group flex cursor-pointer items-center gap-4 border-b border-l-[3px] border-line border-l-transparent px-2 py-3 transition-colors hover:bg-bg-1"
            >
              <span className="min-w-0 flex-1 truncate">{c.title || c.ticker}</span>
              <span className="w-[110px] shrink-0 text-2xs uppercase tracking-[0.06em] text-ink-1">
                {statusLabel(c)}
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-sm text-ink-1 tabular-nums">
                {c.last_yes_price != null ? fmtPct(c.last_yes_price) : "—"}
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-sm text-ink-0 tabular-nums">
                {fmtCompact(c.traded_volume)}
              </span>
              <span className="w-4 text-right text-ink-2 transition-transform group-hover:translate-x-[2px] group-hover:text-ink-0">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

function statusLabel(c: EventContract): string {
  if (c.status === "finalized" && c.result) return "settled " + c.result;
  return c.status || "";
}
