// Thin fetch wrappers over the JSON API, with a small LRU cache and abortable search.

const _cache = new Map(); // key -> body; insertion-ordered, capped
const _CAP = 24;

async function getJSON(url, signal) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function cached(key, body) {
  _cache.set(key, body);
  if (_cache.size > _CAP) _cache.delete(_cache.keys().next().value);
  return body;
}

export async function getSummary() {
  if (_cache.has("summary")) return _cache.get("summary");
  return cached("summary", await getJSON("/api/summary"));
}

export async function getEvents({ group, q, sort, page }, signal) {
  const params = new URLSearchParams();
  if (group) params.set("group", group);
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  if (page) params.set("page", String(page));
  const url = "/api/events?" + params.toString();
  if (_cache.has(url)) return _cache.get(url);
  const body = await getJSON(url, signal);
  return cached(url, body);
}

export async function getEvent(eventTicker) {
  const url = "/api/event/" + encodeURIComponent(eventTicker);
  if (_cache.has(url)) return _cache.get(url);
  return cached(url, await getJSON(url));
}

export async function getContract(ticker) {
  const url = "/api/contract/" + encodeURIComponent(ticker);
  if (_cache.has(url)) return _cache.get(url);
  return cached(url, await getJSON(url));
}
