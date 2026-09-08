"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// One region = one svgRegionId, aggregating any organ systems that map to it
// (e.g. pancreas + metabolic both map to "pancreas"). Real data, from
// getOrganPanels → serialized by the server wrapper.
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

// Status → { base fill, selected fill, stroke }. Fixed semantic hues so the
// meaning is stable in both themes.
const COLORS: Record<Status, { fill: string; sel: string; stroke: string }> = {
  healthy: { fill: "#a7f3d0", sel: "#10b981", stroke: "#34d399" },
  watch:   { fill: "#fde68a", sel: "#f59e0b", stroke: "#f59e0b" },
  review:  { fill: "#fecaca", sel: "#ef4444", stroke: "#f87171" },
  nodata:  { fill: "#e2e8f0", sel: "#cbd5e1", stroke: "#94a3b8" },
};
const STATUS_LABEL: Record<Status, string> = { healthy: "Normal", watch: "Watch", review: "Needs review", nodata: "No data" };

// Region ids that get an anatomical shape on the body; the rest render as chips.
const BODY_REGIONS = ["thyroid", "heart", "liver", "pancreas", "kidney", "bladder"];

export function OrganAnatomy({ regions }: { regions: RegionPanel[] }) {
  const byId = new Map(regions.map((r) => [r.regionId, r]));
  const [selected, setSelected] = useState<string | null>(null);

  const paint = (regionId: string) => {
    const r = byId.get(regionId);
    const c = COLORS[statusOf(r)];
    const isSel = selected === regionId;
    return {
      fill: isSel ? c.sel : c.fill,
      stroke: c.stroke,
      strokeWidth: isSel ? 3 : 1.5,
      cursor: r ? "pointer" : "default",
      opacity: r ? 1 : 0.55,
    } as const;
  };
  const onPick = (regionId: string) => byId.has(regionId) && setSelected((s) => (s === regionId ? null : regionId));

  const sel = selected ? byId.get(selected) : undefined;
  const systemic = regions.filter((r) => !BODY_REGIONS.includes(r.regionId));

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      {/* ── Anatomy ── */}
      <Card>
        <CardContent className="py-5 flex flex-col items-center">
          <svg viewBox="0 0 240 470" className="w-auto max-h-[440px]" role="img" aria-label="Organ health map">
            {/* body silhouette */}
            <path d="M120,18 C150,18 162,42 160,66 C158,84 176,96 186,128 C198,166 190,250 176,300 C170,322 168,430 150,455 C140,455 134,360 120,360 C106,360 100,455 90,455 C72,430 70,322 64,300 C50,250 42,166 54,128 C64,96 82,84 80,66 C78,42 90,18 120,18 Z"
              fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="2" />
            {/* lungs — decorative, no organ maps here */}
            <path d="M96,120 C82,122 84,168 100,172 C104,150 104,128 96,120 Z M144,120 C158,122 156,168 140,172 C136,150 136,128 144,120 Z" fill="#eef2f7" stroke="#e2e8f0" strokeWidth="1" />

            {/* thyroid (neck) */}
            <path d="M108,70 C112,66 128,66 132,70 C130,80 122,82 120,82 C118,82 110,80 108,70 Z" {...paint("thyroid")} onClick={() => onPick("thyroid")}>
              <title>Thyroid — {STATUS_LABEL[statusOf(byId.get("thyroid"))]}</title>
            </path>
            {/* heart */}
            <path d="M120,150 C114,140 98,142 98,156 C98,170 120,182 120,182 C120,182 142,170 142,156 C142,142 126,140 120,150 Z" {...paint("heart")} onClick={() => onPick("heart")}>
              <title>Heart — {STATUS_LABEL[statusOf(byId.get("heart"))]}</title>
            </path>
            {/* liver */}
            <path d="M82,196 C82,186 132,190 146,198 C142,216 96,220 82,196 Z" {...paint("liver")} onClick={() => onPick("liver")}>
              <title>Liver — {STATUS_LABEL[statusOf(byId.get("liver"))]}</title>
            </path>
            {/* pancreas */}
            <path d="M92,224 C110,220 138,224 150,230 C140,240 108,238 92,232 Z" {...paint("pancreas")} onClick={() => onPick("pancreas")}>
              <title>Pancreas — {STATUS_LABEL[statusOf(byId.get("pancreas"))]}</title>
            </path>
            {/* kidneys (two lobes, same region) */}
            <g {...paint("kidney")} onClick={() => onPick("kidney")}>
              <path d="M92,250 C84,250 82,276 92,282 C100,278 100,254 92,250 Z" />
              <path d="M148,250 C156,250 158,276 148,282 C140,278 140,254 148,250 Z" />
              <title>Kidneys — {STATUS_LABEL[statusOf(byId.get("kidney"))]}</title>
            </g>
            {/* bladder (pelvis) */}
            <path d="M108,318 C108,310 132,310 132,318 C132,330 122,334 120,334 C118,334 108,330 108,318 Z" {...paint("bladder")} onClick={() => onPick("bladder")}>
              <title>Bladder / urinary — {STATUS_LABEL[statusOf(byId.get("bladder"))]}</title>
            </path>
          </svg>

          {/* legend */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground justify-center">
            {(["healthy", "watch", "review", "nodata"] as Status[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: COLORS[s].fill, outline: `1px solid ${COLORS[s].stroke}` }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </div>

          {/* systemic panels (no anatomical location) as chips */}
          {systemic.length > 0 && (
            <div className="mt-4 w-full">
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Systemic panels</p>
              <div className="flex flex-wrap gap-1.5">
                {systemic.map((r) => {
                  const st = statusOf(r);
                  return (
                    <button key={r.regionId} onClick={() => onPick(r.regionId)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${selected === r.regionId ? "bg-muted" : "hover:bg-muted/60"}`}>
                      <span className="size-2 rounded-full" style={{ background: COLORS[st].sel }} />
                      {r.organs[0]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Detail ── */}
      <Card>
        <CardContent className="py-5">
          {!sel ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm font-medium mb-1">Select an organ</p>
              <p className="text-xs">Click a highlighted organ or a systemic panel to see its biomarkers.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b pb-2.5 mb-3">
                <div>
                  <h3 className="font-semibold">{sel.organs.join(" · ")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {sel.total} biomarker{sel.total !== 1 ? "s" : ""}
                    {sel.outOfRange > 0 && <span className="text-amber-600"> · {sel.outOfRange} out of range</span>}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
              </div>
              {sel.metrics.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No biomarkers extracted for this system yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {sel.metrics.map((m) => (
                    <li key={m.name} className={`rounded-lg border p-3 ${m.outOfRange ? "border-amber-500/30 bg-amber-500/5" : "border-border"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{m.name}</span>
                        {m.loinc && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">LOINC {m.loinc}</span>}
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className={`text-xl font-semibold tabular-nums ${m.outOfRange ? "text-amber-600" : ""}`}>{m.value}</span>
                        {m.unit && <span className="text-xs text-muted-foreground">{m.unit}</span>}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground border-t border-dashed pt-1.5">
                        <span>Ref: {m.refRange ?? "—"}</span>
                        <Badge variant="outline" className={m.outOfRange ? "text-amber-600 border-amber-500/30 bg-amber-500/10" : "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"}>
                          {m.interpretation === "HIGH" ? "High" : m.interpretation === "LOW" ? "Low" : m.outOfRange ? "Abnormal" : "Normal"}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
