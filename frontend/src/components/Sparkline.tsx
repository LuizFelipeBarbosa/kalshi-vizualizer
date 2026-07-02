// Tiny inline SVG price sparkline — decoration, not a chart. SVG instead of uPlot
// because there are no axes/cursor and up to 40 render per event page; a canvas +
// ResizeObserver per row would be pure churn. Fixed 0–100¢ y-domain so shapes are
// comparable across contracts; preserveAspectRatio="none" makes CSS sizing free.

import { useMemo } from "react";

import type { SparkPoint } from "../api/types";

const INSET = 2; // px in viewBox units, so 1¢/99¢ lines aren't clipped

export default function Sparkline({
  points,
  stroke,
  width = 120,
  height = 32,
  endDot = false,
  className,
}: {
  points: readonly SparkPoint[];
  stroke: string;
  width?: number;
  height?: number;
  endDot?: boolean;
  className?: string;
}) {
  const coords = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].t;
    const span = points[points.length - 1].t - t0 || 1;
    const usable = height - 2 * INSET;
    const xy = points.map((p) => [((p.t - t0) / span) * width, INSET + usable - (p.price / 100) * usable] as const);
    return { line: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), last: xy[xy.length - 1] };
  }, [points, width, height]);

  if (!coords) return null;

  return (
    // overflow-visible: the final point sits ON the right edge, so half of the end
    // dot would otherwise be clipped by the viewport.
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      overflow="visible"
    >
      <polyline
        points={coords.line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {endDot && (
        // A zero-length round-capped stroke with non-scaling-stroke renders a true
        // screen-space circle; a <circle r> would be squashed into an ellipse by
        // preserveAspectRatio="none".
        <path
          d={`M ${coords.last[0]} ${coords.last[1]} l 0.0001 0`}
          fill="none"
          stroke={stroke}
          strokeWidth={5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
