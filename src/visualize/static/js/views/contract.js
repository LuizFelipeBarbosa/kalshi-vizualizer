// Contract view — the individual price line over the contract's lifetime + a synced volume
// strip, plus a metadata grid. Price is cents (1-99) rendered on a 0-100% probability axis.

import { getContract } from "../api.js";
import { contractPriceVolume } from "../charts.js";
import { fmtInt, fmtCompact, fmtPct, fmtDate, escapeHtml, liftAccent } from "../format.js";

export async function mount(main, { ticker }) {
  const data = await getContract(ticker);
  const accent = liftAccent(data.color || "#9aa3b2");
  const backHref = data.event_ticker ? "#/event/" + encodeURIComponent(data.event_ticker) : "#/";

  main.innerHTML = `
    <div class="view-head">
      <a class="backlink" href="${backHref}">‹ back to event</a>
      <div class="title">${escapeHtml(data.title || data.ticker)} ${statusChip(data)}</div>
      <div class="substat">
        ${data.group ? `<span class="chip" style="color:${accent};border-color:${accent}">${escapeHtml(
    data.group
  )}</span> &nbsp;` : ""}
        <span class="num">${escapeHtml(data.ticker)}</span>
      </div>
    </div>
    <div class="chart-frame">
      <div id="price"></div>
      <div class="vol" id="vol"></div>
    </div>
    <div class="section">
      <div class="section-head"><p class="eyebrow">Details</p></div>
      <div class="meta-grid">
        ${meta("Status", data.status || "—")}
        ${meta("Result", data.result ? data.result.toUpperCase() : "—")}
        ${meta("Last price", data.last_yes_price != null ? fmtPct(data.last_yes_price) : "—")}
        ${meta("Volume", fmtCompact(data.traded_volume))}
        ${meta("Trades", fmtInt(data.n_trades))}
        ${meta("First trade", fmtDate(data.first_trade))}
        ${meta("Last trade", fmtDate(data.last_trade))}
        ${meta("Opened", fmtDate(data.open_time))}
        ${meta("Closed", fmtDate(data.close_time))}
      </div>
    </div>
  `;

  const chart = contractPriceVolume(
    main.querySelector("#price"),
    main.querySelector("#vol"),
    data,
    data.color
  );

  return {
    destroy() {
      chart.destroy();
    },
  };
}

function statusChip(data) {
  if (data.status === "finalized" && data.result) {
    const cls = data.result === "yes" ? "yes" : "no";
    return `<span class="chip ${cls}">settled · ${escapeHtml(data.result)}</span>`;
  }
  return `<span class="chip">${escapeHtml(data.status || "")}</span>`;
}

function meta(label, value) {
  return `<div><div class="m-label">${label}</div><div class="m-value">${value}</div></div>`;
}
