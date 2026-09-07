"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CircleCheck, Calendar, Target, Flag, Sprout } from "lucide-react";
import type { RiskSummary, RiskLevel, RecoveryMilestone } from "@/lib/risk-assessment";

type Props = { summary: RiskSummary };

const LEVEL_STYLE: Record<RiskLevel, { badge: string; soft: string; line: string; dot: string }> = {
  LOW:    { badge: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",  soft: "bg-emerald-500/10",  line: "bg-emerald-500",  dot: "bg-emerald-500" },
  MEDIUM: { badge: "border-amber-500/40 text-amber-700 dark:text-amber-400",        soft: "bg-amber-500/10",    line: "bg-amber-500",    dot: "bg-amber-500" },
  HIGH:   { badge: "border-destructive/40 text-destructive",                          soft: "bg-destructive/10",  line: "bg-destructive",  dot: "bg-destructive" },
  SUPER:  { badge: "border-destructive text-destructive",                              soft: "bg-destructive/20",  line: "bg-destructive",  dot: "bg-destructive" },
};

const MILESTONE_ICON = {
  now:       Sprout,
  check:     CircleCheck,
  milestone: Flag,
  target:    Target,
} as const;

function formatDateAt(weekOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weekOffset * 7);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function RecoveryPlan({ summary }: Props) {
  const plan = summary.recoveryPlan;
  const style = LEVEL_STYLE[summary.overall];
  const totalWeeks = Math.max(...plan.milestones.map((m) => m.weekOffset)) || 1;
  const totalMonths = plan.totalMonthsMin === plan.totalMonthsMax
    ? `${plan.totalMonthsMin} month${plan.totalMonthsMin === 1 ? "" : "s"}`
    : `${plan.totalMonthsMin}–${plan.totalMonthsMax} months`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <CardTitle className="text-base">Recovery plan</CardTitle>
          </div>
          <div className={`rounded-md border px-3 py-1 flex items-baseline gap-2 ${style.badge} ${style.soft}`}>
            <span className="text-[10px] uppercase tracking-wider font-semibold">Timeframe</span>
            <span className="text-sm font-bold">{totalMonths}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Timeline */}
        <div className="pt-2">
          <div className="relative h-16">
            {/* Base line */}
            <div className="absolute top-6 left-0 right-0 h-1 rounded-full bg-muted" />
            {/* Filled portion — from start to last milestone */}
            <div
              className={`absolute top-6 left-0 h-1 rounded-full ${style.line} opacity-70`}
              style={{ width: "100%" }}
            />

            {/* Milestone markers */}
            {plan.milestones.map((m, i) => {
              const leftPct = (m.weekOffset / totalWeeks) * 100;
              const Icon = MILESTONE_ICON[m.kind];
              const isFirst = i === 0;
              const isLast = i === plan.milestones.length - 1;
              return (
                <Milestone
                  key={i}
                  milestone={m}
                  leftPct={leftPct}
                  Icon={Icon}
                  dotClass={style.dot}
                  anchor={isFirst ? "start" : isLast ? "end" : "center"}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1.5">
            <Calendar className="size-3" />
            Plan starts today. First recheck in {plan.reassessInWeeks} week{plan.reassessInWeeks === 1 ? "" : "s"}.
          </p>
        </div>

        {/* Action steps */}
        {plan.nextSteps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Do these, starting this week
            </p>
            <ol className="space-y-2">
              {plan.nextSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className={`shrink-0 size-5 rounded-full ${style.soft} ${style.badge} border flex items-center justify-center text-[10px] font-bold`}>
                    {i + 1}
                  </span>
                  <span className="flex-1">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground pt-2 border-t">
          Recovery timelines are typical clinical expectations, not guarantees. Always discuss the plan with your doctor.
        </p>
      </CardContent>
    </Card>
  );
}

function Milestone({
  milestone: m,
  leftPct,
  Icon,
  dotClass,
  anchor,
}: {
  milestone: RecoveryMilestone;
  leftPct: number;
  Icon: typeof Sprout;
  dotClass: string;
  anchor: "start" | "center" | "end";
}) {
  const labelTranslate =
    anchor === "start" ? "" : anchor === "end" ? "-translate-x-full" : "-translate-x-1/2";
  const isKey = m.kind === "target" || m.kind === "now";

  return (
    <>
      {/* Dot */}
      <div
        className={`absolute top-4 size-5 rounded-full ${dotClass} ring-4 ring-background flex items-center justify-center -translate-x-1/2`}
        style={{ left: `${leftPct}%` }}
      >
        <Icon className="size-3 text-white" />
      </div>
      {/* Label below */}
      <div
        className={`absolute top-12 ${labelTranslate} text-center whitespace-nowrap`}
        style={{ left: `${leftPct}%` }}
      >
        <p className={`text-[11px] ${isKey ? "font-semibold" : "text-muted-foreground"}`}>
          {m.label}
        </p>
        <p className="text-[9px] text-muted-foreground tabular-nums">
          {formatDateAt(m.weekOffset)}
        </p>
      </div>
    </>
  );
}
