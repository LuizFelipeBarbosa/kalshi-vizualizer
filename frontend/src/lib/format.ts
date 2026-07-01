// Formatting + color helpers, ported from the vanilla static/js/format.js.
// Numbers are tabular-mono in the UI; these keep them terse.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

// Compact magnitude (e.g. 18.3B, 1.2M, 3.4K). Used for volume/contract counts.
export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtPct(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return Math.round(cents) + "%";
}

function toDate(epochSec: number): Date {
  return new Date(epochSec * 1000);
}

export function fmtDate(epochSec: number | null | undefined): string {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateShort(epochSec: number | null | undefined): string {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;
}

export function fmtDateTime(epochSec: number | null | undefined): string {
  if (epochSec == null) return "—";
  const d = toDate(epochSec);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)} · ${hh}:${mm}`;
}

export function fmtRange(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "";
  return `${fmtDateShort(a)} – ${fmtDateShort(b)}`;
}

// Mix a hex color toward white to keep matplotlib tab10 accents legible on the dark ground.
export function liftAccent(hex: string, amount = 0.18): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const m = (v: number) => Math.round(v + (255 - v) * amount);
  return rgbToHex(m(c.r), m(c.g), m(c.b));
}

// A faint translucent fill from a hex, for the area under the price line.
export function fade(hex: string, alpha = 0.08): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "");
  if (m.length !== 6) return null;
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Only for HTML assembled as strings (the uPlot tooltip plugin); JSX escapes itself.
export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
