"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type { StatusTimelinePoint } from "@/lib/dashboard-queries";

const STACKED = [
  { key: "worsening", label: "Worsening", color: "#f59e0b" },
  { key: "improving", label: "Improving", color: "#10b981" },
  { key: "stable", label: "Stable", color: "#3b82f6" },
] as const;

const OUT_OF_RANGE = { key: "outOfRange", label: "Out of Range", color: "#ef4444" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  const trendItems = payload.filter((p) => p.dataKey !== "outOfRange");
  const oorItem = payload.find((p) => p.dataKey === "outOfRange");
  const trendTotal = trendItems.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md min-w-40">
      <p className="text-xs text-muted-foreground mb-2">
        {formatDateFull(String(label))}
      </p>
      {trendItems.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.name}
          </span>
          <span className="font-medium tabular-nums">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 border-t pt-1 flex justify-between text-xs text-muted-foreground">
        <span>Total tests</span>
        <span className="font-medium">{trendTotal}</span>
      </div>
      {oorItem && (
        <div className="mt-1.5 border-t pt-1.5 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: OUT_OF_RANGE.color }}
            />
            {oorItem.name}
          </span>
          <span className="font-medium tabular-nums text-red-500">{oorItem.value}</span>
        </div>
      )}
    </div>
  );
}

interface StatusAreaChartProps {
  data: StatusTimelinePoint[];
}

export function StatusAreaChart({ data }: StatusAreaChartProps) {
  if (data.length < 2) return null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-5 pt-4 pb-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Health Status Timeline
          </p>
        </div>
        <div className="px-2 pb-4">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
            >
              <defs>
                {STACKED.map((s) => (
                  <linearGradient
                    key={s.key}
                    id={`grad-${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.03} />
                  </linearGradient>
                ))}
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.1}
                vertical={false}
              />

              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                width={32}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: "hsl(var(--primary))",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
              />

              <Legend
                verticalAlign="bottom"
                height={32}
                iconType="circle"
                iconSize={7}
                formatter={(value: string) => (
                  <span className="text-[11px] text-muted-foreground">{value}</span>
                )}
              />

              {STACKED.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stackId="trend"
                  stroke={s.color}
                  strokeWidth={1.5}
                  fill={`url(#grad-${s.key})`}
                  activeDot={{
                    r: 4,
                    stroke: s.color,
                    strokeWidth: 2,
                    fill: "white",
                  }}
                  isAnimationActive={false}
                />
              ))}

              <Line
                type="monotone"
                dataKey={OUT_OF_RANGE.key}
                name={OUT_OF_RANGE.label}
                stroke={OUT_OF_RANGE.color}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{
                  r: 3,
                  fill: OUT_OF_RANGE.color,
                  stroke: "white",
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 5,
                  stroke: OUT_OF_RANGE.color,
                  strokeWidth: 2,
                  fill: "white",
                }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
