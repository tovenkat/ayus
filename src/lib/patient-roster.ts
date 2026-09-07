/**
 * Roster + consent gate for lab / clinic / hospital accounts.
 *
 * Server-only (pulls in Prisma). Search may surface any user so a lab can
 * *initiate* a request, but opening a patient's records requires a GRANTED
 * PatientLink between the caller's org and that patient. This is the DPDP /
 * ABDM consent boundary — enforce it on every patient-scoped read.
 *
 * DO NOT import from a "use client" component.
 */

import { prisma } from "@/lib/prisma";
import { getAccountKind, hasPatientRoster } from "@/lib/account-kind";
import type { ConsentStatus } from "@prisma/client";

/** "none" = no link row yet; otherwise the PatientLink.status. */
export type LinkStatus = "none" | ConsentStatus;

export type CallerOrg = {
  orgId: string;
  memberId: string;
};

/**
 * Resolve the roster org for a caller. Returns null when the user isn't a
 * member of a roster-capable org (personal / unknown) — callers must treat
 * null as "not authorized to hold a roster".
 */
export async function getRosterOrg(userId: string): Promise<CallerOrg | null> {
  const kind = await getAccountKind(userId);
  if (!hasPatientRoster(kind)) return null;

  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true },
  });
  if (!membership) return null;
  return { orgId: membership.organizationId, memberId: membership.id };
}

/** Link status between one org and one patient. */
export async function getLinkStatus(orgId: string, patientId: string): Promise<LinkStatus> {
  const link = await prisma.patientLink.findUnique({
    where: { organizationId_patientId: { organizationId: orgId, patientId } },
    select: { status: true },
  });
  return link?.status ?? "none";
}

/**
 * Batch link-status lookup for a set of patients — used to annotate search
 * results without an N+1. Returns a Map keyed by patientId; absent = "none".
 */
export async function getLinkStatusMap(
  orgId: string,
  patientIds: string[],
): Promise<Map<string, ConsentStatus>> {
  if (patientIds.length === 0) return new Map();
  const links = await prisma.patientLink.findMany({
    where: { organizationId: orgId, patientId: { in: patientIds } },
    select: { patientId: true, status: true },
  });
  return new Map(links.map((l) => [l.patientId, l.status]));
}

export type GateResult =
  | { ok: true; orgId: string; patientId: string }
  | { ok: false; reason: "not_a_roster_account" | "no_granted_link"; status: LinkStatus };

/**
 * The access gate. Confirms the caller is a roster account AND holds a
 * GRANTED link to the patient. Every patient-scoped API/page must call this
 * before returning any of the patient's health data.
 */
export async function checkPatientAccess(userId: string, patientId: string): Promise<GateResult> {
  const org = await getRosterOrg(userId);
  if (!org) return { ok: false, reason: "not_a_roster_account", status: "none" };

  const status = await getLinkStatus(org.orgId, patientId);
  if (status !== "GRANTED") return { ok: false, reason: "no_granted_link", status };
  return { ok: true, orgId: org.orgId, patientId };
}

/** Pending + granted links the caller's org holds, for the roster list page. */
export async function listRosterLinks(orgId: string) {
  return prisma.patientLink.findMany({
    where: { organizationId: orgId, status: { in: ["PENDING", "GRANTED"] } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      createdAt: true,
      patient: { select: { id: true, name: true, phone: true, email: true } },
    },
  });
}

/** Access requests awaiting a given patient's decision (patient-side inbox). */
export async function listPatientAccessRequests(patientUserId: string) {
  return prisma.patientLink.findMany({
    where: { patientId: patientUserId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      organization: { select: { id: true, name: true, type: true } },
    },
  });
}
