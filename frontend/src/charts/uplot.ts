// Shared uPlot config pieces, ported from the vanilla static/js/charts.js.
// The dashed 50% "conviction rail" drawn through every chart is the structural spine.

import uPlot from "uplot";

export const AXIS_STROKE = "#5c6575";
export const GRID_STROKE = "#232938";
const RAIL_COLOR = "#3a4358";

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

export function pctAxis(): uPlot.Axis {
  return {
    stroke: AXIS_STROKE,
    grid: { stroke: GRID_STROKE, width: 1 },
    ticks: { stroke: GRID_STROKE },
    values: (_u, vals) => vals.map((v) => Math.round(v * 100) + "%"),
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
