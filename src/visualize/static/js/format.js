// Formatting + color helpers. Numbers are tabular-mono in the UI; these keep them terse.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtInt(n) {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

// Compact magnitude (e.g. 18.3B, 1.2M, 3.4K). Used for volume/contract counts.
export function fmtCompact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtPct(cents) {
  if (cents == null) return "—";
  return Math.round(cents) + "%";
}

function toDate(epochSec) {
  return new Date(epochSec * 1000);
}

export function fmtDate(epochSec) {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateShort(epochSec) {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;
}

export function fmtDateTime(epochSec) {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)} · ${hh}:${mm}`;
}

export function fmtRange(a, b) {
  if (a == null || b == null) return "";
  return `${fmtDateShort(a)} – ${fmtDateShort(b)}`;
}

// Mix a hex color toward white to keep matplotlib tab10 accents legible on the dark ground.
export function liftAccent(hex, amount = 0.18) {
  const c = parseHex(hex);
  if (!c) return hex;
  const m = (v) => Math.round(v + (255 - v) * amount);
  return rgbToHex(m(c.r), m(c.g), m(c.b));
}

// A faint translucent fill from a hex, for the area under the price line.
export function fade(hex, alpha = 0.08) {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function parseHex(hex) {
  if (typeof hex !== "string") return null;
  const m = hex.replace("#", "");
  if (m.length !== 6) return null;
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
