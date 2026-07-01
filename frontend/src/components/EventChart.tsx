// Event overlay — every contract's price line over the event lifetime on one canvas,
// ported from eventOverlay() in the vanilla charts.js. Exposes focusSeries() through a
// handle ref so the contract rows can highlight their line on hover.

import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import uPlot from "uplot";

import type { EventDetail, SeriesEntry } from "../api/types";
import { OVERLAY_PALETTE, drawRail, observeResize, pctAxis, timeAxis, tooltipPlugin } from "../charts/uplot";
import { escapeHtml, fmtDateTime } from "../lib/format";

export interface OverlayLabel {
  ticker: string;
  title: string;
  color: string;
}

export interface EventChartHandle {
  focusSeries(ticker: string | null): void;
}

// Series with data, plus a palette color and a display title per line. The API's series
// entries carry only tickers; titles come from the event's contract list.
export function overlaySeries(event: EventDetail): { series: SeriesEntry[]; labels: OverlayLabel[] } {
  const series = event.series.filter((s) => s.points.length > 0);
  const titles = new Map(event.contracts.map((c) => [c.ticker, c.title]));
  const labels = series.map((s, i) => ({
    ticker: s.ticker,
    title: titles.get(s.ticker) || s.ticker,
    color: OVERLAY_PALETTE[i % OVERLAY_PALETTE.length],
  }));
  return { series, labels };
}

export default function EventChart({
  series,
  labels,
  ref,
}: {
  series: SeriesEntry[];
  labels: OverlayLabel[];
  ref?: Ref<EventChartHandle>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<{ u: uPlot; tickerToIdx: Map<string, number> } | null>(null);

  useImperativeHandle(ref, () => ({
    focusSeries(ticker) {
      const plot = plotRef.current;
      if (!plot) return;
      const i = ticker == null ? null : (plot.tickerToIdx.get(ticker) ?? null);
      plot.u.setSeries(i, { focus: true });
    },
  }), []);

  useEffect(() => {
    const el = elRef.current;
    if (!el || series.length === 0) return;

    // Unified x axis = sorted union of every series' sample timestamps.
    const tset = new Set<number>();
    for (const s of series) for (const p of s.points) tset.add(p.t);
    const xs = Array.from(tset).sort((a, b) => a - b);
    const xi = new Map(xs.map((t, i) => [t, i]));

    const cols = series.map((s) => {
      const arr: (number | null)[] = new Array(xs.length).fill(null);
      for (const p of s.points) arr[xi.get(p.t)!] = p.price / 100;
      return arr;
    });

    const uSeries: uPlot.Series[] = [
      {},
      ...labels.map((m) => ({
        label: m.title,
        stroke: m.color,
        width: 1.4,
        spanGaps: true,
        points: { show: false },
      })),
    ];

    const tip = tooltipPlugin((u, idx) => {
      const t = u.data[0][idx];
      const lines: { m: OverlayLabel; pct: number }[] = [];
      for (let i = 1; i < u.data.length; i++) {
        const v = u.data[i][idx];
        if (v != null) lines.push({ m: labels[i - 1], pct: Math.round(v * 100) });
      }
      if (!lines.length) return "";
      lines.sort((a, b) => b.pct - a.pct);
      const rows = lines
        .slice(0, 8)
        .map(
          (l) =>
            `<div class="t-row"><span><span class="dot" style="background:${l.m.color}"></span>${escapeHtml(
              l.m.title
            )}</span><span>${l.pct}%</span></div>`
        )
        .join("");
      return `<div class="t-date">${fmtDateTime(t)}</div>${rows}`;
    });

    const u = new uPlot(
      {
        width: el.clientWidth || 800,
        height: 360,
        scales: { y: { range: [0, 1] } },
        axes: [timeAxis(), pctAxis()],
        legend: { show: false },
        focus: { alpha: 0.25 },
        cursor: { focus: { prox: 24 } },
        hooks: { draw: [drawRail] },
        plugins: [tip],
        series: uSeries,
      },
      [xs, ...cols] as uPlot.AlignedData,
      el
    );

    plotRef.current = { u, tickerToIdx: new Map(labels.map((m, i) => [m.ticker, i + 1])) };
    const ro = observeResize(u, el, 360);

    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
  }, [series, labels]);

  if (series.length === 0) {
    return <div className="py-8 text-center font-mono text-ink-2">No price history for this event.</div>;
  }

  return <div ref={elRef} />;
}
