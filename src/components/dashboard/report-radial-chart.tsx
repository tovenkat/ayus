"use client";

import { PieChart, Pie, Cell, Tooltip } from "recharts";

const COLORS = {
  "Out of Range": "#ef4444",
  Improving: "#10b981",
  Worsening: "#f59e0b",
  Stable: "#3b82f6",
} as const;

interface ReportRadialChartProps {
  outOfRange: number;
  improving: number;
  worsening: number;
  stable: number;
}

function MiniTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number }[];
}) {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="rounded border bg-card px-2 py-1 shadow-sm text-xs">
      {payload[0].name}: {payload[0].value}
    </div>
  );
}

export function ReportRadialChart({
  outOfRange,
  improving,
  worsening,
  stable,
}: ReportRadialChartProps) {
  const data = [
    { name: "Out of Range", value: outOfRange },
    { name: "Improving", value: improving },
    { name: "Worsening", value: worsening },
    { name: "Stable", value: stable },
  ].filter((d) => d.value > 0);

  const total = outOfRange + improving + worsening + stable;

  if (total === 0) {
    return (
      <div className="h-10 w-10 rounded-full border-2 border-muted shrink-0" />
    );
  }

  return (
    <div className="h-10 w-10 shrink-0">
      <PieChart width={40} height={40}>
        <Pie
          data={data}
          cx={19}
          cy={19}
          innerRadius={10}
          outerRadius={18}
          paddingAngle={2}
          dataKey="value"
          isAnimationActive={false}
          stroke="none"
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name as keyof typeof COLORS]}
            />
          ))}
        </Pie>
        <Tooltip content={<MiniTooltip />} />
      </PieChart>
    </div>
  );
}
