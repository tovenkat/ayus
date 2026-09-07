/**
 * Clinical Intelligence section — Care Flags (combination decision support) +
 * Disease Registries. Shared by the doctor and hospital dashboards. Server
 * component: fetches from lib/clinical-intelligence and renders.
 *
 * Decision support, not diagnosis — every flag shows its reason + suggested
 * action and links to the patient.
 */

import Link from "next/link";
import { AlertTriangle, Activity, ArrowRight, ClipboardList } from "lucide-react";
import {
  getCareFlags, summarizeFlags, getDiseaseRegistries,
  type Severity,
} from "@/lib/clinical-intelligence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEV_STYLE: Record<Severity, { badge: string; label: string }> = {
  critical: { badge: "text-red-600 border-red-500/40 bg-red-500/10", label: "Critical" },
  high:     { badge: "text-orange-600 border-orange-500/40 bg-orange-500/10", label: "High" },
  moderate: { badge: "text-amber-600 border-amber-500/40 bg-amber-500/10", label: "Moderate" },
  low:      { badge: "text-slate-500 border-slate-400/40 bg-slate-400/10", label: "Low" },
};

export async function ClinicalIntelligence({ orgId, flagLimit = 12 }: { orgId: string; flagLimit?: number }) {
  const [flags, registries] = await Promise.all([getCareFlags(orgId), getDiseaseRegistries(orgId)]);
  const summary = summarizeFlags(flags);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Care flags — the worklist */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4" /> Patients requiring review
            <span className="ml-1 flex gap-1">
              {summary.critical > 0 && <Badge variant="outline" className={SEV_STYLE.critical.badge}>{summary.critical} critical</Badge>}
              {summary.high > 0 && <Badge variant="outline" className={SEV_STYLE.high.badge}>{summary.high} high</Badge>}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decision-support flags across the panel.</p>
          ) : (
            <ul className="divide-y">
              {flags.slice(0, flagLimit).map((f, i) => (
                <li key={`${f.patientId}-${i}`} className="py-2.5 flex items-start gap-3">
                  <Badge variant="outline" className={`shrink-0 mt-0.5 ${SEV_STYLE[f.severity].badge}`}>{SEV_STYLE[f.severity].label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{f.title} <span className="text-muted-foreground font-normal">· {f.patientName}</span></p>
                    <p className="text-xs text-muted-foreground">{f.reason}</p>
                    <p className="text-xs text-primary/90 mt-0.5">→ {f.action}</p>
                  </div>
                  <Link href={`/patients/${f.patientId}`} className="text-primary text-xs hover:underline shrink-0 mt-0.5 inline-flex items-center gap-0.5">
                    Open <ArrowRight className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {flags.length > flagLimit && (
            <p className="text-xs text-muted-foreground mt-2">+{flags.length - flagLimit} more flags</p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="size-3" /> Guideline-based decision support — not a diagnosis. Clinical judgment applies.
          </p>
        </CardContent>
      </Card>

      {/* Disease registries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="size-4" /> Disease registries</CardTitle>
        </CardHeader>
        <CardContent>
          {registries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No registry cohorts yet.</p>
          ) : (
            <ul className="space-y-3">
              {registries.map((r) => {
                const atTarget = r.total - r.attention;
                const attnPct = Math.round((r.attention / r.total) * 100);
                return (
                  <li key={r.key}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {r.total} <span className="text-muted-foreground/70">·</span> <span className="text-amber-600">{r.attention} attn</span>
                      </span>
                    </div>
                    <div className="mt-1 flex h-2 rounded-full overflow-hidden bg-muted" title={`${r.attention} need attention, ${atTarget} at target`}>
                      <div className="bg-amber-500" style={{ width: `${attnPct}%` }} />
                      <div className="bg-emerald-500" style={{ width: `${100 - attnPct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
