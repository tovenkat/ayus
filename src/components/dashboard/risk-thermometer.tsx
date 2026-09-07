"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Clock, ChevronDown, ChevronUp, Thermometer } from "lucide-react";
import type { RiskSummary, RiskLevel } from "@/lib/risk-assessment";

type Props = { summary: RiskSummary };

// Zone definitions — each zone owns a vertical band of the thermometer.
// [yStart, yEnd] are percentages from the bottom of the tube (0 = bulb, 100 = top).
type Zone = {
  level: RiskLevel;
  label: string;
  range: [number, number];
  color: string;
  badgeClass: string;
  softBg: string;
};

const ZONES: Zone[] = [
  { level: "LOW",    label: "Low risk",     range: [0, 25],   color: "#10b981", badgeClass: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400", softBg: "bg-emerald-500/10" },
  { level: "MEDIUM", label: "Medium risk",  range: [25, 55],  color: "#f59e0b", badgeClass: "border-amber-500/40 text-amber-700 dark:text-amber-400",       softBg: "bg-amber-500/10" },
  { level: "HIGH",   label: "High risk",    range: [55, 85],  color: "#ef4444", badgeClass: "border-destructive/40 text-destructive",                        softBg: "bg-destructive/10" },
  { level: "SUPER",  label: "Super risk",   range: [85, 100], color: "#7f1d1d", badgeClass: "border-destructive text-destructive",                            softBg: "bg-destructive/20" },
];

const LEVEL_INDEX: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, SUPER: 3 };

/**
 * Compute the mercury fill percentage:
 * - Land inside the overall level's zone
 * - Nudge higher based on how many biomarkers cluster at or above that level
 */
function computeFill(summary: RiskSummary): number {
  const zone = ZONES[LEVEL_INDEX[summary.overall]];
  const [lo, hi] = zone.range;

  if (summary.totalBiomarkers === 0) return 0;

  // Concern ratio — biomarkers at current level or worse / total
  const concern =
    summary.overall === "LOW"
      ? summary.counts.LOW / summary.totalBiomarkers
      : (
          (summary.overall === "MEDIUM" ? summary.counts.MEDIUM : 0) +
          (summary.overall === "HIGH" ? summary.counts.HIGH + summary.counts.SUPER : 0) +
          (summary.overall === "SUPER" ? summary.counts.SUPER : 0) +
          (summary.overall === "HIGH" || summary.overall === "SUPER" ? 0 : 0)
        ) / summary.totalBiomarkers;

  // LOW fills proportionally (more normal = higher in green zone)
  if (summary.overall === "LOW") {
    return lo + (hi - lo) * Math.max(0.4, concern);
  }

  // Abnormal levels: land mid-zone, nudge toward top based on concentration
  const nudge = Math.min(0.9, 0.4 + concern * 0.5);
  return lo + (hi - lo) * nudge;
}

export function RiskThermometer({ summary }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (summary.totalBiomarkers === 0) return null;

  const fillPct = computeFill(summary);
  const overallZone = ZONES[LEVEL_INDEX[summary.overall]];

  // SVG dimensions
  const WIDTH = 140;
  const HEIGHT = 320;
  const TUBE_X = WIDTH / 2 - 14; // 28px wide
  const TUBE_WIDTH = 28;
  const TUBE_TOP = 20;
  const BULB_CY = HEIGHT - 40;
  const BULB_R = 28;
  const TUBE_BOTTOM = BULB_CY - 4;
  const TUBE_HEIGHT = TUBE_BOTTOM - TUBE_TOP;

  // Mercury fill: reaches from bulb center up to (bulb bottom of fill bar)
  // fillPct = 0 → just fills the bulb; fillPct = 100 → reaches tube top
  const mercuryTopY = TUBE_BOTTOM - (TUBE_HEIGHT * fillPct) / 100;

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
          <div className={`rounded-md border px-3 py-1 flex items-center gap-2 ${overallZone.badgeClass} ${overallZone.softBg}`}>
            <Thermometer className="size-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Overall</span>
            <span className="text-sm font-bold">{overallZone.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-6 items-start flex-wrap md:flex-nowrap md:flex-row-reverse">
          {/* Thermometer SVG (right side on desktop) */}
          <div className="shrink-0 mx-auto md:mx-0">
            <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label={`Risk thermometer at ${overallZone.label}`}>
              <defs>
                <linearGradient id="risk-gradient" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="25%" stopColor="#10b981" />
                  <stop offset="35%" stopColor="#f59e0b" />
                  <stop offset="60%" stopColor="#ef4444" />
                  <stop offset="90%" stopColor="#7f1d1d" />
                </linearGradient>
                <filter id="mercury-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Zone background bands on the tube (faint) */}
              {ZONES.map((z) => {
                const y1 = TUBE_BOTTOM - (TUBE_HEIGHT * z.range[1]) / 100;
                const h = (TUBE_HEIGHT * (z.range[1] - z.range[0])) / 100;
                return (
                  <rect
                    key={z.level}
                    x={TUBE_X}
                    y={y1}
                    width={TUBE_WIDTH}
                    height={h}
                    fill={z.color}
                    opacity={0.08}
                  />
                );
              })}

              {/* Tube outline (clip so mercury stays inside rounded tube) */}
              <clipPath id="tube-clip">
                <rect x={TUBE_X} y={TUBE_TOP} width={TUBE_WIDTH} height={TUBE_HEIGHT + 4} rx={TUBE_WIDTH / 2} />
              </clipPath>

              {/* Mercury fill inside tube */}
              <g clipPath="url(#tube-clip)">
                <rect
                  x={TUBE_X}
                  y={mercuryTopY}
                  width={TUBE_WIDTH}
                  height={TUBE_BOTTOM - mercuryTopY + 8}
                  fill="url(#risk-gradient)"
                  filter="url(#mercury-glow)"
                />
              </g>

              {/* Tube outline on top */}
              <rect
                x={TUBE_X}
                y={TUBE_TOP}
                width={TUBE_WIDTH}
                height={TUBE_HEIGHT + 4}
                rx={TUBE_WIDTH / 2}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1.5}
              />

              {/* Bulb — always filled with the overall zone color */}
              <circle
                cx={WIDTH / 2}
                cy={BULB_CY}
                r={BULB_R}
                fill={overallZone.color}
                stroke="var(--border)"
                strokeWidth={1.5}
                filter="url(#mercury-glow)"
              />

              {/* Zone tick marks + labels on the right */}
              {ZONES.map((z) => {
                const y = TUBE_BOTTOM - (TUBE_HEIGHT * z.range[1]) / 100;
                return (
                  <g key={`tick-${z.level}`}>
                    <line
                      x1={TUBE_X + TUBE_WIDTH}
                      x2={TUBE_X + TUBE_WIDTH + 6}
                      y1={y}
                      y2={y}
                      stroke="var(--muted-foreground)"
                      strokeWidth={1}
                    />
                  </g>
                );
              })}

              {/* Current-reading arrow pointing at mercury top */}
              <g transform={`translate(${TUBE_X + TUBE_WIDTH + 8} ${mercuryTopY})`}>
                <polygon points="0,0 8,-5 8,5" fill={overallZone.color} />
              </g>
            </svg>
          </div>

          {/* Zone legend + overall info */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Zone table */}
            <div className="space-y-1.5">
              {[...ZONES].reverse().map((z) => {
                const count = summary.counts[z.level];
                const isActive = z.level === summary.overall;
                return (
                  <div
                    key={z.level}
                    className={`rounded-md border px-3 py-2 flex items-center justify-between gap-3 transition ${
                      isActive ? `${z.badgeClass} ${z.softBg}` : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="size-2.5 rounded-full shrink-0" style={{ background: z.color }} />
                      <span className={`text-sm ${isActive ? "font-semibold" : "text-muted-foreground"}`}>
                        {z.label}
                      </span>
                    </div>
                    <Badge
                      variant={count > 0 ? "default" : "outline"}
                      className="text-[10px] tabular-nums"
                    >
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rationale + recovery */}
        <div className={`rounded-md border p-3 ${overallZone.badgeClass} ${overallZone.softBg}`}>
          <p className="text-sm font-medium">{summary.overallRationale}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2">
            <Clock className="size-3.5" />
            <span className="font-medium text-foreground">Recovery timeframe:</span>
            <span>{summary.recoveryTimeframe}</span>
          </div>
        </div>

        {/* Per-biomarker breakdown */}
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
                  const z = ZONES[LEVEL_INDEX[b.level]];
                  return (
                    <div key={b.name} className="px-3 py-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="size-2 rounded-full shrink-0" style={{ background: z.color }} />
                        <span className="text-sm font-medium truncate">{b.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {b.value} {b.unit ?? ""}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${z.badgeClass}`}>
                        {z.label.replace(" risk", "")}
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
