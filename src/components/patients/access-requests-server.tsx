/**
 * Server wrapper for the patient-side access-request inbox. Self-contained —
 * drop <PatientAccessRequests /> anywhere in a patient-facing page. Renders
 * nothing when there are no pending requests.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { listPatientAccessRequests } from "@/lib/patient-roster";
import { ACCOUNT_KIND_LABEL } from "@/lib/account-kind-shared";
import { AccessRequests, type AccessRequest } from "./access-requests";

const ORG_TYPE_TO_KIND_LABEL: Record<string, string> = {
  DIAGNOSTIC_CENTER: ACCOUNT_KIND_LABEL.lab,
  CLINIC: ACCOUNT_KIND_LABEL.doctor,
  HOSPITAL: ACCOUNT_KIND_LABEL.hospital,
  INDIVIDUAL: ACCOUNT_KIND_LABEL.personal,
};

export async function PatientAccessRequests() {
  const userId = await requireAuth();
  const rows = await listPatientAccessRequests(userId);
  if (rows.length === 0) return null;

  const initial: AccessRequest[] = rows.map((r) => ({
    id: r.id,
    orgName: r.organization.name,
    orgKind: ORG_TYPE_TO_KIND_LABEL[r.organization.type] ?? "Provider",
    createdAt: r.createdAt.toISOString(),
  }));

  return <AccessRequests initial={initial} />;
}
