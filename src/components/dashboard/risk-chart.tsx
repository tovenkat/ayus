"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, LabelList, Tooltip,
} from "recharts";
import { Activity, Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { RiskSummary, RiskLevel } from "@/lib/risk-assessment";

type Props = { summary: RiskSummary };

const LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "SUPER"];

const STYLE: Record<RiskLevel, { label: string; fill: string; border: string; text: string; bg: string }> = {
  LOW:    { label: "Low",    fill: "#10b981", border: "border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  MEDIUM: { label: "Medium", fill: "#f59e0b", border: "border-amber-500/40",    text: "text-amber-700 dark:text-amber-400",    bg: "bg-amber-500/10" },
  HIGH:   { label: "High",   fill: "#ef4444", border: "border-destructive/40",  text: "text-destructive",                       bg: "bg-destructive/10" },
  SUPER:  { label: "Super",  fill: "#7f1d1d", border: "border-destructive",      text: "text-destructive",                       bg: "bg-destructive/20" },
};

export function RiskChart({ summary }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (summary.totalBiomarkers === 0) return null;

  const chartData = LEVELS.map((level) => ({
    level,
    label: STYLE[level].label,
    count: summary.counts[level],
  }));

  const overallStyle = STYLE[summary.overall];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <CardTitle className="text-base">Risk assessment</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {summary.totalBiomarkers} biomarker{summary.totalBiomarkers === 1 ? "" : "s"}
            </Badge>
          </div>
          <div className={`rounded-md border px-3 py-1 flex items-center gap-2 ${overallStyle.border} ${overallStyle.bg}`}>
            <span className={`text-[10px] uppercase tracking-wider font-semibold ${overallStyle.text}`}>
              Overall
            </span>
            <span className={`text-sm font-bold ${overallStyle.text}`}>{overallStyle.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [`${v} biomarker${Number(v) === 1 ? "" : "s"}`, "Count"] as [string, string]}
                labelFormatter={(l) => `${l} risk`}
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.level} fill={STYLE[entry.level].fill} />
                ))}
                <LabelList dataKey="count" position="top" fontSize={11} fill="var(--muted-foreground)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Summary + recovery timeframe */}
        <div className={`rounded-md border p-3 ${overallStyle.border} ${overallStyle.bg}`}>
          <p className="text-sm font-medium">{summary.overallRationale}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2">
            <Clock className="size-3.5" />
            <span className="font-medium text-foreground">Recovery timeframe:</span>
            <span>{summary.recoveryTimeframe}</span>
          </div>
        </div>

        {/* Per-biomarker breakdown (collapsible) */}
        {summary.breakdown.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBreakdown((v) => !v)}
              className="w-full justify-between"
            >
              <span>Per-biomarker breakdown ({summary.breakdown.length})</span>
              {showBreakdown ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>

            {showBreakdown && (
              <div className="divide-y rounded-md border">
                {summary.breakdown.map((b) => {
                  const s = STYLE[b.level];
                  return (
                    <div key={b.name} className="px-3 py-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`size-2 rounded-full shrink-0`} style={{ background: s.fill }} />
                        <span className="text-sm font-medium truncate">{b.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {b.value} {b.unit ?? ""}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${s.border} ${s.text}`}
                      >
                        {s.label}
                      </Badge>
                      <p className="text-xs text-muted-foreground col-span-2">
                        {b.rationale}
                      </p>
                      <p className="text-[11px] italic col-span-2 flex items-center gap-1">
                        <Clock className="size-3 opacity-50" />
                        <span className="text-muted-foreground">{b.recoveryEstimate}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground pt-2 border-t">
          Recovery estimates are typical clinical expectations, not medical advice. Always follow your doctor's plan.
        </p>
      </CardContent>
    </Card>
  );
}
