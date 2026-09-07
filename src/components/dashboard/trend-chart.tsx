"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from "recharts";

export interface TrendChartPoint {
  date: string;
  value: number;
  isOutOfRange: boolean;
}

interface TrendChartProps {
  data: TrendChartPoint[];
  referenceLow?: number | null;
  referenceHigh?: number | null;
  unit?: string | null;
  height?: number;
  showXAxis?: boolean;
  showYAxis?: boolean;
  interactive?: boolean;
  /** Compact mode for dashboard cards — smaller dots, thinner line */
  compact?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function CustomDot(props: Record<string, unknown>) {
  const { cx, cy, payload, compact } = props as {
    cx: number;
    cy: number;
    payload: TrendChartPoint;
    compact?: boolean;
  };
  if (cx == null || cy == null) return null;
  const color = payload?.isOutOfRange
    ? "hsl(var(--destructive))"
    : "hsl(215 80% 48%)";
  const r = compact ? 3 : 4;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={color}
      stroke="white"
      strokeWidth={1.5}
    />
  );
}

function CustomTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value: number; payload: TrendChartPoint }[];
  label?: string;
  unit?: string | null;
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0];
  const isOut = point.payload.isOutOfRange;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {new Date(String(label)).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      <p className={`text-sm font-semibold ${isOut ? "text-destructive" : ""}`}>
        {point.value}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

export function TrendChart({
  data,
  referenceLow,
  referenceHigh,
  unit,
  height = 150,
  showXAxis = false,
  showYAxis = false,
  interactive = false,
  compact = false,
}: TrendChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-xs"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  // Compute Y domain that includes reference bounds
  const values = data.map((d) => d.value);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (referenceLow != null) yMin = Math.min(yMin, referenceLow);
  if (referenceHigh != null) yMax = Math.max(yMax, referenceHigh);
  const padding = (yMax - yMin) * 0.15 || 1;
  yMin -= padding;
  yMax += padding;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{
          top: 5,
          right: 5,
          bottom: 5,
          left: showYAxis ? 5 : 0,
        }}
      >
        <defs>
          <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(215 80% 48%)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="hsl(215 80% 48%)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          opacity={0.15}
          vertical={false}
        />

        {(referenceLow != null || referenceHigh != null) && (
          <ReferenceArea
            y1={referenceLow ?? yMin}
            y2={referenceHigh ?? yMax}
            fill="hsl(150 60% 45%)"
            fillOpacity={0.06}
            ifOverflow="extendDomain"
          />
        )}

        {referenceLow != null && (
          <ReferenceLine
            y={referenceLow}
            stroke="hsl(150 60% 45%)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
        )}
        {referenceHigh != null && (
          <ReferenceLine
            y={referenceHigh}
            stroke="hsl(150 60% 45%)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
        )}

        <XAxis
          dataKey="date"
          hide={!showXAxis}
          tickFormatter={formatDate}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          hide={!showYAxis}
          domain={[yMin, yMax]}
          tick={{ fontSize: 11 }}
          width={45}
          tickFormatter={(v: number) => Number(v.toPrecision(3)).toString()}
          axisLine={false}
          tickLine={false}
        />

        {interactive && (
          <Tooltip
            content={<CustomTooltip unit={unit} />}
            cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "4 4" }}
          />
        )}

        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          strokeWidth={compact ? 1.5 : 2.5}
          fill="url(#lineGradient)"
          dot={(props: Record<string, unknown>) => (
            <CustomDot key={`dot-${props.index}`} {...props} compact={compact} />
          )}
          activeDot={
            interactive
              ? { r: 6, stroke: "hsl(var(--primary))", strokeWidth: 2, fill: "white" }
              : false
          }
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
