/**
 * Repeat-testing interval catalog — the evidence-based, condition-aware
 * intervals that power the lab's follow-up / due-for-repeat views.
 *
 * DESIGN PRINCIPLE (see the vision note): these are transparent, configurable
 * clinical-decision-support rules, NOT diagnoses. Every entry cites a guideline
 * and every surfaced recommendation must be labeled decision-support and defer
 * final decisions to a clinician.
 *
 * The recommended interval is condition-aware: it depends on the patient's most
 * recent value for that biomarker (e.g. HbA1c repeats every 3 months once in the
 * diabetic range, yearly when normal). `bands` are evaluated top-to-bottom;
 * first match wins, else `defaultMonths`.
 *
 * Pure config — no Prisma. Safe to import anywhere.
 */

export type IntervalBand = {
  /** Match when latest value ≥ this. */
  atOrAbove?: number;
  /** Match when latest value < this. */
  below?: number;
  months: number;
  /** Short clinical label for why this interval applies, e.g. "Diabetic range". */
  label: string;
};

export type RepeatIntervalEntry = {
  /** Must match TestCanonical.name exactly (see seed-biomarkers.ts). */
  canonicalName: string;
  /** Label for the Health Action Center row, e.g. "Repeat HbA1c". */
  action: string;
  defaultMonths: number;
  bands: IntervalBand[];
  guideline: string;
};

// Intervals reflect widely-used guidelines (ADA Standards of Care, Endocrine
// Society, KDIGO, ACC/AHA, ATA). They are deliberately conservative and
// configurable — a lab can tune them without touching query logic.
export const REPEAT_INTERVALS: RepeatIntervalEntry[] = [
  {
    canonicalName: "HbA1c",
    action: "Repeat HbA1c",
    defaultMonths: 12,
    bands: [
      { atOrAbove: 6.5, months: 3, label: "Diabetic range" },
      { atOrAbove: 5.7, months: 6, label: "Prediabetic range" },
    ],
    guideline: "ADA Standards of Care — quarterly if not at goal, yearly for screening",
  },
  {
    canonicalName: "LDL Cholesterol",
    action: "Repeat Lipid Profile",
    defaultMonths: 12,
    bands: [
      { atOrAbove: 160, months: 6, label: "High LDL" },
      { atOrAbove: 130, months: 6, label: "Borderline-high LDL" },
    ],
    guideline: "ACC/AHA — 4–12 weeks after therapy change, else 6–12 months",
  },
  {
    canonicalName: "Vitamin D",
    action: "Repeat Vitamin D",
    defaultMonths: 12,
    bands: [
      { below: 20, months: 3, label: "Deficient" },
      { below: 30, months: 6, label: "Insufficient" },
    ],
    guideline: "Endocrine Society — recheck 3 months after starting supplementation",
  },
  {
    canonicalName: "Creatinine",
    action: "Kidney Function Follow-up",
    defaultMonths: 12,
    bands: [
      { atOrAbove: 1.5, months: 3, label: "Elevated creatinine" },
      { atOrAbove: 1.3, months: 6, label: "Mildly elevated" },
    ],
    guideline: "KDIGO — interval by CKD risk; sooner when function is declining",
  },
  {
    canonicalName: "ALT",
    action: "Liver Function Follow-up",
    defaultMonths: 12,
    bands: [
      { atOrAbove: 100, months: 2, label: "Markedly elevated ALT" },
      { atOrAbove: 56, months: 3, label: "Elevated ALT" },
    ],
    guideline: "AASLD — repeat elevated aminotransferases within weeks to months",
  },
  {
    canonicalName: "TSH",
    action: "Thyroid Retest",
    defaultMonths: 12,
    bands: [
      { atOrAbove: 4.5, months: 3, label: "High TSH" },
      { below: 0.4, months: 3, label: "Low TSH" },
    ],
    guideline: "ATA — 6–8 weeks after dose change, else 6–12 months when stable",
  },
  {
    canonicalName: "Ferritin",
    action: "Iron Studies",
    defaultMonths: 12,
    bands: [
      { below: 15, months: 3, label: "Iron deficient" },
      { below: 30, months: 6, label: "Low iron stores" },
    ],
    guideline: "BSH — recheck 3 months into iron repletion",
  },
];

export const REPEAT_INTERVAL_BY_NAME: Record<string, RepeatIntervalEntry> = Object.fromEntries(
  REPEAT_INTERVALS.map((e) => [e.canonicalName, e]),
);

export type ResolvedInterval = {
  months: number;
  reason: string | null; // band label, or null when the default applies
};

/** Pick the applicable interval for a latest value. Null value → default. */
export function resolveInterval(entry: RepeatIntervalEntry, latestValue: number | null): ResolvedInterval {
  if (latestValue !== null) {
    for (const band of entry.bands) {
      const okAbove = band.atOrAbove === undefined || latestValue >= band.atOrAbove;
      const okBelow = band.below === undefined || latestValue < band.below;
      if (okAbove && okBelow) return { months: band.months, reason: band.label };
    }
  }
  return { months: entry.defaultMonths, reason: null };
}

export function intervalLabel(months: number): string {
  if (months <= 1) return "monthly";
  if (months < 12) return `every ${months} months`;
  if (months === 12) return "yearly";
  return `every ${Math.round(months / 12)} years`;
}
