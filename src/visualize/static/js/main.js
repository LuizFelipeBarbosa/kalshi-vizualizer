// App bootstrap: fill the top-bar date range from the summary, then start the router.

import { getSummary } from "./api.js";
import { fmtRange } from "./format.js";
import { startRouter } from "./router.js";

async function boot() {
  try {
    const summary = await getSummary();
    const rangeEl = document.querySelector("#range");
    if (rangeEl) rangeEl.textContent = fmtRange(summary.first_trade, summary.last_trade);
  } catch (_) {
    /* range is decorative; ignore */
  }
  startRouter();
}

boot();
