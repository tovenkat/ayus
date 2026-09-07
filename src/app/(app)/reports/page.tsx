import Link from "next/link";
import { requireAuth } from "@/lib/auth-helpers";
import { getAccountKind } from "@/lib/account-kind";
import { getRosterOrg } from "@/lib/patient-roster";
import { LabReports } from "@/components/reports/lab-reports";
import type { LabReportsFilter } from "@/lib/lab-analytics";
import { prisma } from "@/lib/prisma";
import { ReportsList } from "@/components/reports/reports-list";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Stethoscope, Pill, AlertTriangle, ArrowRight } from "lucide-react";

export const metadata = { title: "Reports — Ayus" };

type Tab = "labs" | "imaging" | "prescriptions";

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "labs", label: "Lab reports", icon: FileText },
  { id: "imaging", label: "Imaging & scans", icon: Stethoscope },
  { id: "prescriptions", label: "Prescriptions", icon: Pill },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: Tab }>;
}) {
  const userId = await requireAuth();
  const { status, tab } = await searchParams;

  // Lab accounts see the org-scoped operational report list, not personal reports.
  const kind = await getAccountKind(userId);
  if (kind === "lab") {
    const org = await getRosterOrg(userId);
    const labFilter: LabReportsFilter =
      status === "NEEDS_REVIEW" || status === "ERROR" || status === "READY" ? status : "all";
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight lg:text-4xl">Reports</h1>
          <p className="text-muted-foreground">Every report your lab has processed, with extraction quality and status.</p>
        </div>
        {org ? <LabReports orgId={org.orgId} filter={labFilter} /> : <p className="text-sm text-muted-foreground">No organization found.</p>}
      </div>
    );
  }

  const activeTab: Tab = tab === "imaging" || tab === "prescriptions" ? tab : "labs";
  const statusFilter =
    status === "CONFIRMED" || status === "NEEDS_REVIEW" ? status : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight lg:text-4xl">Reports</h1>
        <p className="text-muted-foreground">
          Every report you&apos;ve uploaded — labs, scans, and prescriptions — in one place.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50 overflow-x-auto w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <Link
              key={t.id}
              href={{ pathname: "/reports", query: { tab: t.id } }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition shrink-0 ${
                active ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
              scroll={false}
            >
              <Icon className="size-3.5" />
              {t.label}
            </Link>
          );
        })}
      </div>

      {activeTab === "labs" && <LabsTab userId={userId} statusFilter={statusFilter} />}
      {activeTab === "imaging" && <ClinicalTab userId={userId} kind="IMAGING" />}
      {activeTab === "prescriptions" && <ClinicalTab userId={userId} kind="PRESCRIPTION" />}
    </div>
  );
}

async function LabsTab({ userId, statusFilter }: { userId: string; statusFilter?: "CONFIRMED" | "NEEDS_REVIEW" }) {
  const reports = await prisma.report.findMany({
    where: {
      userId,
      ...(statusFilter && { upload: { status: statusFilter } }),
    },
    include: {
      upload: { select: { status: true, originalName: true } },
      _count: { select: { testResults: true } },
      testResults: {
        select: { id: true, isOutOfRange: true, plausibilityFlag: true, warnings: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const serialized = reports.map((r) => {
    const outOfRangeCount = r.testResults.filter((t) => t.isOutOfRange).length;
    const warningCount = r.testResults.reduce(
      (n, t) => n + (t.warnings?.length ?? 0) + (t.plausibilityFlag ? 1 : 0),
      0,
    );
    return {
      id: r.id,
      sampleCollectedOn: r.sampleCollectedOn?.toISOString() ?? null,
      referredBy: r.referredBy,
      fileStatus: r.upload.status,
      fileName: r.upload.originalName,
      confidence: r.confidence,
      testCount: r._count.testResults,
      outOfRangeCount,
      warningCount,
      needsReview: r.needsReview,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return <ReportsList reports={serialized} currentFilter={statusFilter ?? "all"} />;
}

// ─── Clinical tab (IMAGING / PRESCRIPTION) ────────────────────────────────

const SEVERITY_STYLE = {
  NORMAL:   { label: "Normal",   badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  MINOR:    { label: "Minor",    badge: "border-muted" },
  MODERATE: { label: "Moderate", badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  SEVERE:   { label: "Severe",   badge: "border-destructive/40 bg-destructive/10 text-destructive" },
  CRITICAL: { label: "Critical", badge: "border-destructive bg-destructive/20 text-destructive" },
} as const;

async function ClinicalTab({ userId, kind }: { userId: string; kind: "IMAGING" | "PRESCRIPTION" }) {
  const rows = await prisma.clinicalReport.findMany({
    where: { userId, kind },
    include: { upload: { select: { originalName: true, status: true } } },
    orderBy: [{ performedOn: "desc" }, { createdAt: "desc" }],
  });

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3 text-muted-foreground text-sm">
          <div className="mx-auto size-10 rounded-full bg-muted flex items-center justify-center">
            {kind === "IMAGING" ? <Stethoscope className="size-5" /> : <Pill className="size-5" />}
          </div>
          <p>
            {kind === "IMAGING"
              ? "No imaging or scan reports yet. Upload any X-ray, CT, MRI, or ultrasound PDF and we'll parse it."
              : "No prescriptions yet. Upload your doctor's prescription (PDF or photo) and we'll auto-add the medications to your schedule."}
          </p>
          <Link href="/upload" className="text-primary hover:underline inline-flex items-center gap-1">
            Upload now <ArrowRight className="size-3.5" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const sev = r.severity ? SEVERITY_STYLE[r.severity] : null;
        const measurements = r.measurements as Record<string, unknown> | null;
        const dateDisplay = r.performedOn
          ? new Date(r.performedOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        return (
          <Card key={r.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">
                      {r.modality ?? r.procedureName ?? (kind === "PRESCRIPTION" ? "Prescription" : "Clinical report")}
                    </span>
                    <span className="text-xs text-muted-foreground">· {dateDisplay}</span>
                    {sev && (
                      <Badge variant="outline" className={`text-[10px] ${sev.badge}`}>
                        {r.severity === "SEVERE" || r.severity === "CRITICAL" ? (
                          <AlertTriangle className="size-3 mr-1" />
                        ) : null}
                        {sev.label}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                    {r.bodyPart && <span>{r.bodyPart}</span>}
                    {r.institution && <span>· {r.institution}</span>}
                    {r.performedBy && <span>· {r.performedBy}</span>}
                    {r.referringDoctor && <span>· Ref. {r.referringDoctor}</span>}
                  </div>
                </div>
                <a
                  href={`/api/files/${r.uploadId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline shrink-0"
                >
                  Original →
                </a>
              </div>

              {r.impression && (
                <div className="rounded-md bg-muted/40 p-2.5 text-sm">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-0.5">Impression</span>
                  {r.impression}
                </div>
              )}

              {kind === "IMAGING" && r.findings && !r.impression && (
                <p className="text-sm line-clamp-3 text-muted-foreground">{r.findings}</p>
              )}

              {r.abnormalFlags && r.abnormalFlags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.abnormalFlags.slice(0, 6).map((f) => (
                    <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                  ))}
                </div>
              )}

              {measurements && Object.keys(measurements).length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {Object.entries(measurements).slice(0, 6).map(([k, v]) => (
                    <span key={k}>
                      <span className="font-medium text-foreground">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              )}

              {kind === "PRESCRIPTION" && r.recommendations && (
                <p className="text-xs text-muted-foreground">📝 {r.recommendations}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
