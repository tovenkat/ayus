"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Flame, Calendar } from "lucide-react";
import { mealsForDay, DAY_LABELS_LONG, type PlannerSchedule } from "@/lib/diet-planner";
import { MealCard } from "@/components/diet-planner/meal-card";
import { useDietPrefs } from "@/components/diet-planner/preferences-panel";

type Props = { schedules: PlannerSchedule[] };

export function TodayView({ schedules }: Props) {
  const { prefs } = useDietPrefs();
  const today = new Date().getDay();

  const todaysMeals = useMemo(() => mealsForDay(schedules, today), [schedules, today]);
  const totalKcal = todaysMeals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
  const goal = prefs.goalKcal ? Number(prefs.goalKcal) : null;
  const onTrack = goal ? Math.abs(totalKcal - goal) <= 200 : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-primary" />
            <h2 className="text-lg font-heading font-semibold">
              {DAY_LABELS_LONG[today]}
            </h2>
            <Badge variant="outline" className="text-[10px]">Today</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {todaysMeals.length} meal{todaysMeals.length === 1 ? "" : "s"} planned
          </p>
        </div>

        {totalKcal > 0 && (
          <Card className="shrink-0">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <Flame className="size-4 text-amber-500" />
              <div className="text-xs">
                <p className="font-heading text-base font-semibold tabular-nums">
                  {totalKcal.toLocaleString("en-IN")} kcal
                </p>
                {goal && (
                  <p className="text-muted-foreground">
                    goal: {goal.toLocaleString("en-IN")} ·{" "}
                    <span className={onTrack ? "text-emerald-600" : "text-amber-600"}>
                      {onTrack ? "on track" : `${totalKcal > goal ? "+" : ""}${totalKcal - goal}`}
                    </span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {todaysMeals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Sparkles className="size-8 mx-auto text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="font-medium">No meals scheduled for today</p>
              <p className="text-xs text-muted-foreground">
                Generate a plan from the assistant below, or add meals manually.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {todaysMeals.map((m) => (
            <MealCard key={m.id} meal={m} prefs={prefs} />
          ))}
        </div>
      )}
    </div>
  );
}
