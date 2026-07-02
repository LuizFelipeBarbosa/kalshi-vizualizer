// One contract's price line + a cursor-synced volume strip, ported from
// contractPriceVolume() in the vanilla charts.js. uPlot is imperative, so the
// two instances live inside a single effect and are torn down on cleanup.
//
// Interactions: drag on the price chart zooms the x axis of BOTH charts (the
// volume strip follows via linkXScales); double-click resets both. The strip
// itself is a crosshair surface only — drag is disabled there so the sync-replayed
// mouse events can't apply a second, slightly-different zoom.

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";

import type { ContractDetail } from "../api/types";
import {
  AXIS_STROKE,
  GRID_STROKE,
  VOL_FLAT,
  drawRail,
  gradientFill,
  linkXScales,
  observeResize,
  priceAxis,
  settlementMarker,
  timeAxis,
  tooltipPlugin,
  volumeFillColors,
} from "../charts/uplot";
import { fmtCents, fmtCompact, fmtDateShort, fmtDateTime, liftAccent } from "../lib/format";
import { computeLifeStats } from "../lib/stats";

const FALLBACK_ACCENT = "#9aa3b2";

export default function ContractChart({ contract }: { contract: ContractDetail }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const stats = useMemo(() => computeLifeStats(contract.points), [contract.points]);

  useEffect(() => {
    const priceEl = priceRef.current;
    const volEl = volRef.current;
    const points = contract.points;
    if (!priceEl || !volEl || points.length === 0) return;

    const xs = points.map((p) => p.t);
    const ys = points.map((p) => p.price / 100);
    const vol = points.map((p) => p.volume);
    const dirColors = volumeFillColors(points);
    const stroke = liftAccent(contract.color ?? FALLBACK_ACCENT);
    const syncKey = "c-" + contract.ticker;
    const settled =
      contract.status === "finalized" && (contract.result === "yes" || contract.result === "no")
        ? (contract.result as "yes" | "no")
        : null;

    const priceTip = tooltipPlugin((_u, idx) => {
      const p = points[idx];
      if (!p) return "";
      const prev = idx > 0 ? points[idx - 1] : null;
      const d = prev ? Math.round(p.price) - Math.round(prev.price) : null;
      const deltaRow =
        d == null
          ? ""
          : `<div class="t-row"><span>Δ prev</span><span class="${d > 0 ? "t-up" : d < 0 ? "t-down" : ""}">` +
            `${d > 0 ? "+" : ""}${d}pp</span></div>`;
      return (
        `<div class="t-date">${fmtDateTime(p.t)}</div>` +
        `<div class="t-row"><span>price</span><span>${Math.round(p.price)}¢</span></div>` +
        deltaRow +
        `<div class="t-row"><span>volume</span><span>${fmtCompact(p.volume)}</span></div>`
      );
    });

    const priceU = new uPlot(
      {
        width: priceEl.clientWidth || 800,
        height: 320,
        scales: { y: { range: [0, 1] } },
        axes: [timeAxis(), priceAxis()],
        legend: { show: false },
        cursor: {
          sync: { key: syncKey },
          drag: { x: true, y: false, setScale: true, dist: 5 },
        },
        hooks: { draw: settled ? [drawRail, settlementMarker(settled)] : [drawRail] },
        plugins: [priceTip],
        series: [
          {},
          { label: "price", stroke, width: 1.9, fill: gradientFill(stroke), points: { show: false } },
        ],
      },
      [xs, ys],
      priceEl
    );

    const volU = new uPlot(
      {
        width: volEl.clientWidth || 800,
        height: 90,
        scales: { x: { time: true }, y: { range: (_u, _min, max) => [0, max || 1] } },
        axes: [
          { show: false },
          {
            stroke: AXIS_STROKE,
            size: 44,
            grid: { stroke: GRID_STROKE, width: 1 },
            ticks: { stroke: GRID_STROKE },
            values: (_u, vals) => vals.map((v) => fmtCompact(v)),
          },
        ],
        legend: { show: false },
        cursor: {
          sync: { key: syncKey },
          drag: { x: false, y: false, setScale: false },
        },
        // Without this, the cursor-sync replay still draws the price chart's drag
        // selection here (using the SOURCE chart's drag state) and never hides it.
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
        series: [
          {},
          {
            label: "vol",
            stroke: "#3a4358",
            fill: VOL_FLAT,
            width: 0, // must stay 0: per-bar disp.fill is ignored when a stroke width is set
            points: { show: false }, // stop the density heuristic capping zoomed-in bars with dots
            paths: uPlot.paths.bars!({
              size: [0.7, 8],
              // 3 = Color facet; the literal is required because isolatedModules
              // forbids referencing ambient const-enum values.
              disp: { fill: { unit: 3 as uPlot.Series.BarsPathBuilderFacetUnit, values: () => dirColors } },
            }),
          },
        ],
      },
      [xs, vol],
      volEl
    );

    linkXScales(priceU, volU);

    const roP = observeResize(priceU, priceEl, 320);
    const roV = observeResize(volU, volEl, 90);

    return () => {
      roP.disconnect();
      roV.disconnect();
      priceU.destroy();
      volU.destroy();
    };
  }, [contract]);

  return (
    <div className="my-4 rounded-md border border-line bg-bg-1 p-4">
      {contract.points.length === 0 ? (
        <div className="py-8 text-center font-mono text-ink-2">No trades recorded for this contract.</div>
      ) : (
        <>
          <div ref={priceRef} />
          <div ref={volRef} className="mt-2" />
          {stats && (
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-4 border-t border-line pt-3">
              <ChartStat label="High" value={fmtCents(stats.high.price)} note={fmtDateShort(stats.high.t)} />
              <ChartStat label="Low" value={fmtCents(stats.low.price)} note={fmtDateShort(stats.low.t)} />
              <ChartStat label="Range" value={stats.rangePp + "pp"} />
              <ChartStat label="VWAP" value={stats.vwap != null ? fmtCents(stats.vwap) : "—"} note="vol-weighted" />
              <ChartStat
                label="Life Δ"
                value={(stats.lifeDeltaPp > 0 ? "+" : "") + stats.lifeDeltaPp + "pp"}
                tone={stats.lifeDeltaPp > 0 ? "text-yes" : stats.lifeDeltaPp < 0 ? "text-no" : undefined}
              />
            </div>
          )}
          <div className="mt-2 text-right font-mono text-2xs text-ink-2">drag to zoom · double-click to reset</div>
        </>
      )}
    </div>
  );
}

function ChartStat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-[0.1em] text-ink-1">{label}</div>
      <div className={`mt-1 font-mono text-base tabular-nums ${tone ?? ""}`}>{value}</div>
      {note && <div className="mt-[2px] font-mono text-2xs text-ink-2">{note}</div>}
    </div>
  );
}
