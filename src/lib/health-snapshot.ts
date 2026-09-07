import { prisma } from "@/lib/prisma";

/**
 * Build a structured "health snapshot" that's injected into the chat system
 * prompt. Gives the model instant access to current state so it doesn't have to
 * hope the RAG pulled the right biomarker page.
 *
 * Kept concise — aim for ~2-3k tokens max.
 */
export async function buildHealthSnapshot(userId: string): Promise<string> {
  const [user, outOfRange, recentTests, meds, activeDiet, lastVisit] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, createdAt: true },
    }),
    prisma.testResult.findMany({
      where: { userId, isOutOfRange: true },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        normalizedName: true,
        observedValueRaw: true,
        observedValueUnit: true,
        interpretation: true,
        referenceIntervalRaw: true,
        createdAt: true,
      },
    }),
    prisma.testResult.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { normalizedName: true, observedValueRaw: true, observedValueUnit: true, createdAt: true },
    }),
    prisma.medication.findMany({
      where: { userId, active: true },
      select: { name: true, dosage: true, frequency: true, notes: true },
    }),
    prisma.dietSchedule.findMany({
      where: { userId, active: true },
      orderBy: { time: "asc" },
      take: 10,
      select: { mealType: true, time: true, items: true },
    }),
    prisma.doctorNote.findFirst({
      where: { userId },
      orderBy: { visitDate: "desc" },
      select: { visitDate: true, doctorName: true, diagnosis: true, notes: true },
    }),
  ]);

  // Dedupe biomarkers — keep the most recent reading per test name
  const latestByName = new Map<string, (typeof recentTests)[number]>();
  for (const t of recentTests) {
    const key = t.normalizedName.toLowerCase();
    if (!latestByName.has(key)) latestByName.set(key, t);
  }

  const iso = (d: Date) => d.toISOString().split("T")[0];

  const lines: string[] = ["<health_snapshot>"];
  lines.push(`user_name: ${user?.name ?? "Unknown"}`);

  if (outOfRange.length > 0) {
    lines.push("", "out_of_range_biomarkers:");
    for (const t of outOfRange.slice(0, 12)) {
      lines.push(`  - ${t.normalizedName}: ${t.observedValueRaw}${t.observedValueUnit ? ` ${t.observedValueUnit}` : ""} [${t.interpretation}] (ref ${t.referenceIntervalRaw ?? "?"}) on ${iso(t.createdAt)}`);
    }
  }

  if (latestByName.size > 0) {
    lines.push("", "latest_biomarkers:");
    for (const t of Array.from(latestByName.values()).slice(0, 20)) {
      lines.push(`  - ${t.normalizedName}: ${t.observedValueRaw}${t.observedValueUnit ? ` ${t.observedValueUnit}` : ""} on ${iso(t.createdAt)}`);
    }
  }

  if (meds.length > 0) {
    lines.push("", "active_medications:");
    for (const m of meds) {
      lines.push(`  - ${m.name}${m.dosage ? ` ${m.dosage}` : ""} ${m.frequency.toLowerCase().replace(/_/g, " ")}${m.notes ? ` — ${m.notes}` : ""}`);
    }
  }

  if (activeDiet.length > 0) {
    lines.push("", "current_diet_schedule:");
    for (const d of activeDiet) {
      lines.push(`  - ${d.time} ${d.mealType.toLowerCase().replace(/_/g, " ")}: ${d.items}`);
    }
  }

  if (lastVisit) {
    lines.push("", "last_doctor_visit:");
    lines.push(`  - date: ${iso(lastVisit.visitDate)}`);
    if (lastVisit.doctorName) lines.push(`  - doctor: Dr. ${lastVisit.doctorName}`);
    if (lastVisit.diagnosis) lines.push(`  - diagnosis: ${lastVisit.diagnosis}`);
    if (lastVisit.notes) lines.push(`  - notes: ${lastVisit.notes.slice(0, 300)}`);
  }

  lines.push("</health_snapshot>");
  return lines.join("\n");
}
