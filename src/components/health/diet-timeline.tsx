import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DietActions } from "@/components/health/diet-actions";
import { Coffee, UtensilsCrossed, Sandwich, Apple, Soup, Moon } from "lucide-react";
import type { MealType } from "@prisma/client";

type Schedule = {
  id: string;
  mealType: MealType;
  time: string;
  items: string;
  calories: number | null;
  notes: string | null;
  restrictions: string[];
  daysOfWeek: number[];
  active: boolean;
};

const MEAL_ICONS: Record<MealType, typeof Coffee> = {
  BREAKFAST: Coffee,
  MORNING_SNACK: Apple,
  LUNCH: UtensilsCrossed,
  AFTERNOON_SNACK: Sandwich,
  DINNER: Soup,
  EVENING_SNACK: Moon,
};

const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  MORNING_SNACK: "Morning snack",
  LUNCH: "Lunch",
  AFTERNOON_SNACK: "Afternoon snack",
  DINNER: "Dinner",
  EVENING_SNACK: "Evening snack",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const hour12 = ((h + 11) % 12) + 1;
  const suffix = h < 12 ? "AM" : "PM";
  return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}

export function DietTimeline({ schedules }: { schedules: Schedule[] }) {
  if (schedules.length === 0) return null;

  const sorted = [...schedules].sort((a, b) => a.time.localeCompare(b.time));
  const totalKcal = sorted.reduce((sum, s) => sum + (s.calories ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Your day ({sorted.length} meal{sorted.length === 1 ? "" : "s"})
        </h2>
        {totalKcal > 0 && (
          <Badge variant="outline" className="text-[10px]">
            ~{totalKcal.toLocaleString("en-IN")} kcal total
          </Badge>
        )}
      </div>

      <div className="relative pl-16">
        {/* Vertical spine */}
        <div className="absolute left-[52px] top-2 bottom-2 w-px bg-border" aria-hidden />

        <div className="space-y-3">
          {sorted.map((s) => {
            const Icon = MEAL_ICONS[s.mealType] ?? UtensilsCrossed;
            return (
              <div key={s.id} className="relative">
                {/* Time label on the left */}
                <div className="absolute -left-16 top-3 w-12 text-right">
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">
                    {formatTime12h(s.time)}
                  </span>
                </div>

                {/* Dot on spine */}
                <div className="absolute -left-[14px] top-4 size-3 rounded-full bg-primary ring-4 ring-background" aria-hidden />

                {/* Card */}
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Icon className="size-4 text-primary shrink-0" />
                          <span className="font-medium text-sm">{MEAL_LABELS[s.mealType]}</span>
                          {s.calories !== null && (
                            <Badge variant="secondary" className="text-[10px]">{s.calories} kcal</Badge>
                          )}
                          {s.restrictions.map((r) => (
                            <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                          ))}
                          {s.daysOfWeek.length > 0 && s.daysOfWeek.length < 7 && (
                            <Badge variant="outline" className="text-[10px]">
                              {s.daysOfWeek.map((d) => DAYS[d]).join(", ")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{s.items}</p>
                        {s.notes && <p className="text-xs text-muted-foreground">📝 {s.notes}</p>}
                      </div>
                      <DietActions id={s.id} active={s.active} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
