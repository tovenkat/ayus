/**
 * Server wrapper for the interactive organ anatomy. Pulls real per-organ panels
 * (getOrganPanels) and groups them by svgRegionId — the field on OrganSystem
 * designed for exactly this SVG mapping — into the shape the client renders.
 *
 * Pass a userId to render another patient's map (e.g. on /patients/[id]);
 * defaults to the signed-in user.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { getOrganPanels } from "@/lib/organ-queries";
import { OrganAnatomy, type RegionPanel, type OrganMetric } from "./organ-anatomy";

function fmtRange(low: number | null, high: number | null): string | null {
  if (low !== null && high !== null) return `${low} – ${high}`;
  if (high !== null) return `< ${high}`;
  if (low !== null) return `> ${low}`;
  return null;
}

/** Build the serializable region panels for a user (reused by the client shell). */
export async function getOrganRegions(userId: string): Promise<RegionPanel[]> {
  const panels = await getOrganPanels(userId);

  // Group organ systems that share an svgRegionId (e.g. pancreas + metabolic).
  const byRegion = new Map<string, { organs: Set<string>; metrics: Map<string, OrganMetric> }>();
  for (const p of panels) {
    const g = byRegion.get(p.svgRegionId) ?? { organs: new Set<string>(), metrics: new Map<string, OrganMetric>() };
    g.organs.add(p.name);
    for (const r of p.results) {
      if (g.metrics.has(r.canonicalName)) continue; // dedup across shared region
      g.metrics.set(r.canonicalName, {
        name: r.canonicalName,
        loinc: r.latest.loincNum,
        value: r.latest.valueRaw,
        unit: r.latest.unit,
        refRange: fmtRange(r.latest.referenceLow, r.latest.referenceHigh),
        interpretation: r.latest.interpretation,
        outOfRange: r.latest.isOutOfRange,
      });
    }
    byRegion.set(p.svgRegionId, g);
  }

  return [...byRegion.entries()].map(([regionId, g]) => {
    const metrics = [...g.metrics.values()];
    return {
      regionId,
      organs: [...g.organs],
      metrics,
      total: metrics.length,
      outOfRange: metrics.filter((m) => m.outOfRange).length,
    };
  });
}

export async function OrganAnatomySection({ userId }: { userId?: string }) {
  const uid = userId ?? (await requireAuth());
  const regions = await getOrganRegions(uid);
  if (regions.length === 0) return null;
  return <OrganAnatomy regions={regions} />;
}
