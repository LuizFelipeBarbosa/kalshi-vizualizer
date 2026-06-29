// Overview — the main page: global stats, color-coded category groups, and a server-side
// searchable + paginated index of every event. The client only ever holds one page.

import { getSummary, getEvents } from "../api.js";
import { setQuery, navigate } from "../state.js";
import { fmtInt, fmtCompact, escapeHtml, liftAccent } from "../format.js";

const SORTS = [
  ["volume", "volume"],
  ["recent", "most recent"],
  ["contracts", "# contracts"],
  ["ticker", "ticker"],
];

export async function mount(main, { query }) {
  const state = {
    group: query.group || "",
    q: query.q || "",
    sort: query.sort || "volume",
    page: Number(query.page) || 1,
  };

  const summary = await getSummary();
  const colorByGroup = new Map(summary.groups.map((g) => [g.group, g.color]));

  main.innerHTML = `
    <p class="eyebrow">Prediction archive</p>
    <div class="hero">
      ${stat(fmtInt(summary.n_events), "Events")}
      ${stat(fmtInt(summary.n_contracts), "Contracts")}
      ${stat(fmtCompact(summary.total_volume), "Volume")}
      ${stat(fmtCompact(summary.n_trades), "Trades")}
    </div>

    <div class="section">
      <div class="section-head"><p class="eyebrow">Category groups</p></div>
      <div class="group-grid" id="groups"></div>
    </div>

    <div class="section">
      <div class="section-head">
        <p class="eyebrow">Event index</p><span class="spacer"></span>
        <div class="sort"><select id="sort">${SORTS.map(
          ([v, l]) => `<option value="${v}">${l}</option>`
        ).join("")}</select></div>
      </div>
      <div class="controls" id="controls">
        <label class="search" id="search">
          <input type="text" id="q" placeholder="Search events…" autocomplete="off" spellcheck="false" />
          <span class="progress"></span>
        </label>
      </div>
      <div class="pills" id="pills"></div>
      <div class="rows" id="rows"></div>
      <div class="pager" id="pager"></div>
    </div>
  `;

  const groupsEl = main.querySelector("#groups");
  const pillsEl = main.querySelector("#pills");
  const rowsEl = main.querySelector("#rows");
  const pagerEl = main.querySelector("#pager");
  const sortEl = main.querySelector("#sort");
  const searchEl = main.querySelector("#search");
  const qEl = main.querySelector("#q");

  // group cards
  groupsEl.innerHTML = summary.groups
    .map(
      (g) => `
      <div class="group-card" data-group="${escapeHtml(g.group)}" style="--accent:${liftAccent(g.color)}">
        <div class="g-name">${escapeHtml(g.group)}</div>
        <div class="g-meta"><span class="g-vol">${fmtCompact(g.total_volume)}</span> vol · ${fmtInt(
        g.n_events
      )} events</div>
      </div>`
    )
    .join("");
  groupsEl.querySelectorAll(".group-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.group = state.group === card.dataset.group ? "" : card.dataset.group;
      state.page = 1;
      load();
    });
  });

  // category pills
  const groups = ["", ...summary.groups.map((g) => g.group)];
  pillsEl.innerHTML = groups
    .map(
      (g) =>
        `<button class="pill" data-group="${escapeHtml(g)}">${g ? escapeHtml(g) : "All"}</button>`
    )
    .join("");
  pillsEl.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.group = pill.dataset.group;
      state.page = 1;
      load();
    });
  });

  sortEl.value = state.sort;
  sortEl.addEventListener("change", () => {
    state.sort = sortEl.value;
    state.page = 1;
    load();
  });

  qEl.value = state.q;
  let debounce;
  qEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = qEl.value.trim();
      state.page = 1;
      load();
    }, 250);
  });

  let inflight = null;

  function accent() {
    const c = colorByGroup.get(state.group);
    return c ? liftAccent(c) : "#9aa3b2";
  }

  function syncControls() {
    const a = accent();
    main.querySelector("#controls").style.setProperty("--accent", a);
    pillsEl.style.setProperty("--accent", a);
    pillsEl.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.group === state.group);
    });
  }

  async function load() {
    setQuery(state);
    syncControls();
    if (inflight) inflight.abort();
    inflight = new AbortController();
    searchEl.classList.add("is-loading");
    try {
      const data = await getEvents(state, inflight.signal);
      renderRows(data.events);
      renderPager(data);
    } catch (e) {
      if (e.name !== "AbortError") rowsEl.innerHTML = `<div class="empty">Couldn't load events.</div>`;
    } finally {
      searchEl.classList.remove("is-loading");
    }
  }

  function renderRows(events) {
    if (!events.length) {
      rowsEl.innerHTML = `<div class="empty">No events match.</div>`;
      return;
    }
    rowsEl.innerHTML = events
      .map(
        (e) => `
        <div class="row" data-ev="${escapeHtml(e.event_ticker)}" style="--accent:${e.color}">
          <span class="r-title"><span class="dot" style="background:${e.color}"></span>${escapeHtml(
          e.sample_title || e.event_ticker
        )}</span>
          <span class="r-tag">${escapeHtml(e.group || "")}</span>
          <span class="r-num">${fmtInt(e.n_contracts)} mkts</span>
          <span class="r-num strong">${fmtCompact(e.total_volume)}</span>
          <span class="r-arrow">→</span>
        </div>`
      )
      .join("");
    rowsEl.querySelectorAll(".row").forEach((row) => {
      row.addEventListener("click", () => navigate("/event/" + row.dataset.ev));
    });
  }

  function renderPager(data) {
    const { page, total_pages, total } = data;
    pagerEl.innerHTML = `
      <button id="prev" ${page <= 1 ? "disabled" : ""}>‹ prev</button>
      <span>page ${fmtInt(page)} / ${fmtInt(total_pages)}</span>
      <span class="muted">${fmtInt(total)} events</span>
      <button id="next" ${page >= total_pages ? "disabled" : ""}>next ›</button>`;
    pagerEl.querySelector("#prev").addEventListener("click", () => {
      if (state.page > 1) {
        state.page--;
        load();
        scrollToIndex();
      }
    });
    pagerEl.querySelector("#next").addEventListener("click", () => {
      if (state.page < total_pages) {
        state.page++;
        load();
        scrollToIndex();
      }
    });
  }

  function scrollToIndex() {
    main.querySelector("#rows").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  await load();

  return {
    destroy() {
      clearTimeout(debounce);
      if (inflight) inflight.abort();
    },
  };
}

function stat(value, label) {
  return `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}
