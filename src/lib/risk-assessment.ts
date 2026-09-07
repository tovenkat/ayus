import { prisma } from "@/lib/prisma";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "SUPER";

export type BiomarkerRisk = {
  name: string;
  value: string;
  unit: string | null;
  interpretation: string;
  level: RiskLevel;
  rationale: string;
  recoveryEstimate: string;
};

export type RecoveryMilestone = {
  label: string;
  weekOffset: number;
  kind: "now" | "check" | "milestone" | "target";
};

export type RecoveryPlan = {
  totalMonthsMin: number;
  totalMonthsMax: number;
  reassessInWeeks: number;
  nextSteps: string[];
  milestones: RecoveryMilestone[];
};

export type RiskSummary = {
  overall: RiskLevel;
  overallRationale: string;
  recoveryTimeframe: string;
  recoveryPlan: RecoveryPlan;
  counts: Record<RiskLevel, number>;
  breakdown: BiomarkerRisk[];
  totalBiomarkers: number;
};

// ─── SUPER-risk thresholds (medical-emergency territory) ─────────────────────
// Match rule → SUPER level when value crosses this line.

type CriticalRule = {
  match: RegExp;
  high?: number;
  low?: number;
  label: string;
};

const SUPER_RULES: CriticalRule[] = [
  { match: /\bHbA1c\b/i, high: 9, label: "HbA1c ≥ 9%" },
  { match: /\bFasting\s*Glucose\b|^Glucose\b/i, high: 250, low: 54, label: "Glucose critical" },
  { match: /\bCreatinine\b/i, high: 2.5, label: "Creatinine ≥ 2.5" },
  { match: /\beGFR\b/i, low: 30, label: "eGFR < 30" },
  { match: /\bPotassium\b/i, high: 6.0, low: 3.0, label: "Potassium critical" },
  { match: /\bSodium\b/i, high: 155, low: 128, label: "Sodium critical" },
  { match: /\bHemoglobin\b|^Hb\b/i, low: 7, label: "Severe anemia" },
  { match: /\bPlatelet/i, low: 50, label: "Very low platelets" },
  { match: /\bLDL\b/i, high: 220, label: "LDL ≥ 220" },
  { match: /\bTriglycerides?\b/i, high: 500, label: "Triglycerides ≥ 500" },
  { match: /\bTSH\b/i, high: 20, low: 0.01, label: "TSH critical" },
  { match: /\bALT\b|\bSGPT\b/i, high: 150, label: "ALT severely elevated" },
  { match: /\bAST\b|\bSGOT\b/i, high: 150, label: "AST severely elevated" },
  { match: /\bBilirubin\b/i, high: 5, label: "Bilirubin ≥ 5" },
];

function matchSuperRule(name: string): CriticalRule | null {
  return SUPER_RULES.find((r) => r.match.test(name)) ?? null;
}

// ─── Recovery estimates per biomarker + risk level ──────────────────────────

const RECOVERY_ESTIMATES: Record<RiskLevel, string> = {
  LOW: "Maintain — reassess in 6 months",
  MEDIUM: "3–6 months with lifestyle changes",
  HIGH: "6–12 months with treatment + lifestyle",
  SUPER: "Requires medical intervention — recovery depends on clinical plan",
};

// Biomarker-specific recovery hints override the generic ones
function recoveryForBiomarker(name: string, level: RiskLevel): string {
  const n = name.toLowerCase();
  if (level === "LOW") return RECOVERY_ESTIMATES.LOW;
  if (level === "SUPER") return RECOVERY_ESTIMATES.SUPER;

  if (/hba1c|glucose/.test(n)) {
    return level === "MEDIUM" ? "3 months of diet + exercise to lower by 0.5–1%" : "6–9 months with medication + diet + exercise";
  }
  if (/ldl|cholesterol|triglycer/.test(n)) {
    return level === "MEDIUM" ? "3 months of low-fat diet + exercise" : "6 months with statin/diet; recheck lipid panel quarterly";
  }
  if (/vitamin\s*d|25-?oh/.test(n)) {
    return "6–8 weeks of supplementation (60k IU weekly)";
  }
  if (/vitamin\s*b12|b12/.test(n)) {
    return "2–3 months of oral / IM B12 supplementation";
  }
  if (/hemoglobin|^hb\b|ferritin|iron/.test(n)) {
    return level === "MEDIUM" ? "2–3 months of iron supplementation" : "3–6 months of iron + diet; investigate cause";
  }
  if (/tsh|thyroid|t3|t4/.test(n)) {
    return "6 weeks after dose adjustment, retest";
  }
  if (/uric\s*acid/.test(n)) {
    return "3 months of low-purine diet + hydration";
  }
  if (/creatinine|egfr/.test(n)) {
    return "Slow to recover — 3–6 months with BP/diabetes control, low-protein diet";
  }
  if (/alt|ast|sgpt|sgot|bilirubin/.test(n)) {
    return "3–6 months with no alcohol + liver-friendly diet";
  }
  return RECOVERY_ESTIMATES[level];
}

// ─── Classify one biomarker ─────────────────────────────────────────────────

function classifyBiomarker(
  t: {
    normalizedName: string;
    observedValueRaw: string;
    observedValueNumeric: number | null;
    observedValueUnit: string | null;
    interpretation: string;
    isOutOfRange: boolean;
    referenceLow: number | null;
    referenceHigh: number | null;
  },
  prevNumeric: number | null,
  prevOutOfRange: boolean | null,
): BiomarkerRisk {
  const rule = matchSuperRule(t.normalizedName);
  const num = t.observedValueNumeric;

  let level: RiskLevel = "LOW";
  let rationale = "Within reference range.";

  // SUPER — critical thresholds
  if (rule && num !== null) {
    if (rule.high !== undefined && num >= rule.high) {
      level = "SUPER";
      rationale = `${rule.label} (${t.observedValueRaw}${t.observedValueUnit ?? ""}) — medical urgency.`;
    } else if (rule.low !== undefined && num <= rule.low) {
      level = "SUPER";
      rationale = `${rule.label} (${t.observedValueRaw}${t.observedValueUnit ?? ""}) — medical urgency.`;
    }
  }

  if (level !== "SUPER" && t.isOutOfRange) {
    // HIGH vs MEDIUM depends on how far from the reference edge + whether it's worsening
    let severity = 1; // 1 = mild (MEDIUM), 2 = significant (HIGH)
    if (num !== null && t.referenceLow !== null && num < t.referenceLow) {
      const ratio = (t.referenceLow - num) / Math.max(Math.abs(t.referenceLow), 0.01);
      if (ratio >= 0.3) severity = 2;
    }
    if (num !== null && t.referenceHigh !== null && num > t.referenceHigh) {
      const ratio = (num - t.referenceHigh) / Math.max(Math.abs(t.referenceHigh), 0.01);
      if (ratio >= 0.3) severity = 2;
    }
    // Worsening trend also bumps severity
    if (num !== null && prevNumeric !== null && prevOutOfRange) {
      const worsening =
        (t.interpretation === "HIGH" && num > prevNumeric) ||
        (t.interpretation === "LOW" && num < prevNumeric);
      const changePct = Math.abs(num - prevNumeric) / Math.max(Math.abs(prevNumeric), 0.01);
      if (worsening && changePct >= 0.15) severity = 2;
    }
    level = severity === 2 ? "HIGH" : "MEDIUM";
    rationale =
      severity === 2
        ? `${t.interpretation} and ${num !== null && prevNumeric !== null && num !== prevNumeric ? "trending worse" : "significantly past reference"} (${t.observedValueRaw}${t.observedValueUnit ?? ""}).`
        : `Mildly ${t.interpretation.toLowerCase()} (${t.observedValueRaw}${t.observedValueUnit ?? ""}) — typically manageable with lifestyle.`;
  }

  return {
    name: t.normalizedName,
    value: t.observedValueRaw,
    unit: t.observedValueUnit,
    interpretation: t.interpretation,
    level,
    rationale,
    recoveryEstimate: recoveryForBiomarker(t.normalizedName, level),
  };
}

// ─── Build the summary ──────────────────────────────────────────────────────

export async function buildRiskSummary(userId: string): Promise<RiskSummary> {
  const rows = await prisma.testResult.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      normalizedName: true,
      observedValueRaw: true,
      observedValueNumeric: true,
      observedValueUnit: true,
      interpretation: true,
      isOutOfRange: true,
      referenceLow: true,
      referenceHigh: true,
      createdAt: true,
    },
  });

  // Keep most-recent reading per biomarker + previous for trend comparison
  const latestByName = new Map<string, (typeof rows)[number]>();
  const previousByName = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.normalizedName.toLowerCase();
    if (!latestByName.has(key)) {
      latestByName.set(key, r);
    } else if (!previousByName.has(key)) {
      previousByName.set(key, r);
    }
  }

  const breakdown: BiomarkerRisk[] = [];
  for (const latest of latestByName.values()) {
    const prev = previousByName.get(latest.normalizedName.toLowerCase());
    breakdown.push(classifyBiomarker(latest, prev?.observedValueNumeric ?? null, prev?.isOutOfRange ?? null));
  }

  // Sort by severity descending so UI shows worst first
  const severityRank: Record<RiskLevel, number> = { SUPER: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  breakdown.sort((a, b) => severityRank[b.level] - severityRank[a.level]);

  const counts: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, SUPER: 0 };
  for (const b of breakdown) counts[b.level]++;

  // Overall risk = max level present
  let overall: RiskLevel = "LOW";
  if (counts.SUPER > 0) overall = "SUPER";
  else if (counts.HIGH > 0) overall = "HIGH";
  else if (counts.MEDIUM > 0) overall = "MEDIUM";

  const overallRationale = (() => {
    if (overall === "LOW") return "All biomarkers are within reference ranges. Keep up the routine.";
    const top = breakdown.filter((b) => b.level === overall).slice(0, 3).map((b) => b.name).join(", ");
    if (overall === "SUPER") return `Critical values in: ${top}. Seek medical care.`;
    if (overall === "HIGH") return `Significantly abnormal: ${top}. Structured treatment + diet plan recommended.`;
    return `Mildly out of range: ${top}. Lifestyle adjustments should bring these back.`;
  })();

  const recoveryTimeframe = RECOVERY_ESTIMATES[overall];
  const recoveryPlan = buildRecoveryPlan(overall, breakdown);

  return {
    overall,
    overallRationale,
    recoveryTimeframe,
    recoveryPlan,
    counts,
    breakdown,
    totalBiomarkers: breakdown.length,
  };
}

function buildRecoveryPlan(overall: RiskLevel, breakdown: BiomarkerRisk[]): RecoveryPlan {
  const concerningNames = breakdown.filter((b) => b.level !== "LOW").map((b) => b.name.toLowerCase()).join(" ");
  const steps: string[] = [];

  if (/hba1c|glucose/.test(concerningNames)) {
    steps.push("Switch to low-GI grains (ragi, bajra, jowar) and cut refined sugar.");
    steps.push("30-min brisk walk after dinner, 5 days a week.");
  }
  if (/ldl|cholesterol|triglycer/.test(concerningNames)) {
    steps.push("Replace ghee-heavy fried items with oats, flax, or steamed options.");
  }
  if (/vitamin\s*d/.test(concerningNames)) {
    steps.push("60k IU Vitamin D weekly × 8 weeks + 15 min morning sun daily.");
  }
  if (/b12/.test(concerningNames)) {
    steps.push("B12 supplementation (oral / IM) — confirm dose with your doctor.");
  }
  if (/hemoglobin|\bhb\b|ferritin|iron/.test(concerningNames)) {
    steps.push("Iron-rich foods: palak, methi, dates, ragi. Pair with vitamin C.");
  }
  if (/tsh|thyroid/.test(concerningNames)) {
    steps.push("Take thyroxine 1 hour before breakfast; avoid calcium within 4 hours.");
  }
  if (/uric\s*acid/.test(concerningNames)) {
    steps.push("Low-purine diet — limit red meat, seafood, heavy spinach, alcohol.");
  }
  if (/creatinine|egfr/.test(concerningNames)) {
    steps.push("Moderate protein + low-sodium diet; stay well-hydrated; control BP.");
  }
  if (/alt|ast|sgpt|sgot|bilirubin/.test(concerningNames)) {
    steps.push("No alcohol for 3+ months; liver-friendly diet.");
  }

  if (steps.length === 0) {
    if (overall === "LOW") steps.push("Maintain your current habits — diet, exercise, sleep.");
    else steps.push("Discuss a structured care plan with your doctor.");
  }

  const rangesMonths: Record<RiskLevel, [number, number]> = {
    LOW:    [6, 6],
    MEDIUM: [3, 6],
    HIGH:   [6, 12],
    SUPER:  [3, 18],
  };
  const [minM, maxM] = rangesMonths[overall];
  const reassessWeeks: Record<RiskLevel, number> = {
    LOW: 26, MEDIUM: 12, HIGH: 8, SUPER: 2,
  };

  const milestones: RecoveryMilestone[] = [
    { label: "Today", weekOffset: 0, kind: "now" },
  ];
  if (overall !== "LOW") {
    milestones.push({
      label: `First recheck — ${reassessWeeks[overall]}w`,
      weekOffset: reassessWeeks[overall],
      kind: "check",
    });
    const midWeeks = Math.round(((minM * 4.3) + (maxM * 4.3)) / 2);
    if (midWeeks > reassessWeeks[overall] + 2) {
      milestones.push({ label: "Mid-course review", weekOffset: midWeeks, kind: "milestone" });
    }
  }
  milestones.push({
    label: overall === "LOW" ? "Annual panel" : `Target — ${minM === maxM ? `${minM}mo` : `${minM}–${maxM}mo`}`,
    weekOffset: Math.round(maxM * 4.3),
    kind: "target",
  });

  return {
    totalMonthsMin: minM,
    totalMonthsMax: maxM,
    reassessInWeeks: reassessWeeks[overall],
    nextSteps: steps.slice(0, 5),
    milestones,
  };
}
