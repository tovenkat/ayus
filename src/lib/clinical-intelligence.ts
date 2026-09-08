/**
 * Clinical intelligence for doctor / hospital orgs — computed at read-time from
 * the consented roster's biomarker history. Two headline capabilities:
 *
 *   1. Care Flags — COMBINATION findings + critical values + significant trends,
 *      not single abnormal results. This is decision support ("consider…"),
 *      never a diagnosis; every flag carries a transparent reason + action.
 *   2. Disease Registries — cohort classification (diabetes, CKD, thyroid,
 *      dyslipidemia, anemia, vit-D) with control status.
 *
 * Scoped to an org via GRANTED PatientLinks + org-attributed reports. O(roster);
 * at population scale this should be materialized nightly. Server-only.
 */

import { prisma } from "@/lib/prisma";

// ─── Shared: load latest + previous value per biomarker per patient ─────────

type Marker = {
  latest: number;
  prev: number | null;
  low: number | null;
  high: number | null;
  unit: string | null;
  date: Date | null;
  prevDate: Date | null;
  loincNum: string | null;   // provenance: coded identity of the source result
  reportId: string | null;   // provenance: which report it came from
  confidence: number | null; // validation: extraction confidence of the source
  plausibility: string | null; // validation: plausibility flag, if any
};
export type PatientMarkers = { patientId: string; name: string; markers: Map<string, Marker> };

async function loadOrgPatientMarkers(orgId: string): Promise<PatientMarkers[]> {
  const links = await prisma.patientLink.findMany({
    where: { organizationId: orgId, status: "GRANTED" },
    select: { patientId: true },
  });
  const ids = links.map((l) => l.patientId);
  if (ids.length === 0) return [];

  const [users, rows] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.testResult.findMany({
      where: { userId: { in: ids }, canonicalTestId: { not: null }, observedValueNumeric: { not: null } },
      orderBy: [{ userId: "asc" }, { canonicalTestId: "asc" }, { report: { sampleCollectedOn: "desc" } }, { createdAt: "desc" }],
      select: {
        userId: true, observedValueNumeric: true, referenceLow: true, referenceHigh: true, observedValueUnit: true,
        loincNum: true, confidence: true, plausibilityFlag: true,
        canonical: { select: { name: true } },
        report: { select: { id: true, sampleCollectedOn: true } },
      },
    }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name ?? "(unnamed)"]));

  // Group consecutive rows by (userId, canonicalName); first two = latest, prev.
  const byPatient = new Map<string, Map<string, Marker>>();
  let i = 0;
  while (i < rows.length) {
    const uid = rows[i].userId;
    const cname = rows[i].canonical?.name ?? "";
    const group: typeof rows = [];
    while (i < rows.length && rows[i].userId === uid && (rows[i].canonical?.name ?? "") === cname) {
      group.push(rows[i]); i++;
    }
    if (!cname) continue;
    const latest = group[0];
    const prev = group[1];
    const m = byPatient.get(uid) ?? new Map<string, Marker>();
    m.set(cname, {
      latest: latest.observedValueNumeric!,
      prev: prev?.observedValueNumeric ?? null,
      low: latest.referenceLow,
      high: latest.referenceHigh,
      unit: latest.observedValueUnit,
      date: latest.report?.sampleCollectedOn ?? null,
      prevDate: prev?.report?.sampleCollectedOn ?? null,
      loincNum: latest.loincNum ?? null,
      reportId: latest.report?.id ?? null,
      confidence: latest.confidence ?? null,
      plausibility: latest.plausibilityFlag ?? null,
    });
    byPatient.set(uid, m);
  }

  return ids
    .filter((id) => byPatient.has(id))
    .map((id) => ({ patientId: id, name: nameById.get(id) ?? "(unnamed)", markers: byPatient.get(id)! }));
}

// small predicates
const rising = (m?: Marker) => !!m && m.prev !== null && m.latest > m.prev;
const worseningAway = (m?: Marker) => {
  if (!m || m.prev === null) return false;
  const dist = (v: number) => (m.high !== null && v > m.high ? v - m.high : m.low !== null && v < m.low ? m.low - v : 0);
  return dist(m.latest) > dist(m.prev);
};
const fmt = (m: Marker) => `${m.latest}${m.unit ? " " + m.unit : ""}`;

// ─── Provenance: the exact source measurements behind a flag ─────────────────

const LOW_CONFIDENCE = 0.6;

export type Evidence = {
  test: string;
  value: number;
  unit: string | null;
  refRange: string | null;
  loincNum: string | null;
  date: string | null;
  trend: "rising" | "falling" | null;
  prevValue: number | null;
  prevDate: string | null;
  confidence: number | null;
  unverified: boolean; // low extraction confidence or a plausibility flag
};

function refRange(m: Marker): string | null {
  if (m.low !== null && m.high !== null) return `${m.low}–${m.high}`;
  if (m.high !== null) return `< ${m.high}`;
  if (m.low !== null) return `> ${m.low}`;
  return null;
}

/** Turn the markers a flag relied on into traceable, validated evidence. */
function buildEvidence(markers: Map<string, Marker>, tests: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const t of tests) {
    const m = markers.get(t);
    if (!m) continue;
    const trend = m.prev === null ? null : m.latest > m.prev ? "rising" : m.latest < m.prev ? "falling" : null;
    out.push({
      test: t,
      value: m.latest,
      unit: m.unit,
      refRange: refRange(m),
      loincNum: m.loincNum,
      date: m.date ? m.date.toISOString() : null,
      trend,
      prevValue: m.prev,
      prevDate: m.prevDate ? m.prevDate.toISOString() : null,
      confidence: m.confidence,
      unverified: (m.confidence !== null && m.confidence < LOW_CONFIDENCE) || !!m.plausibility,
    });
  }
  return out;
}

// ─── Care flags (combination CDS) ────────────────────────────────────────────

export type Severity = "critical" | "high" | "moderate" | "low";
export type CareFlag = {
  patientId: string;
  patientName: string;
  severity: Severity;
  title: string;
  reason: string;
  action: string;
  evidence: Evidence[];    // provenance — the source measurements behind this flag
  unverified: boolean;     // any evidence came from low-confidence extraction
};

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

/** Evaluate one patient's markers → zero or more care flags. */
function evaluatePatient(p: PatientMarkers): CareFlag[] {
  const g = (n: string) => p.markers.get(n);
  type RawFlag = Omit<CareFlag, "patientId" | "patientName" | "evidence" | "unverified"> & { tests: string[] };
  const flags: RawFlag[] = [];

  const hba1c = g("HbA1c");
  const creat = g("Creatinine");
  const alt = g("ALT");
  const hb = g("Hemoglobin");
  const ferr = g("Ferritin");
  const tsh = g("TSH");
  const ldl = g("LDL Cholesterol");
  const vitd = g("Vitamin D");

  // Critical values — immediate attention.
  if (creat && creat.latest >= 4)
    flags.push({ severity: "critical", title: "Critical renal impairment", reason: `Creatinine ${fmt(creat)}`, action: "Urgent nephrology review / assess for AKI.", tests: ["Creatinine"] });
  if (hb && hb.latest < 7)
    flags.push({ severity: "critical", title: "Severe anemia", reason: `Hemoglobin ${fmt(hb)}`, action: "Assess for bleeding; consider transfusion workup.", tests: ["Hemoglobin"] });
  if (hba1c && hba1c.latest >= 12)
    flags.push({ severity: "critical", title: "Critical hyperglycemia", reason: `HbA1c ${fmt(hba1c)}`, action: "Urgent glycemic review; rule out DKA symptoms.", tests: ["HbA1c"] });

  // Combination findings — the point of CDS.
  if (hba1c && hba1c.latest >= 8 && creat && (creat.latest > (creat.high ?? 1.3) || rising(creat)))
    flags.push({ severity: "high", title: "Diabetic nephropathy risk", reason: `HbA1c ${fmt(hba1c)}${rising(hba1c) ? " (worsening)" : ""} with creatinine ${fmt(creat)}${rising(creat) ? " (rising)" : ""}`, action: "Check ACR/eGFR; consider ACE-inhibitor/ARB and nephrology referral.", tests: ["HbA1c", "Creatinine"] });
  else if (hba1c && hba1c.latest >= 9)
    flags.push({ severity: "high", title: "Uncontrolled diabetes", reason: `HbA1c ${fmt(hba1c)}${rising(hba1c) ? " (worsening)" : ""}`, action: "Intensify glycemic control; review adherence and therapy.", tests: ["HbA1c"] });

  if (creat && creat.latest > (creat.high ?? 1.3) && rising(creat) && !(hba1c && hba1c.latest >= 8))
    flags.push({ severity: "high", title: "Progressive renal decline", reason: `Creatinine ${fmt(creat)} rising over consecutive reports`, action: "Trend eGFR; identify reversible causes; nephrology if sustained.", tests: ["Creatinine"] });

  if (alt && (alt.latest >= 150 || (alt.latest > (alt.high ?? 55) && rising(alt))))
    flags.push({ severity: "high", title: "Hepatocellular injury", reason: `ALT ${fmt(alt)}${alt.latest >= 150 ? " (>3× ULN)" : " and rising"}`, action: "Evaluate hepatitis/drug causes; repeat LFTs; hepatology if persistent.", tests: ["ALT"] });

  if (ferr && ferr.latest < 15 && hb && hb.latest < 12)
    flags.push({ severity: "moderate", title: "Iron-deficiency anemia", reason: `Ferritin ${fmt(ferr)} with hemoglobin ${fmt(hb)}`, action: "Start iron; investigate source of loss (GI/menstrual).", tests: ["Ferritin", "Hemoglobin"] });

  if (tsh && (tsh.latest > (tsh.high ?? 4.5) || tsh.latest < (tsh.low ?? 0.4)))
    flags.push({ severity: "moderate", title: tsh.latest > (tsh.high ?? 4.5) ? "Hypothyroidism" : "Thyrotoxicosis", reason: `TSH ${fmt(tsh)}${worseningAway(tsh) ? " (worsening)" : ""}`, action: "Confirm with free T4; titrate/again in 6–8 weeks.", tests: ["TSH"] });

  if (ldl && ldl.latest >= 160)
    flags.push({ severity: "moderate", title: "Severe dyslipidemia", reason: `LDL ${fmt(ldl)}`, action: "Assess ASCVD risk; initiate/intensify statin.", tests: ["LDL Cholesterol"] });

  if (vitd && vitd.latest < 20)
    flags.push({ severity: "low", title: "Vitamin D deficiency", reason: `Vitamin D ${fmt(vitd)}`, action: "Supplement (cholecalciferol); recheck in 12 weeks.", tests: ["Vitamin D"] });

  return flags.map(({ tests, ...f }): CareFlag => {
    const evidence = buildEvidence(p.markers, tests);
    return { ...f, patientId: p.patientId, patientName: p.name, evidence, unverified: evidence.some((e) => e.unverified) };
  });
}

export async function getCareFlags(orgId: string): Promise<CareFlag[]> {
  const patients = await loadOrgPatientMarkers(orgId);
  const flags = patients.flatMap(evaluatePatient);
  flags.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  return flags;
}

export type CareFlagSummary = { critical: number; high: number; moderate: number; low: number; patients: number };

export function summarizeFlags(flags: CareFlag[]): CareFlagSummary {
  const s: CareFlagSummary = { critical: 0, high: 0, moderate: 0, low: 0, patients: new Set(flags.map((f) => f.patientId)).size };
  for (const f of flags) s[f.severity]++;
  return s;
}

// ─── Disease registries ──────────────────────────────────────────────────────

export type RegistryMember = { patientId: string; name: string; value: string; status: "at_target" | "attention" };
export type Registry = {
  key: string;
  name: string;
  total: number;
  attention: number; // members needing attention (uncontrolled / out of range)
  members: RegistryMember[];
};

type RegistryDef = {
  key: string;
  name: string;
  /** returns null if not a member, else the member's value + status */
  classify: (m: Map<string, Marker>) => { value: string; status: "at_target" | "attention" } | null;
};

const REGISTRIES: RegistryDef[] = [
  {
    key: "diabetes", name: "Diabetes",
    classify: (m) => {
      const h = m.get("HbA1c"); if (!h || h.latest < 6.5) return null;
      return { value: `HbA1c ${fmt(h)}`, status: h.latest < 7 ? "at_target" : "attention" };
    },
  },
  {
    key: "ckd", name: "Chronic Kidney (CKD)",
    classify: (m) => {
      const c = m.get("Creatinine"); if (!c || c.latest <= (c.high ?? 1.3)) return null;
      return { value: `Creatinine ${fmt(c)}`, status: c.latest >= 2 ? "attention" : "attention" };
    },
  },
  {
    key: "thyroid", name: "Thyroid Disorder",
    classify: (m) => {
      const t = m.get("TSH"); if (!t) return null;
      const out = t.latest > (t.high ?? 4.5) || t.latest < (t.low ?? 0.4);
      if (!out) return null;
      return { value: `TSH ${fmt(t)}`, status: "attention" };
    },
  },
  {
    key: "dyslipidemia", name: "Dyslipidemia",
    classify: (m) => {
      const l = m.get("LDL Cholesterol"); if (!l || l.latest < 100) return null;
      return { value: `LDL ${fmt(l)}`, status: l.latest >= 130 ? "attention" : "at_target" };
    },
  },
  {
    key: "anemia", name: "Anemia",
    classify: (m) => {
      const h = m.get("Hemoglobin"); if (!h || h.latest >= 12) return null;
      return { value: `Hb ${fmt(h)}`, status: h.latest < 10 ? "attention" : "at_target" };
    },
  },
  {
    key: "vitd", name: "Vitamin D Deficiency",
    classify: (m) => {
      const v = m.get("Vitamin D"); if (!v || v.latest >= 30) return null;
      return { value: `${fmt(v)}`, status: v.latest < 20 ? "attention" : "at_target" };
    },
  },
];

export async function getDiseaseRegistries(orgId: string): Promise<Registry[]> {
  const patients = await loadOrgPatientMarkers(orgId);
  const out: Registry[] = [];
  for (const def of REGISTRIES) {
    const members: RegistryMember[] = [];
    for (const p of patients) {
      const hit = def.classify(p.markers);
      if (hit) members.push({ patientId: p.patientId, name: p.name, value: hit.value, status: hit.status });
    }
    if (members.length === 0) continue;
    members.sort((a, b) => (a.status === b.status ? 0 : a.status === "attention" ? -1 : 1));
    out.push({ key: def.key, name: def.name, total: members.length, attention: members.filter((x) => x.status === "attention").length, members });
  }
  return out.sort((a, b) => b.attention - a.attention || b.total - a.total);
}

// ─── Care gaps & screening ───────────────────────────────────────────────────
//
// Registries say who HAS a condition; care gaps say what MONITORING they're
// missing. A gap is a guideline-recommended test for a patient's condition that
// is either never on record ("missing") or overdue for repeat ("overdue").
// Continuity-of-care surface — evidence-based intervals, decision support only.

type MonitoringRule = { condition: string; test: string; intervalMonths: number; rationale: string };

const MONITORING: MonitoringRule[] = [
  { condition: "Diabetes", test: "Creatinine",       intervalMonths: 12, rationale: "annual kidney screen" },
  { condition: "Diabetes", test: "LDL Cholesterol",  intervalMonths: 12, rationale: "annual lipid profile" },
  { condition: "Diabetes", test: "HbA1c",            intervalMonths: 3,  rationale: "glycemic monitoring" },
  { condition: "CKD",      test: "Hemoglobin",       intervalMonths: 12, rationale: "anemia of CKD" },
  { condition: "CKD",      test: "Creatinine",       intervalMonths: 6,  rationale: "renal monitoring" },
  { condition: "Thyroid",  test: "TSH",              intervalMonths: 12, rationale: "thyroid monitoring" },
  { condition: "Dyslipidemia", test: "LDL Cholesterol", intervalMonths: 12, rationale: "lipid monitoring" },
];

function hasCondition(m: Map<string, Marker>, condition: string): boolean {
  const g = (n: string) => m.get(n);
  switch (condition) {
    case "Diabetes": { const h = g("HbA1c"); return !!h && h.latest >= 6.5; }
    case "CKD": { const c = g("Creatinine"); return !!c && c.latest > (c.high ?? 1.3); }
    case "Thyroid": { const t = g("TSH"); return !!t && (t.latest > (t.high ?? 4.5) || t.latest < (t.low ?? 0.4)); }
    case "Dyslipidemia": { const l = g("LDL Cholesterol"); return !!l && l.latest >= 100; }
    default: return false;
  }
}

const MS_PER_MONTH = 30.44 * 24 * 3.6e6;

export type CareGap = {
  patientId: string;
  patientName: string;
  test: string;
  condition: string;
  kind: "missing" | "overdue";
  monthsStale: number | null;
  rationale: string;
};

export async function getCareGaps(orgId: string): Promise<CareGap[]> {
  const patients = await loadOrgPatientMarkers(orgId);
  const now = Date.now();
  const gaps: CareGap[] = [];

  for (const p of patients) {
    // One gap per (patient, test) — prefer "missing", else the most overdue.
    const best = new Map<string, CareGap>();
    for (const rule of MONITORING) {
      if (!hasCondition(p.markers, rule.condition)) continue;
      const marker = p.markers.get(rule.test);
      let gap: CareGap | null = null;
      if (!marker) {
        gap = { patientId: p.patientId, patientName: p.name, test: rule.test, condition: rule.condition, kind: "missing", monthsStale: null, rationale: rule.rationale };
      } else if (marker.date) {
        const monthsStale = (now - marker.date.getTime()) / MS_PER_MONTH;
        if (monthsStale > rule.intervalMonths) {
          gap = { patientId: p.patientId, patientName: p.name, test: rule.test, condition: rule.condition, kind: "overdue", monthsStale: Math.round(monthsStale), rationale: rule.rationale };
        }
      }
      if (!gap) continue;
      const prev = best.get(rule.test);
      // missing beats overdue; between two overdue keep the staler one.
      if (!prev || (gap.kind === "missing" && prev.kind !== "missing") || (gap.kind === prev.kind && (gap.monthsStale ?? 0) > (prev.monthsStale ?? 0))) {
        best.set(rule.test, gap);
      }
    }
    gaps.push(...best.values());
  }

  // Missing first, then overdue by staleness.
  gaps.sort((a, b) => (a.kind === b.kind ? (b.monthsStale ?? 0) - (a.monthsStale ?? 0) : a.kind === "missing" ? -1 : 1));
  return gaps;
}

export type CareGapSummary = { test: string; missing: number; overdue: number; total: number };

/** Roll gaps up by test for the summary chips. */
export function summarizeGaps(gaps: CareGap[]): CareGapSummary[] {
  const byTest = new Map<string, CareGapSummary>();
  for (const g of gaps) {
    const s = byTest.get(g.test) ?? { test: g.test, missing: 0, overdue: 0, total: 0 };
    if (g.kind === "missing") s.missing++; else s.overdue++;
    s.total++;
    byTest.set(g.test, s);
  }
  return [...byTest.values()].sort((a, b) => b.total - a.total);
}
