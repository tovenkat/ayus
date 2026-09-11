import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { ExerciseShell, type ExerciseRow } from "@/components/exercise-planner/exercise-shell";

export const metadata = { title: "Exercise Planner — Ayus" };

export default async function ExercisePage() {
  const userId = await requireAuth();

  const rows = await prisma.exerciseSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });

  const schedules: ExerciseRow[] = rows.map((r) => ({
    id: r.id,
    exerciseType: r.exerciseType,
    name: r.name,
    time: r.time,
    durationMin: r.durationMin,
    intensity: r.intensity,
    targetAreas: r.targetAreas,
    daysOfWeek: r.daysOfWeek,
    active: r.active,
    isFavorite: r.isFavorite,
    notes: r.notes,
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <ExerciseShell schedules={schedules} />
    </div>
  );
}
