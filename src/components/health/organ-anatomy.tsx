"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PersonStanding } from "lucide-react";

// One region = one svgRegionId, aggregating organ systems that map to it
// (e.g. pancreas + metabolic). Real data from getOrganPanels.
export type OrganMetric = {
  name: string;
  loinc: string | null;
  value: string;
  unit: string | null;
  refRange: string | null;
  interpretation: string;
  outOfRange: boolean;
};
export type RegionPanel = {
  regionId: string;
  organs: string[];
  outOfRange: number;
  total: number;
  metrics: OrganMetric[];
};

type Status = "healthy" | "watch" | "review" | "nodata";

function statusOf(r: RegionPanel | undefined): Status {
  if (!r || r.total === 0) return "nodata";
  if (r.outOfRange >= 2) return "review";
  if (r.outOfRange === 1) return "watch";
  return "healthy";
}

const COLORS: Record<Status, { fill: string; sel: string; stroke: string }> = {
  healthy: { fill: "#a7f3d0", sel: "#10b981", stroke: "#34d399" },
  watch:   { fill: "#fde68a", sel: "#f59e0b", stroke: "#f59e0b" },
  review:  { fill: "#fecaca", sel: "#ef4444", stroke: "#f87171" },
  nodata:  { fill: "#e2e8f0", sel: "#cbd5e1", stroke: "#94a3b8" },
};
const STATUS_LABEL: Record<Status, string> = { healthy: "Normal", watch: "Watch", review: "Needs review", nodata: "No data" };

const BODY_REGIONS = ["thyroid", "heart", "liver", "pancreas", "kidney", "bladder"];

export function OrganAnatomy({ regions, title = "Organ health" }: { regions: RegionPanel[]; title?: string }) {
  const byId = new Map(regions.map((r) => [r.regionId, r]));
  const [selected, setSelected] = useState<string | null>(null);

  const paint = (regionId: string) => {
    const r = byId.get(regionId);
    const c = COLORS[statusOf(r)];
    const isSel = selected === regionId;
    return { fill: isSel ? c.sel : c.fill, stroke: c.stroke, strokeWidth: isSel ? 2.5 : 1.25, cursor: r ? "pointer" : "default", opacity: r ? 1 : 0.5 } as const;
  };
  const onPick = (regionId: string) => byId.has(regionId) && setSelected((s) => (s === regionId ? null : regionId));

  const sel = selected ? byId.get(selected) : undefined;
  const systemic = regions.filter((r) => !BODY_REGIONS.includes(r.regionId));

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><PersonStanding className="size-4" /> {title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col items-center">
          {/* Realistic front-view human silhouette; organs layered on top. */}
          <svg viewBox="0 0 240 520" className="w-auto max-h-90" role="img" aria-label="Organ health map">
            <g fill="#eef2f7" stroke="#e2e8f0" strokeWidth="1.5">
              {/* head + neck */}
              <ellipse cx="120" cy="42" rx="25" ry="29" />
              <path d="M110,66 h20 v18 h-20 Z" />
              {/* torso: shoulders → waist → hips */}
              <path d="M86,92 C86,84 98,80 112,80 L128,80 C142,80 154,84 154,92 C166,118 160,180 150,236 C148,258 156,278 154,296 L86,296 C84,278 92,258 90,236 C80,180 74,118 86,92 Z" />
              {/* arms */}
              <path d="M88,98 C70,108 62,150 58,214 C57,224 68,226 72,217 C78,166 82,132 92,110 Z" />
              <path d="M152,98 C170,108 178,150 182,214 C183,224 172,226 168,217 C162,166 158,132 148,110 Z" />
              {/* legs */}
              <path d="M90,298 L116,298 C116,360 113,440 111,502 C110,512 98,512 96,502 C93,440 90,360 90,298 Z" />
              <path d="M124,298 L150,298 C150,360 147,440 144,502 C143,512 131,512 129,502 C127,440 124,360 124,298 Z" />
              {/* lungs — decorative, no organ maps here */}
              <path d="M104,112 C90,116 92,158 106,162 C110,144 110,120 104,112 Z" opacity="0.7" />
              <path d="M136,112 C150,116 148,158 134,162 C130,144 130,120 136,112 Z" opacity="0.7" />
            </g>

            {/* thyroid (butterfly, base of neck) */}
            <path d="M108,82 C112,78 118,80 120,84 C122,80 128,78 132,82 C130,90 124,90 120,88 C116,90 110,90 108,82 Z" {...paint("thyroid")} onClick={() => onPick("thyroid")}>
              <title>Thyroid — {STATUS_LABEL[statusOf(byId.get("thyroid"))]}</title>
            </path>
            {/* heart */}
            <path d="M120,128 C114,119 100,121 100,134 C100,148 120,160 120,160 C120,160 140,148 140,134 C140,121 126,119 120,128 Z" {...paint("heart")} onClick={() => onPick("heart")}>
              <title>Heart — {STATUS_LABEL[statusOf(byId.get("heart"))]}</title>
            </path>
            {/* liver */}
            <path d="M92,172 C92,164 138,167 150,174 C146,190 104,194 92,172 Z" {...paint("liver")} onClick={() => onPick("liver")}>
              <title>Liver — {STATUS_LABEL[statusOf(byId.get("liver"))]}</title>
            </path>
            {/* pancreas */}
            <path d="M98,196 C114,192 140,196 150,202 C141,211 112,209 98,203 Z" {...paint("pancreas")} onClick={() => onPick("pancreas")}>
              <title>Pancreas — {STATUS_LABEL[statusOf(byId.get("pancreas"))]}</title>
            </path>
            {/* kidneys (two lobes, same region) */}
            <g {...paint("kidney")} onClick={() => onPick("kidney")}>
              <path d="M98,216 C90,216 88,240 98,246 C106,242 106,220 98,216 Z" />
              <path d="M142,216 C150,216 152,240 142,246 C134,242 134,220 142,216 Z" />
              <title>Kidneys — {STATUS_LABEL[statusOf(byId.get("kidney"))]}</title>
            </g>
            {/* bladder (pelvis) */}
            <path d="M110,270 C110,262 130,262 130,270 C130,282 122,286 120,286 C118,286 110,282 110,270 Z" {...paint("bladder")} onClick={() => onPick("bladder")}>
              <title>Bladder / urinary — {STATUS_LABEL[statusOf(byId.get("bladder"))]}</title>
            </path>
          </svg>

          {/* legend */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground justify-center">
            {(["healthy", "watch", "review", "nodata"] as Status[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: COLORS[s].fill, outline: `1px solid ${COLORS[s].stroke}` }} /> {STATUS_LABEL[s]}</span>
            ))}
          </div>

          {/* systemic panels as chips */}
          {systemic.length > 0 && (
            <div className="mt-3 w-full">
              <div className="flex flex-wrap gap-1.5 justify-center">
                {systemic.map((r) => (
                  <button key={r.regionId} onClick={() => onPick(r.regionId)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${selected === r.regionId ? "bg-muted" : "hover:bg-muted/60"}`}>
                    <span className="size-1.5 rounded-full" style={{ background: COLORS[statusOf(r)].sel }} /> {r.organs[0]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* detail — appears below the body when an organ is selected */}
        {sel && (
          <div className="mt-4 border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold">{sel.organs.join(" · ")}</p>
                <p className="text-xs text-muted-foreground">
                  {sel.total} biomarker{sel.total !== 1 ? "s" : ""}
                  {sel.outOfRange > 0 && <span className="text-amber-600"> · {sel.outOfRange} out of range</span>}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
            </div>
            {sel.metrics.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No biomarkers extracted yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {sel.metrics.map((m) => (
                  <li key={m.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{m.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`tabular-nums ${m.outOfRange ? "text-amber-600 font-medium" : ""}`}>{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                      <Badge variant="outline" className={`text-[10px] ${m.outOfRange ? "text-amber-600 border-amber-500/30 bg-amber-500/10" : "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"}`}>
                        {m.interpretation === "HIGH" ? "High" : m.interpretation === "LOW" ? "Low" : m.outOfRange ? "Abnl" : "Normal"}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
