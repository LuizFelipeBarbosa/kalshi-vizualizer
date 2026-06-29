// uPlot chart factories. Two shapes:
//   eventOverlay()        — every contract's price line over the event lifetime, one canvas.
//   contractPriceVolume() — one contract's price line + a cursor-synced volume strip.
// The dashed 50% "conviction rail" is drawn through every chart as the structural spine.

import { fmtDateTime, fmtCompact, liftAccent, fade, escapeHtml } from "./format.js";

const uPlot = window.uPlot;

const AXIS_STROKE = "#5c6575";
const GRID_STROKE = "#232938";
const RAIL_COLOR = "#3a4358";

// Distinct hues for overlaying many contracts of the SAME group (which share one color).
const OVERLAY_PALETTE = [
  "#5b8ff9", "#61ddaa", "#65789b", "#f6bd16", "#7262fd",
  "#78d3f8", "#9661bc", "#f6903d", "#008685", "#f08bb4",
  "#e8684a", "#6dc8ec",
];

function drawRail(u) {
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

function pctAxis() {
  return {
    stroke: AXIS_STROKE,
    grid: { stroke: GRID_STROKE, width: 1 },
    ticks: { stroke: GRID_STROKE },
    values: (u, vals) => vals.map((v) => Math.round(v * 100) + "%"),
  };
}

function timeAxis() {
  return { stroke: AXIS_STROKE, grid: { stroke: GRID_STROKE, width: 1 }, ticks: { stroke: GRID_STROKE } };
}

function tooltipPlugin(getHTML) {
  let tip;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "u-tooltip";
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
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
        tip.style.top = Math.max(0, (top || 0) - 8) + "px";
      },
    },
  };
}

function observeResize(u, el, height) {
  const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
  ro.observe(el);
  return ro;
}

// --- Event overlay: one line per contract, distinct colors, shared cursor. ---------------
export function eventOverlay(el, data) {
  const series = (data.series || []).filter((s) => s.points && s.points.length);
  if (!series.length) {
    el.innerHTML = '<div class="empty">No price history for this event.</div>';
    return { destroy() {} };
  }

  // Unified x axis = sorted union of every series' sample timestamps.
  const tset = new Set();
  for (const s of series) for (const p of s.points) tset.add(p.t);
  const xs = Array.from(tset).sort((a, b) => a - b);
  const xi = new Map(xs.map((t, i) => [t, i]));

  const cols = series.map((s) => {
    const arr = new Array(xs.length).fill(null);
    for (const p of s.points) arr[xi.get(p.t)] = p.price / 100;
    return arr;
  });

  const labels = series.map((s, i) => ({
    ticker: s.ticker,
    title: s.title || s.ticker,
    color: OVERLAY_PALETTE[i % OVERLAY_PALETTE.length],
  }));

  const uSeries = [
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
    const lines = [];
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

  const opts = {
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
  };

  const u = new uPlot(opts, [xs, ...cols], el);
  const ro = observeResize(u, el, 360);

  const tickerToIdx = new Map(labels.map((m, i) => [m.ticker, i + 1]));
  return {
    labels,
    focusSeries(ticker) {
      const i = tickerToIdx.get(ticker);
      u.setSeries(i == null ? null : i, { focus: true });
    },
    destroy() {
      ro.disconnect();
      u.destroy();
    },
  };
}

// --- Contract: price line + a cursor-synced volume strip. --------------------------------
export function contractPriceVolume(priceEl, volEl, data, accentHex) {
  const points = data.points || [];
  if (!points.length) {
    priceEl.innerHTML = '<div class="empty">No trades recorded for this contract.</div>';
    return { destroy() {} };
  }
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.price / 100);
  const vol = points.map((p) => p.volume);
  const stroke = liftAccent(accentHex || "#9aa3b2");
  const syncKey = "c-" + (data.ticker || "x");

  const priceTip = tooltipPlugin((u, idx) => {
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
      scales: { x: { time: true }, y: { range: (u, _min, max) => [0, max || 1] } },
      axes: [
        { show: false },
        {
          stroke: AXIS_STROKE,
          size: 44,
          grid: { stroke: GRID_STROKE, width: 1 },
          ticks: { stroke: GRID_STROKE },
          values: (u, vals) => vals.map((v) => fmtCompact(v)),
        },
      ],
      legend: { show: false },
      cursor: { sync: { key: syncKey } },
      series: [
        {},
        { label: "vol", stroke: "#3a4358", fill: "#2a3142", width: 0, paths: uPlot.paths.bars({ size: [0.7, 8] }) },
      ],
    },
    [xs, vol],
    volEl
  );

  const roP = observeResize(priceU, priceEl, 320);
  const roV = observeResize(volU, volEl, 90);

  return {
    destroy() {
      roP.disconnect();
      roV.disconnect();
      priceU.destroy();
      volU.destroy();
    },
  };
}
