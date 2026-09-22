import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { SupplementShell, type SupplementRow } from "@/components/supplement-planner/supplement-shell";

export const metadata = { title: "Supplement Planner — Ayus" };

export default async function SupplementsPage() {
  const userId = await requireAuth();

  const rows = await prisma.supplementSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });

  const schedules: SupplementRow[] = rows.map((r) => ({
    id: r.id,
    supplementType: r.supplementType,
    name: r.name,
    dose: r.dose,
    form: r.form,
    timing: r.timing,
    time: r.time,
    daysOfWeek: r.daysOfWeek,
    active: r.active,
    isFavorite: r.isFavorite,
    notes: r.notes,
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <SupplementShell schedules={schedules} />
    </div>
  );
}
