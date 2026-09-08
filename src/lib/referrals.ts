/**
 * Referrals — a patient sent from one org to another org / specialty.
 * Outbound for the sender, inbound for the receiver (who accepts/declines).
 * Server-only; access gated at the API layer.
 */

import { prisma } from "@/lib/prisma";
import type { Specialty, ReferralStatus } from "@prisma/client";

export type OutboundReferral = {
  id: string;
  patientId: string;
  patientName: string;
  to: string;
  specialty: Specialty;
  reason: string;
  status: ReferralStatus;
  createdAt: string;
};

export type InboundReferral = {
  id: string;
  patientId: string;
  patientName: string;
  from: string;
  specialty: Specialty;
  reason: string;
  status: ReferralStatus;
  createdAt: string;
};

export async function getOutboundReferrals(orgId: string, limit = 10): Promise<OutboundReferral[]> {
  const rows = await prisma.referral.findMany({
    where: { fromOrgId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, specialty: true, reason: true, status: true, createdAt: true, toOrgName: true,
      patient: { select: { id: true, name: true } },
      toOrg: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient.id,
    patientName: r.patient.name ?? "(unnamed)",
    to: r.toOrg?.name ?? r.toOrgName ?? "External provider",
    specialty: r.specialty,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getInboundReferrals(orgId: string, limit = 10): Promise<InboundReferral[]> {
  const rows = await prisma.referral.findMany({
    where: { toOrgId: orgId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true, specialty: true, reason: true, status: true, createdAt: true,
      patient: { select: { id: true, name: true } },
      fromOrg: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient.id,
    patientName: r.patient.name ?? "(unnamed)",
    from: r.fromOrg?.name ?? "—",
    specialty: r.specialty,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Suggest a specialty from a care-flag title, to pre-fill the refer dialog. */
export function suggestSpecialty(flagTitle: string): Specialty {
  const t = flagTitle.toLowerCase();
  if (/nephro|renal|kidney/.test(t)) return "NEPHROLOGY";
  if (/hepato|liver/.test(t)) return "GASTROENTEROLOGY";
  if (/thyroid|hypothyroid|thyrotox|diabet|glycemic/.test(t)) return "ENDOCRINOLOGY";
  if (/lipid|cardiac|cardio/.test(t)) return "CARDIOLOGY";
  return "GENERAL";
}
