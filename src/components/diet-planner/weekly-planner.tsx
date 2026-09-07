"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { mealsForDay, DAY_LABELS, MEAL_TYPES, MEAL_LABEL, type PlannerSchedule } from "@/lib/diet-planner";
import { MealCard } from "@/components/diet-planner/meal-card";
import { useDietPrefs } from "@/components/diet-planner/preferences-panel";

type Props = { schedules: PlannerSchedule[] };

export function WeeklyPlanner({ schedules }: Props) {
  const { prefs } = useDietPrefs();
  const today = new Date().getDay();

  const weekMatrix = useMemo(() => {
    return DAY_LABELS.map((_, day) => ({
      day,
      meals: mealsForDay(schedules, day),
    }));
  }, [schedules]);

  const totalActive = schedules.filter((s) => s.active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          <h2 className="text-lg font-heading font-semibold">This week</h2>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {totalActive} active meal{totalActive === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* Grid view — horizontal scroll on narrow screens */}
      <div className="overflow-x-auto -mx-2 px-2">
        <div className="min-w-[720px] grid grid-cols-7 gap-2">
          {weekMatrix.map(({ day, meals }) => {
            const isToday = day === today;
            const byType = new Map(meals.map((m) => [m.mealType, m]));
            return (
              <div key={day} className="space-y-2">
                <div className={`text-center py-1.5 rounded-md text-xs font-medium ${isToday ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {DAY_LABELS[day]}
                </div>
                <div className="space-y-1">
                  {MEAL_TYPES.map((mt) => {
                    const m = byType.get(mt);
                    if (!m) {
                      return (
                        <div
                          key={mt}
                          className="rounded-md border border-dashed border-muted p-2 text-[10px] text-muted-foreground/60 text-center min-h-[50px] flex items-center justify-center"
                        >
                          {MEAL_LABEL[mt].split(" ")[0]}
                        </div>
                      );
                    }
                    return <MealCard key={m.id} meal={m} prefs={prefs} variant="compact" />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground flex items-center gap-2">
          <span>💡</span>
          <p>Hover a meal card to reveal the swap button. Meals set to specific days only appear on those days.</p>
        </CardContent>
      </Card>
    </div>
  );
}
