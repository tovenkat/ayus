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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  const [reports, latestResults, outOfRangeCount, testCount] = await Promise.all([
    prisma.report.findMany({
      where: { userId: patientId },
      orderBy: [{ sampleCollectedOn: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true, sampleCollectedOn: true, referredBy: true, sampleType: true,
        upload: { select: { originalName: true } },
        _count: { select: { testResults: true } },
      },
    }),
    prisma.testResult.findMany({
      where: { userId: patientId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, normalizedName: true, observedValueRaw: true, observedValueUnit: true,
        referenceIntervalRaw: true, interpretation: true, isOutOfRange: true,
      },
    }),
    prisma.testResult.count({ where: { userId: patientId, isOutOfRange: true } }),
    prisma.testResult.count({ where: { userId: patientId } }),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
        <StatTile icon={<FileText className="size-4" />} label="Reports" value={reports.length >= 5 ? "5+" : String(reports.length)} />
        <StatTile icon={<FlaskConical className="size-4" />} label="Test results" value={String(testCount)} />
        <StatTile
          icon={<AlertTriangle className="size-4" />}
          label="Out of range"
          value={String(outOfRangeCount)}
          tone={outOfRangeCount > 0 ? "warn" : undefined}
        />
      </div>

      {/* Recent reports */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent reports</CardTitle></CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports on file.</p>
          ) : (
            <ul className="divide-y">
              {reports.map((r) => (
                <li key={r.id} className="py-2.5 flex items-center gap-3">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.upload.originalName}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(r.sampleCollectedOn)}
                      {r.sampleType && <> · {r.sampleType}</>}
                      {r.referredBy && <> · Ref: {r.referredBy}</>}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{r._count.testResults} tests</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Latest results */}
      <Card>
        <CardHeader><CardTitle className="text-base">Latest results</CardTitle></CardHeader>
        <CardContent className="px-0">
          {latestResults.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6">No test results on file.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestResults.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.normalizedName}</TableCell>
                      <TableCell className="tabular-nums">
                        {t.observedValueRaw}{t.observedValueUnit ? ` ${t.observedValueUnit}` : ""}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {t.referenceIntervalRaw ?? "—"}
                      </TableCell>
                      <TableCell>
                        {t.isOutOfRange ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10">
                            {t.interpretation === "HIGH" ? "High" : t.interpretation === "LOW" ? "Low" : "Abnormal"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Normal</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
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
