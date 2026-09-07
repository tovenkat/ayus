import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { PlannerShell } from "@/components/diet-planner/planner-shell";
import type { PlannerSchedule } from "@/lib/diet-planner";
// This page's H1 lives inside PlannerShell — the shell renders its own heading with font-heading text-3xl.

export const metadata = { title: "Diet Planner — Ayus" };

export default async function DietPage() {
  const userId = await requireAuth();

  const rows = await prisma.dietSchedule.findMany({
    where: { userId },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });

  const schedules: PlannerSchedule[] = rows.map((s) => ({
    id: s.id,
    mealType: s.mealType,
    time: s.time,
    items: s.items,
    calories: s.calories,
    notes: s.notes,
    restrictions: s.restrictions,
    daysOfWeek: s.daysOfWeek,
    active: s.active,
    imageUrl: s.imageUrl,
    cuisineTags: s.cuisineTags,
    prepMinutes: s.prepMinutes,
    recipeUrl: s.recipeUrl,
    locked: s.locked,
    isFavorite: s.isFavorite,
    hidden: s.hidden,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  const activeMealTypes = Array.from(
    new Set(schedules.filter((s) => s.active).map((s) => s.mealType)),
  );

  return (
    <div className="max-w-5xl mx-auto">
      <PlannerShell schedules={schedules} activeMealTypes={activeMealTypes} />
    </div>
  );
}
