// Shared uPlot config pieces, ported from the vanilla static/js/charts.js.
// The dashed 50% "conviction rail" drawn through every chart is the structural spine.

import uPlot from "uplot";

import type { PricePoint } from "../api/types";
import { fade } from "../lib/format";

export const AXIS_STROKE = "#5c6575";
export const GRID_STROKE = "#232938";
const RAIL_COLOR = "#3a4358";

// Mirror the --color-yes / --color-no tokens in index.css (canvas can't read CSS vars cheaply).
export const YES_COLOR = "#36d399";
export const NO_COLOR = "#f25c66";

// Distinct hues for overlaying many contracts of the SAME group (which share one color).
export const OVERLAY_PALETTE = [
  "#5b8ff9", "#61ddaa", "#65789b", "#f6bd16", "#7262fd",
  "#78d3f8", "#9661bc", "#f6903d", "#008685", "#f08bb4",
  "#e8684a", "#6dc8ec",
];

export function drawRail(u: uPlot): void {
  const ctx = u.ctx;
  const y = Math.round(u.valToPos(0.5, "y", true)) + 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = RAIL_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.moveTo(u.bbox.left, y);
  ctx.lineTo(u.bbox.left + u.bbox.width, y);
  ctx.stroke();
  ctx.restore();
}

// Vertical gradient for the area under the price line. Must stay a FUNCTION returning
// a fresh gradient from the live bbox: uPlot re-invokes fill functions on every draw,
// which is exactly what keeps the gradient correct across resizes. Never memoize it.
export function gradientFill(hex: string, topAlpha = 0.26, bottomAlpha = 0.02): uPlot.Series.Fill {
  return (u: uPlot) => {
    const { top, height } = u.bbox;
    const g = u.ctx.createLinearGradient(0, top, 0, top + height);
    g.addColorStop(0, fade(hex, topAlpha));
    g.addColorStop(1, fade(hex, bottomAlpha));
    return g;
  };
}

// Draw-hook marking a finalized contract's last point: a result-colored dot with a
// label to its left. Canvas (like drawRail) so it redraws with zoom/resize for free.
export function settlementMarker(result: "yes" | "no"): (u: uPlot) => void {
  const color = result === "yes" ? YES_COLOR : NO_COLOR;
  const label = "SETTLED " + result.toUpperCase();
  return (u) => {
    const xs = u.data[0];
    const ys = u.data[1];
    const i = xs.length - 1;
    const { min, max } = u.scales.x;
    // Skip when the final bucket is zoomed out of view (or scales aren't ranged yet).
    if (i < 0 || ys[i] == null || min == null || max == null || xs[i] < min || xs[i] > max) return;
    const x = u.valToPos(xs[i], "x", true);
    const y = u.valToPos(ys[i]!, "y", true);
    const ctx = u.ctx;
    const pr = devicePixelRatio;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 4 * pr, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2 * pr;
    ctx.strokeStyle = "#0b0e14"; // bg-0 ring separates the dot from the line
    ctx.stroke();
    ctx.font = `600 ${10 * pr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const ly = Math.min(Math.max(y, u.bbox.top + 8 * pr), u.bbox.top + u.bbox.height - 8 * pr);
    ctx.fillText(label, x - 10 * pr, ly);
    ctx.restore();
  };
}

// Per-bucket volume bar colors keyed to the price direction vs the previous bucket.
export const VOL_UP = "rgba(54, 211, 153, 0.38)";
export const VOL_DOWN = "rgba(242, 92, 102, 0.38)";
export const VOL_FLAT = "#2a3142";

export function volumeFillColors(points: PricePoint[]): string[] {
  return points.map((p, i) =>
    i === 0 || Math.round(p.price) === Math.round(points[i - 1].price)
      ? VOL_FLAT
      : p.price > points[i - 1].price
        ? VOL_UP
        : VOL_DOWN
  );
}

// Keep two charts' x scales in lockstep (drag-zoom on one moves both; double-click
// reset propagates the same way). The min/max equality check is the real loop
// terminator — uPlot can defer hooks through its internal queue, so a boolean lock
// alone would not stop a bounce. Never mirror while a scale is still un-ranged (null).
export function linkXScales(a: uPlot, b: uPlot): void {
  let lock = false;
  const mirror = (src: uPlot, dst: uPlot) => (_u: uPlot, key: string) => {
    if (key !== "x" || lock) return;
    const { min, max } = src.scales.x;
    const d = dst.scales.x;
    if (min == null || max == null || (d.min === min && d.max === max)) return;
    lock = true;
    dst.setScale("x", { min, max });
    lock = false;
  };
  (a.hooks.setScale ??= []).push(mirror(a, b));
  (b.hooks.setScale ??= []).push(mirror(b, a));
}

// Price axis in Kalshi cents (the y scale is 0–1; ticks read 0¢…100¢). One unit
// everywhere: axes, tooltips, banners and stats all speak ¢.
export function priceAxis(): uPlot.Axis {
  return {
    stroke: AXIS_STROKE,
    grid: { stroke: GRID_STROKE, width: 1 },
    ticks: { stroke: GRID_STROKE },
    values: (_u, vals) => vals.map((v) => Math.round(v * 100) + "¢"),
  };
}

export function timeAxis(): uPlot.Axis {
  return { stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE, width: 1 }, ticks: { stroke: GRID_STROKE } };
}

// Positions a .u-tooltip div (styled in index.css) that follows the cursor.
// The HTML comes from the caller; interpolate only trusted, non-user strings.
export function tooltipPlugin(getHTML: (u: uPlot, idx: number) => string): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "u-tooltip";
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
        if (!tip) return;
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0) {
          tip.classList.remove("is-on");
          return;
        }
        const html = getHTML(u, idx);
        if (!html) {
          tip.classList.remove("is-on");
          return;
        }
        tip.innerHTML = html;
        tip.classList.add("is-on");
        const ow = u.over.clientWidth;
        let x = left + 14;
        if (x + tip.offsetWidth > ow) x = left - tip.offsetWidth - 14;
        tip.style.left = Math.max(0, x) + "px";
        tip.style.top = Math.max(0, (top ?? 0) - 8) + "px";
      },
    },
  };
}

export function observeResize(u: uPlot, el: HTMLElement, height: number): ResizeObserver {
  const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
  ro.observe(el);
  return ro;
}
