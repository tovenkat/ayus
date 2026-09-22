import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { AyurvedaShell, type AyurvedicRow } from "@/components/ayurveda-planner/ayurveda-shell";

export const metadata = { title: "Ayurveda Planner — Ayus" };

export default async function AyurvedaPage() {
  const userId = await requireAuth();

  const rows = await prisma.ayurvedicSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });

  const schedules: AyurvedicRow[] = rows.map((r) => ({
    id: r.id,
    ayurvedicType: r.ayurvedicType,
    name: r.name,
    dosha: r.dosha,
    dose: r.dose,
    anupana: r.anupana,
    timing: r.timing,
    time: r.time,
    daysOfWeek: r.daysOfWeek,
    active: r.active,
    isFavorite: r.isFavorite,
    notes: r.notes,
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <AyurvedaShell schedules={schedules} />
    </div>
  );
}
