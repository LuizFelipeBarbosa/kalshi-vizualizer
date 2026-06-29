// Hash router. Only the PATH part of the hash drives mounting; query-only changes (the
// overview's filters) are handled by the view itself, so they never re-mount. Each view's
// mount() returns a controller with destroy() so uPlot instances are torn down on nav.

import { parseHash } from "./state.js";
import * as overview from "./views/overview.js";
import * as event from "./views/event.js";
import * as contract from "./views/contract.js";

const routes = [
  {
    re: /^\/event\/(.+)$/,
    mount: (m, mt) => event.mount(m, { ticker: decodeURIComponent(mt[1]) }),
    crumb: (mt) => decodeURIComponent(mt[1]),
  },
  {
    re: /^\/contract\/(.+)$/,
    mount: (m, mt) => contract.mount(m, { ticker: decodeURIComponent(mt[1]) }),
    crumb: (mt) => decodeURIComponent(mt[1]),
  },
  {
    re: /^\/?$/,
    mount: (m, mt, q) => overview.mount(m, { query: q }),
    crumb: () => null,
  },
];

let current = null; // mounted controller
let currentPath = null;

function mainEl() {
  return document.querySelector("#app-main");
}

function renderCrumbs(label) {
  const el = document.querySelector("#crumbs");
  if (!el) return;
  el.innerHTML = label
    ? `<a href="#/">Events</a><span class="sep">›</span><span>${label}</span>`
    : "";
}

async function resolve() {
  const { path, query } = parseHash();
  if (path === currentPath && current) return; // query-only change; the view owns it

  const route = routes.find((r) => r.re.test(path)) || routes[routes.length - 1];
  const mt = path.match(route.re) || [];

  if (current && current.destroy) {
    try {
      current.destroy();
    } catch (_) {
      /* ignore teardown errors */
    }
    current = null;
  }

  const main = mainEl();
  main.classList.add("is-fading");
  currentPath = path;
  renderCrumbs(route.crumb(mt));
  window.scrollTo(0, 0);

  try {
    current = await route.mount(main, mt, query);
  } catch (err) {
    main.innerHTML = `<div class="empty">Couldn't load this view.<br>${String(err)}</div>`;
    current = null;
  } finally {
    main.classList.remove("is-fading");
  }
}

export function startRouter() {
  window.addEventListener("hashchange", resolve);
  resolve();
}
