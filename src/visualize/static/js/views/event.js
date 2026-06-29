// Event view — the event header, an overlaid multi-line price chart of every contract's
// trajectory, and the contract list. Hovering a contract row highlights its overlay line.

import { getEvent } from "../api.js";
import { navigate } from "../state.js";
import { eventOverlay } from "../charts.js";
import { fmtInt, fmtCompact, fmtRange, fmtPct, escapeHtml, liftAccent } from "../format.js";

export async function mount(main, { ticker }) {
  const data = await getEvent(ticker);
  const accent = liftAccent(data.color || "#9aa3b2");

  main.innerHTML = `
    <div class="view-head">
      <a class="backlink" href="#/">‹ all events</a>
      <div class="title">${escapeHtml(data.title || data.event_ticker)}</div>
      <div class="substat">
        <span class="chip" style="color:${accent};border-color:${accent}">${escapeHtml(data.group || "")}</span>
        &nbsp; ${fmtInt(data.n_contracts)} contracts · ${fmtCompact(data.total_volume)} vol ·
        ${fmtRange(data.first_trade, data.last_trade)}
      </div>
    </div>
    <div class="chart-frame"><div id="overlay"></div><div class="legend-line" id="legend"></div></div>
    <div class="section">
      <div class="section-head"><p class="eyebrow">Contracts</p></div>
      <div class="rows" id="rows"></div>
    </div>
  `;

  const overlay = eventOverlay(main.querySelector("#overlay"), data);

  // legend mapping each colored line to its contract title
  if (overlay.labels && overlay.labels.length) {
    main.querySelector("#legend").innerHTML = overlay.labels
      .map(
        (l) =>
          `<span class="li"><span class="dot" style="background:${l.color}"></span>${escapeHtml(l.title)}</span>`
      )
      .join("");
  }

  const rowsEl = main.querySelector("#rows");
  rowsEl.innerHTML = data.contracts
    .map(
      (c) => `
      <div class="row" data-tk="${escapeHtml(c.ticker)}">
        <span class="r-title">${escapeHtml(c.title || c.ticker)}</span>
        <span class="r-tag">${statusLabel(c)}</span>
        <span class="r-num">${c.last_yes_price != null ? fmtPct(c.last_yes_price) : "—"}</span>
        <span class="r-num strong">${fmtCompact(c.traded_volume)}</span>
        <span class="r-arrow">→</span>
      </div>`
    )
    .join("");

  rowsEl.querySelectorAll(".row").forEach((row) => {
    const tk = row.dataset.tk;
    row.addEventListener("click", () => navigate("/contract/" + tk));
    row.addEventListener("mouseenter", () => overlay.focusSeries(tk));
    row.addEventListener("mouseleave", () => overlay.focusSeries(null));
  });

  return {
    destroy() {
      overlay.destroy();
    },
  };
}

function statusLabel(c) {
  if (c.status === "finalized" && c.result) return "settled " + c.result;
  return c.status || "";
}
