/**
 * Consultation notes recorded by a roster org (clinic/hospital) about a
 * consented patient. The DoctorNote lands in the patient's records (userId),
 * attributed to the org (organizationId) + author (recordedById).
 *
 * Server-only. Access is gated at the API layer via checkPatientAccess.
 */

import { prisma } from "@/lib/prisma";

const RECENT_DAYS = 30;

export type RecentConsult = {
  id: string;
  patientId: string;
  patientName: string;
  visitDate: string;
  diagnosis: string | null;
  notes: string | null;
};

/** Latest consults the org recorded, for the dashboard activity surface. */
export async function getRecentConsults(orgId: string, limit = 8): Promise<RecentConsult[]> {
  const rows = await prisma.doctorNote.findMany({
    where: { organizationId: orgId },
    orderBy: { visitDate: "desc" },
    take: limit,
    select: {
      id: true, visitDate: true, diagnosis: true, notes: true,
      user: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    patientId: r.user.id,
    patientName: r.user.name ?? "(unnamed)",
    visitDate: r.visitDate.toISOString(),
    diagnosis: r.diagnosis,
    notes: r.notes,
  }));
}

/**
 * Patient ids the org has a consult for within the last RECENT_DAYS — used to
 * mark a care flag "addressed" once the doctor has logged a visit.
 */
export async function getRecentlyConsultedPatientIds(orgId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 3.6e6);
  const rows = await prisma.doctorNote.findMany({
    where: { organizationId: orgId, visitDate: { gte: since } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return new Set(rows.map((r) => r.userId));
}
