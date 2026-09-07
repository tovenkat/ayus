"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, TrendingUp, AlertTriangle, RefreshCw } from "lucide-react";
import { computeVariety, type PlannerSchedule } from "@/lib/diet-planner";

type Props = { schedules: PlannerSchedule[] };

function scoreColor(score: number): { badge: string; progress: string; label: string } {
  if (score >= 70) return { badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", progress: "[&>div]:bg-emerald-500", label: "Great variety" };
  if (score >= 40) return { badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", progress: "[&>div]:bg-amber-500", label: "Getting repetitive" };
  return { badge: "bg-destructive/10 text-destructive border-destructive/30", progress: "[&>div]:bg-destructive", label: "Too repetitive" };
}

export function VarietyInsights({ schedules }: Props) {
  const stats = useMemo(() => computeVariety(schedules), [schedules]);
  const color = scoreColor(stats.score);

  if (stats.totalMealsPerWeek === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            <h2 className="text-base font-semibold">Variety score</h2>
          </div>
          <Badge variant="outline" className={`text-[10px] ${color.badge}`}>{color.label}</Badge>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="font-heading text-4xl font-bold tabular-nums">{stats.score}</p>
            <div className="text-right text-xs text-muted-foreground space-y-0.5">
              <p><span className="font-medium text-foreground">{stats.uniqueIngredients}</span> unique ingredients</p>
              <p><span className="font-medium text-foreground">{stats.totalMealsPerWeek}</span> meals/week</p>
            </div>
          </div>
          <Progress value={stats.score} className={color.progress} />
          <p className="text-xs text-muted-foreground">
            A score above 70 means your week feels fresh. Below 40 means you're eating too similarly — swap a few meals for variety.
          </p>
        </div>

        {stats.mostRepeatedMeal && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-xs font-medium flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3.5" />
              Repeated meal
            </p>
            <p className="text-sm">"{stats.mostRepeatedMeal.items}"</p>
            <p className="text-xs text-muted-foreground">
              Appears {stats.mostRepeatedMeal.daysApplied} days/week. Hover it in the weekly planner and hit
              the <RefreshCw className="size-3 inline mx-0.5" /> to swap — or vary it across days.
            </p>
          </div>
        )}

        {stats.repeatedIngredients.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">Ingredients appearing 3+ times this week</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stats.repeatedIngredients.map((ing) => (
                <Badge key={ing.name} variant="outline" className="text-[10px] capitalize">
                  {ing.name} <span className="text-muted-foreground ml-1">×{ing.count}</span>
                </Badge>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Healthy staples (dal, curd, rice) naturally repeat. Watch for the same vegetable or protein appearing
              every day — rotate them for micronutrient diversity.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
