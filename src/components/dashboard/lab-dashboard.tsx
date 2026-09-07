/**
 * Laboratory dashboard — shown to kind="lab" accounts in place of the personal
 * dashboard. Four surfaces, all scoped to the org's on-behalf-of reports:
 *   1. Roster + summary tiles
 *   2. Needs-review queue with quality scoring
 *   3. Volume & throughput
 *   4. Referring-doctor tracking
 */

import Link from "next/link";
import {
  ClipboardCheck, Users, ArrowRight, Repeat, CalendarClock,
  Stethoscope, AlertTriangle, TrendingUp, Upload, FileText,
} from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getRosterOrg } from "@/lib/patient-roster";
import {
  getLabSummary, getReviewQueue, getVolumeSeries, getReferringDoctors, getRecentUploads,
  type QualityScore,
} from "@/lib/lab-analytics";
import { getFollowUpActionCounts, getFollowUpSummary } from "@/lib/lab-population";
import {
  getRiskStratification, getOrganDistribution, getTrendDistribution,
  type RiskBucket,
} from "@/lib/lab-population-health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export async function LabDashboard() {
  const userId = await requireAuth();
  const org = await getRosterOrg(userId);
  if (!org) return null;

  const [orgRow, summary, queue, volume, referrers, actions, followUp, risk, organs, trend, recentUploads] = await Promise.all([
    prisma.organization.findUnique({ where: { id: org.orgId }, select: { name: true } }),
    getLabSummary(org.orgId),
    getReviewQueue(org.orgId, 8),
    getVolumeSeries(org.orgId, 14),
    getReferringDoctors(org.orgId, 6),
    getFollowUpActionCounts(org.orgId),
    getFollowUpSummary(org.orgId),
    getRiskStratification(org.orgId),
    getOrganDistribution(org.orgId),
    getTrendDistribution(org.orgId),
    getRecentUploads(org.orgId, 8),
  ]);

  // First-run: no uploads and no consented patients yet → guide, don't show
  // a wall of empty cards.
  const isEmpty = recentUploads.length === 0 && summary.rosterCount === 0 && actions.length === 0 && risk.total === 0;

  const RISK_META: { key: RiskBucket; label: string; text: string; bar: string }[] = [
    { key: "low",      label: "Low",      text: "text-emerald-600", bar: "bg-emerald-500" },
    { key: "moderate", label: "Moderate", text: "text-amber-600",   bar: "bg-amber-500" },
    { key: "high",     label: "High",     text: "text-orange-600",  bar: "bg-orange-500" },
    { key: "critical", label: "Critical", text: "text-red-600",     bar: "bg-red-500" },
  ];
  const trendTotal = Math.max(1, trend.total);

  const maxVol = Math.max(1, ...volume.map((v) => v.reports));

  if (isEmpty) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{orgRow?.name ?? "Laboratory"}</h1>
          <p className="text-sm text-muted-foreground mt-1">Let&apos;s get your first reports in.</p>
        </div>
        <Card>
          <CardContent className="py-8 space-y-4">
            <p className="text-sm text-muted-foreground">
              Your dashboard fills in as you process reports. Two ways to start:
            </p>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="size-6 rounded-full bg-primary/10 text-primary grid place-items-center text-xs shrink-0">1</span>
                <span><b>Upload reports</b> from the Upload page — they appear here as intake, ready to assign to a patient.</span>
              </li>
              <li className="flex gap-3">
                <span className="size-6 rounded-full bg-primary/10 text-primary grid place-items-center text-xs shrink-0">2</span>
                <span><b>Build your roster</b> — find a patient, request consent, then upload on their behalf so results feed follow-up and risk views.</span>
              </li>
            </ol>
            <div className="flex gap-2 pt-1">
              <Button size="sm" nativeButton={false} render={<Link href="/upload" />}><Upload className="size-4" /> Upload reports</Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/patients" />}><Users className="size-4" /> Patient roster</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Patient Health Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {orgRow?.name ?? "Your lab"} · {summary.reports30d} reports · {summary.tests30d} tests
            {summary.avgTurnaroundHours != null && <> · {summary.avgTurnaroundHours}h avg turnaround</>} · last 30 days
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/patients" />}>
          <Users className="size-4" /> Patient roster
        </Button>
      </div>

      {/* Intelligence tiles — action, not vanity counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={<Users className="size-4" />} label="Consented patients" value={String(summary.rosterCount)} href="/patients" />
        <Tile
          icon={<ClipboardCheck className="size-4" />}
          label="Needs review"
          value={String(summary.needsReview)}
          tone={summary.needsReview > 0 ? "warn" : undefined}
          href="#needs-review"
        />
        <Tile
          icon={<Repeat className="size-4" />}
          label="Due for repeat test"
          value={String(followUp.due)}
          tone={followUp.due > 0 ? "warn" : undefined}
          href="/patients/follow-ups"
        />
        <Tile
          icon={<CalendarClock className="size-4" />}
          label="Missed follow-up"
          value={String(followUp.missed)}
          tone={followUp.missed > 0 ? "warn" : undefined}
          href="/patients/follow-ups?view=missed"
        />
      </div>

      {/* Recent uploads — the "did my upload land?" activity feed */}
      {recentUploads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Upload className="size-4" /> Recent uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recentUploads.map((u) => (
                <li key={u.id} className="py-2.5 flex items-center gap-3">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.patient ?? "Unassigned intake"} · {new Date(u.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <UploadStatus status={u.status} />
                  {u.patientId && (
                    <Link href={`/patients/${u.patientId}`} className="text-primary text-sm hover:underline shrink-0">Open</Link>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Health Action Center — actionable follow-up lists, not charts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Repeat className="size-4" /> Health Action Center
          </CardTitle>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No patients are due for repeat testing yet. As consented patients accumulate results, evidence-based
              recall lists appear here.
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {actions.map((a) => (
                  <li key={a.canonicalName}>
                    <Link
                      href={`/patients/follow-ups?test=${encodeURIComponent(a.canonicalName)}`}
                      className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm font-medium">{a.action}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="tabular-nums">{a.count}</Badge>
                        <ArrowRight className="size-3.5 text-muted-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Decision support based on guideline recall intervals — not a diagnosis. Final decisions rest with the
                treating clinician.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Population health — risk stratification + trend */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Risk stratification</CardTitle></CardHeader>
          <CardContent>
            {risk.total === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough biomarker data across the roster yet.</p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {RISK_META.map((m) => (
                  <div key={m.key} className="text-center">
                    <p className={`text-2xl font-semibold tabular-nums ${m.text}`}>{risk.counts[m.key]}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${m.bar}`} style={{ width: `${(risk.counts[m.key] / risk.total) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="size-4" /> Health trend</CardTitle></CardHeader>
          <CardContent>
            {trend.total === 0 ? (
              <p className="text-sm text-muted-foreground">Needs ≥2 results per patient.</p>
            ) : (
              <ul className="space-y-2.5">
                {([
                  { label: "Improving", n: trend.improving, cls: "bg-emerald-500" },
                  { label: "Stable",    n: trend.stable,    cls: "bg-muted-foreground/40" },
                  { label: "Declining", n: trend.declining, cls: "bg-red-500" },
                ]).map((t) => (
                  <li key={t.label}>
                    <div className="flex justify-between text-xs mb-1"><span>{t.label}</span><span className="tabular-nums">{t.n}</span></div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${t.cls}`} style={{ width: `${(t.n / trendTotal) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Organ health distribution — uses the biomarker→organ ontology */}
      {organs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Organ health distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {organs.map((o) => {
                const pct = (n: number) => Math.round((n / o.total) * 100);
                return (
                  <div key={o.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{o.total} pts</span>
                    </div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-muted" title={`Healthy ${pct(o.healthy)}% · Watch ${pct(o.watch)}% · Needs review ${pct(o.needsReview)}%`}>
                      <div className="bg-emerald-500" style={{ width: `${pct(o.healthy)}%` }} />
                      <div className="bg-amber-500" style={{ width: `${pct(o.watch)}%` }} />
                      <div className="bg-red-500" style={{ width: `${pct(o.needsReview)}%` }} />
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span>Healthy {pct(o.healthy)}%</span>
                      <span>Watch {pct(o.watch)}%</span>
                      <span>Needs review {pct(o.needsReview)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Needs-review queue */}
        <Card className="lg:col-span-2" id="needs-review">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="size-4" /> Needs-review queue
              {queue.length > 0 && <Badge variant="outline" className="ml-1">{queue.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to review. Clean extractions all round.</p>
            ) : (
              <ul className="divide-y">
                {queue.map((item) => (
                  <li key={item.reportId} className="py-2.5 flex items-center gap-3">
                    <QualityBadge quality={item.quality} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.uploadName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.patientName} · {item.testCount} tests · {fmtDate(item.createdAt)}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/patients/${item.patientId}`} />}>
                      Open <ArrowRight className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Referring doctors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Stethoscope className="size-4" /> Referring doctors
            </CardTitle>
          </CardHeader>
          <CardContent>
            {referrers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No referrals recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {referrers.map((d) => (
                  <li key={d.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{d.name}</span>
                    <Badge variant="outline" className="shrink-0 tabular-nums">{d.reports}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Volume & throughput */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume · last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1.5 h-32" role="img" aria-label="Daily report volume, last 14 days">
            {volume.map((v) => (
              <div key={v.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex items-end justify-center h-full">
                  <div
                    className="w-full max-w-8 rounded-t bg-primary/70 hover:bg-primary transition-colors"
                    style={{ height: `${(v.reports / maxVol) * 100}%`, minHeight: v.reports > 0 ? "4px" : "0" }}
                    title={`${v.date}: ${v.reports} report${v.reports !== 1 ? "s" : ""}`}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums">
                  {new Date(v.date).getDate()}
                </span>
              </div>
            ))}
          </div>
          {summary.reports30d === 0 && (
            <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> No reports yet — upload on behalf of a patient from their profile.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  icon, label, value, tone, href,
}: {
  icon: React.ReactNode; label: string; value: string; tone?: "warn"; href?: string;
}) {
  const inner = (
    <Card className={href ? "hover:bg-muted/50 transition-colors" : undefined}>
      <CardContent className="py-4">
        <div className={`flex items-center gap-1.5 text-xs ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
          {icon}{label}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

function UploadStatus({ status }: { status: string }) {
  const label = status === "ERROR" ? "Failed"
    : status === "NEEDS_REVIEW" ? "Needs review"
    : status === "READY" || status === "CONFIRMED" ? "Ready"
    : "Processing";
  const cls = status === "ERROR" ? "text-red-600 border-red-500/30 bg-red-500/10"
    : label === "Needs review" ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
    : label === "Ready" ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
    : "text-muted-foreground";
  return <Badge variant="outline" className={`shrink-0 ${cls}`}>{label}</Badge>;
}

function QualityBadge({ quality }: { quality: QualityScore }) {
  const cls =
    quality.band === "good"
      ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
      : quality.band === "fair"
      ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
      : "text-red-600 border-red-500/30 bg-red-500/10";
  return (
    <Badge variant="outline" className={`shrink-0 tabular-nums w-11 justify-center ${cls}`} title={`Quality ${quality.score}/100`}>
      {quality.score}
    </Badge>
  );
}
