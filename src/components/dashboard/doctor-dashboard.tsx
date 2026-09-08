/**
 * Doctor (clinic) dashboard — a clinical cockpit over the consented panel:
 * a prioritized care-flag worklist (combination decision support), disease
 * registries, and panel tiles. Reuses the roster + follow-up engines.
 */

import Link from "next/link";
import { Users, AlertTriangle, ClipboardCheck, CalendarClock, ArrowRight, Stethoscope } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getRosterOrg } from "@/lib/patient-roster";
import { getLabSummary } from "@/lib/lab-analytics";
import { getFollowUpSummary } from "@/lib/lab-population";
import { getCareFlags, summarizeFlags } from "@/lib/clinical-intelligence";
import { ClinicalIntelligence } from "./clinical-intelligence";
import { RecentConsults } from "./recent-consults";
import { Referrals } from "./referrals";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export async function DoctorDashboard() {
  const userId = await requireAuth();
  const org = await getRosterOrg(userId);
  if (!org) return null;

  const [orgRow, summary, followUp, flags] = await Promise.all([
    prisma.organization.findUnique({ where: { id: org.orgId }, select: { name: true } }),
    getLabSummary(org.orgId),
    getFollowUpSummary(org.orgId),
    getCareFlags(org.orgId),
  ]);
  const flagSummary = summarizeFlags(flags);
  const needAttention = flagSummary.critical + flagSummary.high;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Clinical cockpit</h1>
          <p className="text-sm text-muted-foreground mt-1">{orgRow?.name ?? "Your clinic"} · consented panel</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/patients" />}>
          <Users className="size-4" /> Patient panel
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={<Users className="size-4" />} label="Patients" value={String(summary.rosterCount)} />
        <Tile icon={<AlertTriangle className="size-4" />} label="Need review" value={String(needAttention)} tone={needAttention > 0 ? "warn" : undefined} sub={flagSummary.critical > 0 ? `${flagSummary.critical} critical` : undefined} />
        <Tile icon={<CalendarClock className="size-4" />} label="Overdue tests" value={String(followUp.missed)} tone={followUp.missed > 0 ? "warn" : undefined} />
        <Tile icon={<ClipboardCheck className="size-4" />} label="Reports to verify" value={String(summary.needsReview)} />
      </div>

      <ClinicalIntelligence orgId={org.orgId} />

      <Referrals orgId={org.orgId} />

      <RecentConsults orgId={org.orgId} />

      {flags.length === 0 && summary.rosterCount === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Stethoscope className="size-6 mx-auto mb-2 opacity-50" />
            No patients on your panel yet. Build your roster from <Link href="/patients" className="text-primary hover:underline">Patients</Link>, then results feed this cockpit.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string; tone?: "warn"; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`flex items-center gap-1.5 text-xs ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>{icon}{label}</div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <Badge variant="outline" className="mt-1 text-[10px] text-red-600 border-red-500/30 bg-red-500/10">{sub}</Badge>}
      </CardContent>
    </Card>
  );
}
