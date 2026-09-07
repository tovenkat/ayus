/**
 * Patient roster + search — lab / clinic / hospital only.
 *
 * Search surfaces any user (so a lab can initiate a request), but opening a
 * patient's records requires a GRANTED PatientLink. The gate lives on
 * /patients/[id]; this page just lets the roster be built and browsed.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { requireKind } from "@/lib/account-kind";
import { getRosterOrg, listRosterLinks } from "@/lib/patient-roster";
import { PatientSearch, type RosterEntry } from "@/components/patients/patient-search";

export default async function PatientsPage() {
  const userId = await requireAuth();
  await requireKind("lab", "doctor", "hospital"); // redirects personal/unknown to /dashboard

  const org = await getRosterOrg(userId);
  const links = org ? await listRosterLinks(org.orgId) : [];

  const roster: RosterEntry[] = links.map((l) => ({
    id: l.patient.id,
    name: l.patient.name ?? "(unnamed)",
    phone: l.patient.phone,
    email: l.patient.email.endsWith("@phone.local") ? null : l.patient.email,
    linkStatus: l.status,
    href: `/patients/${l.patient.id}`,
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Patients</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search for a patient and request access. Records open once the patient grants consent.
        </p>
      </div>

      <PatientSearch initialRoster={roster} />
    </div>
  );
}
