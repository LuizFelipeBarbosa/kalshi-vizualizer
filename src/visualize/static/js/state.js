// Hash-as-state. The route is the *path* part of the hash (`/`, `/event/x`, `/contract/x`);
// the overview's filter state lives in the *query* part (`?group=&q=&sort=&page=`). Query
// updates use replaceState so they don't spam history or trigger a route re-mount, yet the
// URL stays shareable and survives reload.

export function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const qi = raw.indexOf("?");
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const query = {};
  if (qi !== -1) {
    for (const [k, v] of new URLSearchParams(raw.slice(qi + 1))) query[k] = v;
  }
  return { path: path || "/", query };
}

export function buildHash(path, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && v !== "" && !(k === "page" && Number(v) === 1)) params.set(k, v);
  }
  const qs = params.toString();
  return "#" + path + (qs ? "?" + qs : "");
}

// Update the query part of the current route without re-mounting (no hashchange fired).
export function setQuery(query) {
  const { path } = parseHash();
  history.replaceState(null, "", buildHash(path, query));
}

export function navigate(path, query) {
  location.hash = buildHash(path, query || {});
}
