import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { EmergencyCardView, type EmergencyData } from "@/components/emergency/emergency-card-view";

export const metadata = { title: "Emergency Card — Ayus" };

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

export default async function EmergencyPage() {
  const userId = await requireAuth();

  const [user, meds, criticalBiomarkers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        bloodType: true,
        allergies: true,
        chronicConditions: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactRelation: true,
      },
    }),
    prisma.medication.findMany({
      where: { userId, active: true },
      orderBy: { name: "asc" },
      select: { name: true, dosage: true, frequency: true, notes: true },
    }),
    prisma.testResult.findMany({
      where: { userId, isOutOfRange: true },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        normalizedName: true,
        observedValueRaw: true,
        observedValueUnit: true,
        interpretation: true,
        createdAt: true,
      },
    }),
  ]);

  // Dedupe by biomarker name (keep most recent)
  const seen = new Set<string>();
  const uniqueCritical = criticalBiomarkers.filter((t) => {
    const k = t.normalizedName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const data: EmergencyData = {
    patient: {
      name: user?.name ?? user?.email ?? "Patient",
      dateOfBirth: user?.dateOfBirth ? user.dateOfBirth.toISOString().split("T")[0] : null,
      ageYears: ageFromDob(user?.dateOfBirth ?? null),
      bloodType: user?.bloodType ?? null,
      phone: user?.phone ?? null,
    },
    allergies: user?.allergies ?? [],
    chronicConditions: user?.chronicConditions ?? [],
    medications: meds.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      notes: m.notes,
    })),
    emergencyContact: {
      name: user?.emergencyContactName ?? null,
      phone: user?.emergencyContactPhone ?? null,
      relation: user?.emergencyContactRelation ?? null,
    },
    criticalBiomarkers: uniqueCritical.map((t) => ({
      name: t.normalizedName,
      value: t.observedValueRaw,
      unit: t.observedValueUnit,
      interpretation: t.interpretation,
      date: t.createdAt.toISOString().split("T")[0],
    })),
    generatedAt: new Date().toISOString(),
  };

  return <EmergencyCardView data={data} />;
}
