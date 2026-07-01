// One contract's price line + a cursor-synced volume strip, ported from
// contractPriceVolume() in the vanilla charts.js. uPlot is imperative, so the
// two instances live inside a single effect and are torn down on cleanup.

import { useEffect, useRef } from "react";
import uPlot from "uplot";

import type { ContractDetail } from "../api/types";
import { AXIS_STROKE, GRID_STROKE, drawRail, observeResize, pctAxis, timeAxis, tooltipPlugin } from "../charts/uplot";
import { fade, fmtCompact, fmtDateTime, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

export default function ContractChart({ contract }: { contract: ContractDetail }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const priceEl = priceRef.current;
    const volEl = volRef.current;
    const points = contract.points;
    if (!priceEl || !volEl || points.length === 0) return;

    const xs = points.map((p) => p.t);
    const ys = points.map((p) => p.price / 100);
    const vol = points.map((p) => p.volume);
    const stroke = liftAccent(contract.color ?? FALLBACK_ACCENT);
    const syncKey = "c-" + contract.ticker;

    const priceTip = tooltipPlugin((_u, idx) => {
      const p = points[idx];
      if (!p) return "";
      return (
        `<div class="t-date">${fmtDateTime(p.t)}</div>` +
        `<div class="t-row"><span>price</span><span>${Math.round(p.price)}%</span></div>` +
        `<div class="t-row"><span>volume</span><span>${fmtCompact(p.volume)}</span></div>`
      );
    });

    const priceU = new uPlot(
      {
        width: priceEl.clientWidth || 800,
        height: 320,
        scales: { y: { range: [0, 1] } },
        axes: [timeAxis(), pctAxis()],
        legend: { show: false },
        cursor: { sync: { key: syncKey } },
        hooks: { draw: [drawRail] },
        plugins: [priceTip],
        series: [
          {},
          { label: "price", stroke, width: 1.9, fill: fade(stroke, 0.07), points: { show: false } },
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
        cursor: { sync: { key: syncKey } },
        series: [
          {},
          { label: "vol", stroke: "#3a4358", fill: "#2a3142", width: 0, paths: uPlot.paths.bars!({ size: [0.7, 8] }) },
        ],
      },
      [xs, vol],
      volEl
    );

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
        </>
      )}
    </div>
  );
}
