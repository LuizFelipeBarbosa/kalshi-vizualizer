// Lifetime stats derived client-side from a contract's downsampled price series.
// Prices are Kalshi cents (1–99); "pp" deltas are percentage points.

import type { PricePoint } from "../api/types";

export interface LifeStats {
  high: { price: number; t: number };
  low: { price: number; t: number };
  rangePp: number;
  vwap: number | null; // volume-weighted average price; null when no volume
  lifeDeltaPp: number; // last bucket price minus first, signed
}

export function computeLifeStats(points: PricePoint[]): LifeStats | null {
  if (points.length === 0) return null;
  let high = points[0];
  let low = points[0];
  let pv = 0;
  let v = 0;
  for (const p of points) {
    if (p.price > high.price) high = p;
    if (p.price < low.price) low = p;
    pv += p.price * p.volume;
    v += p.volume;
  }
  return {
    high: { price: high.price, t: high.t },
    low: { price: low.price, t: low.t },
    rangePp: Math.round(high.price) - Math.round(low.price),
    vwap: v > 0 ? pv / v : null,
    lifeDeltaPp: Math.round(points[points.length - 1].price) - Math.round(points[0].price),
  };
}
