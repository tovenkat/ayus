/**
 * Individual patient dashboard — gated by PatientLink consent.
 *
 * Access rule (checkPatientAccess):
 *   - not a roster account        → redirect to /dashboard
 *   - roster account, no GRANTED  → show the request-access state ONLY
 *                                   (identity is already searchable; no
 *                                    health data is rendered)
 *   - GRANTED                     → full record summary
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserRound, FileText, AlertTriangle, FlaskConical } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { checkPatientAccess } from "@/lib/patient-roster";
import { buildDashboardData } from "@/lib/dashboard-queries";
import { buildRiskSummary } from "@/lib/risk-assessment";
import { getOrganRegions } from "@/components/health/organ-anatomy-section";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RiskThermometer } from "@/components/dashboard/risk-thermometer";
import { RecoveryPlan } from "@/components/dashboard/recovery-plan";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RequestAccessButton } from "@/components/patients/request-access-button";
import { UploadForPatient } from "@/components/patients/upload-for-patient";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function PatientDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireAuth();
  const { id: patientId } = await params;

  const gate = await checkPatientAccess(userId, patientId);
  if (!gate.ok && gate.reason === "not_a_roster_account") {
    redirect("/dashboard");
  }

  // Identity is non-PHI and already searchable — safe to show in both states.
  const patient = await prisma.user.findUnique({
    where: { id: patientId },
    select: {
      id: true, name: true, phone: true, email: true,
      dateOfBirth: true, bloodType: true, allergies: true, chronicConditions: true,
    },
  });
  if (!patient) redirect("/patients");

  const displayName = patient.name ?? "(unnamed patient)";
  const contact = patient.phone ?? (patient.email.endsWith("@phone.local") ? null : patient.email);

  // ── Consent not granted: show request state, NO health data ──────────────
  if (!gate.ok) {
    const status = gate.status; // "none" | "PENDING" | "REVOKED"
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <BackLink />
        <Card>
          <CardContent className="py-8 flex flex-col items-center text-center gap-4">
            <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <UserRound className="size-7" />
            </div>
            <div>
              <h1 className="font-heading text-2xl font-semibold">{displayName}</h1>
              {contact && <p className="text-sm text-muted-foreground tabular-nums">{contact}</p>}
            </div>
            <div className="max-w-md space-y-3">
              {status === "PENDING" ? (
                <>
                  <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10">
                    Access requested
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    This patient hasn’t responded yet. Their records stay hidden until they grant
                    consent.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    You don’t have consent to view this patient’s records. Request access — they’ll be
                    asked to approve before anything is shown.
                  </p>
                  <RequestAccessButton patientId={patient.id} />
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Consent GRANTED: load the record summary ─────────────────────────────
  // Same rich data the individual dashboard uses, built for the consented patient.
  const [reportCount, testCount, outOfRangeCount, dashData, riskSummary, organRegions] = await Promise.all([
    prisma.report.count({ where: { userId: patientId } }),
    prisma.testResult.count({ where: { userId: patientId } }),
    prisma.testResult.count({ where: { userId: patientId, isOutOfRange: true } }),
    buildDashboardData(patientId, { range: "all", abnormalOnly: false, worseningOnly: false }),
    buildRiskSummary(patientId),
    getOrganRegions(patientId),
  ]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <BackLink />

      {/* Identity header */}
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UserRound className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight truncate">{displayName}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {contact ?? "—"}
            {patient.dateOfBirth && <> · DOB {fmtDate(patient.dateOfBirth)}</>}
            {patient.bloodType && <> · {patient.bloodType}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
            Consent granted
          </Badge>
          <UploadForPatient patientId={patient.id} />
        </div>
      </div>

      {/* Allergies / chronic conditions */}
      {(patient.allergies.length > 0 || patient.chronicConditions.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {patient.allergies.map((a) => (
            <Badge key={`al-${a}`} variant="outline" className="text-red-600 border-red-500/30 bg-red-500/10">
              Allergy: {a}
            </Badge>
          ))}
          {patient.chronicConditions.map((c) => (
            <Badge key={`cc-${c}`} variant="outline">{c}</Badge>
          ))}
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={<FileText className="size-4" />} label="Reports" value={String(reportCount)} />
        <StatTile icon={<FlaskConical className="size-4" />} label="Test results" value={String(testCount)} />
        <StatTile
          icon={<AlertTriangle className="size-4" />}
          label="Out of range"
          value={String(outOfRangeCount)}
          tone={outOfRangeCount > 0 ? "warn" : undefined}
        />
      </div>

      {/* Risk + recovery — same as the individual dashboard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskThermometer summary={riskSummary} />
        <RecoveryPlan summary={riskSummary} />
      </div>

      {/* Full clinical dashboard: status pie + organ map + biomarker cards + trends.
          patientId puts the shell in read-only mode (no self-scoped refetch). */}
      <DashboardShell initialData={dashData} organRegions={organRegions} patientId={patient.id} />
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" nativeButton={false} render={<Link href="/patients" />}>
      <ArrowLeft className="size-4" /> Back to patients
    </Button>
  );
}

function StatTile({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: string; tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`flex items-center gap-1.5 text-xs ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
          {icon}{label}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
