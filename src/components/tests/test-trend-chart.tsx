"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, CartesianGrid,
} from "recharts";

type Point = {
  date: string; // YYYY-MM-DD
  value: number;
};

type Props = {
  points: Point[];
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
};

export function TestTrendChart({ points, unit, referenceLow, referenceHigh }: Props) {
  if (points.length === 0) return null;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  // Y-axis domain: include reference range + 10% padding
  const values = sorted.map((p) => p.value);
  const low = referenceLow ?? Math.min(...values);
  const high = referenceHigh ?? Math.max(...values);
  const pad = Math.max(0.1, (high - low) * 0.15);
  const yMin = Math.min(low, ...values) - pad;
  const yMax = Math.max(high, ...values) + pad;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sorted} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
          {referenceLow !== null && referenceHigh !== null && (
            <ReferenceArea
              y1={referenceLow}
              y2={referenceHigh}
              fill="var(--primary)"
              fillOpacity={0.06}
              stroke="var(--primary)"
              strokeOpacity={0.15}
              strokeDasharray="3 3"
            />
          )}
          <XAxis
            dataKey="date"
            tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            width={50}
            tickFormatter={(v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(1))}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(d) => new Date(d as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            formatter={(v) => [`${v} ${unit ?? ""}`, "Reading"] as [string, string]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--primary)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
