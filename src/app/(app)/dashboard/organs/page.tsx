import Link from "next/link";
import { requireAuth } from "@/lib/auth-helpers";
import { getAccountKind, hasPatientRoster } from "@/lib/account-kind";
import { getOrganPanels, type OrganPanelResult } from "@/lib/organ-queries";
import { OrganAnatomySection } from "@/components/health/organ-anatomy-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { H1, Muted } from "@/components/ui/typography";
import {
  Droplets, Leaf, Zap, Heart, Activity, Droplet, TestTube, Waves, GlassWater,
  Bone, Shield, Apple, Atom, Flame, Blend,
  ArrowRight, TrendingDown, TrendingUp, Minus,
} from "lucide-react";

export const metadata = { title: "Organ view — Ayus" };

const ICON_MAP: Record<string, typeof Heart> = {
  Heart, Droplets, Leaf, Zap, Activity, Droplet, TestTube, Waves, Cup: GlassWater,
  Bone, Shield, Apple, Atom, Flame, Blend,
};

function relativeDate(d: Date | null): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function trendIcon(history: OrganPanelResult["history"]) {
  const numeric = history.filter((h) => h.valueNumeric !== null).slice(0, 3);
  if (numeric.length < 2) return Minus;
  const [latest, prev] = numeric;
  if (latest.valueNumeric === null || prev.valueNumeric === null) return Minus;
  if (latest.valueNumeric > prev.valueNumeric * 1.05) return TrendingUp;
  if (latest.valueNumeric < prev.valueNumeric * 0.95) return TrendingDown;
  return Minus;
}

export default async function OrganDashboardPage() {
  const userId = await requireAuth();

  // Roster accounts (lab/doctor/hospital) have no personal health data — the
  // organ view is per-patient. Point them to a patient instead of the empty
  // "upload a report" message meant for individuals.
  const kind = await getAccountKind(userId);
  if (hasPatientRoster(kind)) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <H1 className="text-3xl">Organ view</H1>
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <p className="font-medium">Organ view is per-patient</p>
            <Muted>
              Your account manages other people&apos;s records. Open a patient from your roster to
              see their interactive organ map with biomarkers grouped by system.
            </Muted>
            <Button nativeButton={false} render={<Link href="/patients" />}>
              <Users className="size-4" /> Go to patients
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const panels = await getOrganPanels(userId);

  if (panels.length === 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <H1 className="text-3xl">Organ view</H1>
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <p className="font-medium">No organ-grouped results yet.</p>
            <Muted>
              Upload a lab report and the biomarkers will be grouped by organ system here. If you
              already have reports, they may not be linked yet — run{" "}
              <code className="text-xs px-1 py-0.5 rounded bg-muted">npm run biomarkers:backfill</code>{" "}
              to link historical results.
            </Muted>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-baseline justify-between">
        <H1 className="text-3xl">Organ view</H1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← back to overview
        </Link>
      </div>

      {/* Interactive anatomy — organs colored by real health status */}
      <OrganAnatomySection userId={userId} />

      <div className="grid gap-4 md:grid-cols-2">
        {panels.map((panel) => {
          const Icon = ICON_MAP[panel.icon] ?? Heart;
          return (
            <Card key={panel.key} id={`organ-${panel.key}`} className="overflow-hidden scroll-mt-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Icon className="size-5 text-primary" />
                    {panel.name}
                  </span>
                  {panel.outOfRangeCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {panel.outOfRangeCount} out of range
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {panel.results.map((r) => {
                  const Trend = trendIcon(r.history);
                  return (
                    <Link
                      key={r.canonicalId}
                      href={`/reports/${r.latest.reportId}`}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition ${
                        r.latest.isOutOfRange ? "bg-destructive/5" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{r.canonicalName}</div>
                        <Muted className="text-xs">
                          {r.latest.referenceLow != null && r.latest.referenceHigh != null
                            ? `ref: ${r.latest.referenceLow}–${r.latest.referenceHigh} ${r.latest.referenceUnit ?? ""}`
                            : "no reference range"}
                          {" · "}
                          {relativeDate(r.latest.sampleCollectedOn)}
                          {r.history.length > 1 ? ` · ${r.history.length} readings` : ""}
                        </Muted>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-mono font-semibold ${
                            r.latest.isOutOfRange ? "text-destructive" : ""
                          }`}
                        >
                          {r.latest.valueRaw}
                          {r.latest.unit ? <span className="ml-1 text-xs font-normal text-muted-foreground">{r.latest.unit}</span> : null}
                        </div>
                      </div>
                      <Trend className="size-3.5 ml-2 text-muted-foreground shrink-0" />
                      <ArrowRight className="size-3.5 ml-1 text-muted-foreground/50 shrink-0" />
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center pt-2">
        Only tests linked to a canonical biomarker appear here. Unresolved test names:{" "}
        <code className="text-[10px] px-1 py-0.5 rounded bg-muted">npm run biomarkers:unresolved</code>
      </p>
    </div>
  );
}
