"use client";

type Props = {
  points: { date: string; value: number }[];
  referenceLow: number | null;
  referenceHigh: number | null;
  width?: number;
  height?: number;
  trendWorse?: boolean;
};

/**
 * Compact inline SVG sparkline — print-friendly (no JS chart library).
 * Shows the reference-range band lightly and highlights each point.
 */
export function Sparkline({
  points,
  referenceLow,
  referenceHigh,
  width = 110,
  height = 28,
  trendWorse = false,
}: Props) {
  if (points.length < 2) {
    return (
      <span className="text-[10px] text-muted-foreground inline-block" style={{ width, height, lineHeight: `${height}px` }}>
        {points.length === 1 ? "1 reading" : "—"}
      </span>
    );
  }

  const values = points.map((p) => p.value);
  const minV = Math.min(...values, referenceLow ?? Infinity);
  const maxV = Math.max(...values, referenceHigh ?? -Infinity);
  const range = maxV - minV || 1;
  const padY = 3;
  const innerH = height - padY * 2;

  const y = (v: number) => padY + innerH - ((v - minV) / range) * innerH;
  const x = (i: number) => (i / (points.length - 1)) * (width - 2) + 1;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${path} L${x(points.length - 1).toFixed(1)} ${height - padY} L${x(0).toFixed(1)} ${height - padY} Z`;

  const lineColor = trendWorse ? "var(--destructive)" : "currentColor";
  const areaColor = trendWorse ? "var(--destructive)" : "currentColor";

  // Reference band overlay
  const bandY1 = referenceHigh !== null ? y(referenceHigh) : null;
  const bandY2 = referenceLow !== null ? y(referenceLow) : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={trendWorse ? "text-destructive" : "text-primary"}
      aria-hidden="true"
    >
      {bandY1 !== null && bandY2 !== null && (
        <rect
          x={0}
          y={Math.min(bandY1, bandY2)}
          width={width}
          height={Math.abs(bandY2 - bandY1)}
          fill="currentColor"
          fillOpacity={0.08}
        />
      )}
      <path d={areaPath} fill={areaColor} fillOpacity={0.1} />
      <path d={path} fill="none" stroke={lineColor} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
      {/* Last point dot */}
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1].value)}
        r={2}
        fill={lineColor}
      />
    </svg>
  );
}
