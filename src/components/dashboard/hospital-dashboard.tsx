/**
 * Hospital dashboard — institution-wide population health. Everything the
 * doctor cockpit surfaces (care flags + registries), plus cohort rollups:
 * risk stratification and organ-system distribution across the consented
 * population. Reuses the lab population-health engine.
 */

import Link from "next/link";
import { Users, AlertTriangle, HeartPulse, ClipboardCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getRosterOrg } from "@/lib/patient-roster";
import { getLabSummary } from "@/lib/lab-analytics";
import { getCareFlags, summarizeFlags } from "@/lib/clinical-intelligence";
import { getRiskStratification, getOrganDistribution, type RiskBucket } from "@/lib/lab-population-health";
import { ClinicalIntelligence } from "./clinical-intelligence";
import { RecentConsults } from "./recent-consults";
import { Referrals } from "./referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const RISK_META: { key: RiskBucket; label: string; text: string; bar: string }[] = [
  { key: "low",      label: "Low",      text: "text-emerald-600", bar: "bg-emerald-500" },
  { key: "moderate", label: "Moderate", text: "text-amber-600",   bar: "bg-amber-500" },
  { key: "high",     label: "High",     text: "text-orange-600",  bar: "bg-orange-500" },
  { key: "critical", label: "Critical", text: "text-red-600",     bar: "bg-red-500" },
];

export async function HospitalDashboard() {
  const userId = await requireAuth();
  const org = await getRosterOrg(userId);
  if (!org) return null;

  const [orgRow, summary, flags, risk, organs] = await Promise.all([
    prisma.organization.findUnique({ where: { id: org.orgId }, select: { name: true } }),
    getLabSummary(org.orgId),
    getCareFlags(org.orgId),
    getRiskStratification(org.orgId),
    getOrganDistribution(org.orgId),
  ]);
  const s = summarizeFlags(flags);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Population Health</h1>
          <p className="text-sm text-muted-foreground mt-1">{orgRow?.name ?? "Your hospital"} · institution-wide</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/patients" />}>
          <Users className="size-4" /> Patient registry
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={<Users className="size-4" />} label="Patients" value={String(summary.rosterCount)} />
        <Tile icon={<AlertTriangle className="size-4" />} label="Critical" value={String(s.critical)} tone={s.critical > 0 ? "crit" : undefined} />
        <Tile icon={<HeartPulse className="size-4" />} label="High-risk" value={String(risk.counts.high + risk.counts.critical)} tone="warn" />
        <Tile icon={<ClipboardCheck className="size-4" />} label="To verify" value={String(summary.needsReview)} />
      </div>

      <ClinicalIntelligence orgId={org.orgId} />

      <Referrals orgId={org.orgId} />

      <RecentConsults orgId={org.orgId} />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Risk stratification */}
        <Card>
          <CardHeader><CardTitle className="text-base">Risk stratification</CardTitle></CardHeader>
          <CardContent>
            {risk.total === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough data yet.</p>
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

        {/* Organ distribution */}
        <Card>
          <CardHeader><CardTitle className="text-base">Organ-system health</CardTitle></CardHeader>
          <CardContent>
            {organs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organ data yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {organs.slice(0, 6).map((o) => {
                  const pct = (n: number) => Math.round((n / o.total) * 100);
                  return (
                    <li key={o.key}>
                      <div className="flex justify-between text-sm mb-1"><span className="font-medium">{o.name}</span><span className="text-xs text-muted-foreground tabular-nums">{o.total}</span></div>
                      <div className="flex h-2 rounded-full overflow-hidden bg-muted" title={`Healthy ${pct(o.healthy)}% · Watch ${pct(o.watch)}% · Review ${pct(o.needsReview)}%`}>
                        <div className="bg-emerald-500" style={{ width: `${pct(o.healthy)}%` }} />
                        <div className="bg-amber-500" style={{ width: `${pct(o.watch)}%` }} />
                        <div className="bg-red-500" style={{ width: `${pct(o.needsReview)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "warn" | "crit" }) {
  const t = tone === "crit" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`flex items-center gap-1.5 text-xs ${t}`}>{icon}{label}</div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
