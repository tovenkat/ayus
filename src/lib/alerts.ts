import { prisma } from "@/lib/prisma";
import type { TestResult } from "@prisma/client";

// ─── Critical value thresholds (conservative, biased toward US/Indian adult ranges) ──

type Critical = {
  match: RegExp;
  unit?: RegExp; // optional unit-sanity filter
  high?: number; // urgent-high threshold
  low?: number;  // urgent-low threshold
  label: string;
};

const CRITICAL_RULES: Critical[] = [
  { match: /\bHbA1c\b/i, high: 8, label: "HbA1c ≥ 8% — poorly controlled diabetes" },
  { match: /\bFasting\s*Glucose\b|^Glucose\b.*fasting/i, high: 200, low: 54, label: "Fasting glucose critical" },
  { match: /\bCreatinine\b/i, high: 2.0, label: "Creatinine high — kidney concern" },
  { match: /\beGFR\b/i, low: 30, label: "eGFR < 30 — kidney function low" },
  { match: /\bPotassium\b/i, high: 5.5, low: 3.0, label: "Potassium out of safe range" },
  { match: /\bSodium\b/i, high: 150, low: 130, label: "Sodium out of safe range" },
  { match: /\bHemoglobin\b|^Hb\b/i, low: 8, label: "Severe anemia (Hb < 8)" },
  { match: /\bPlatelet/i, low: 50, label: "Very low platelets" },
  { match: /\bLDL\b/i, high: 190, label: "LDL ≥ 190 — very high" },
  { match: /\bTotal\s*Cholesterol\b/i, high: 300, label: "Total cholesterol ≥ 300" },
  { match: /\bTriglycerides?\b/i, high: 500, label: "Triglycerides ≥ 500 — pancreatitis risk" },
  { match: /\bTSH\b/i, high: 10, low: 0.1, label: "TSH abnormal" },
  { match: /\bUric\s*Acid\b/i, high: 9, label: "Uric acid ≥ 9" },
  { match: /\bBilirubin\b/i, high: 3, label: "Bilirubin ≥ 3" },
  { match: /\bALT\b|\bSGPT\b/i, high: 100, label: "ALT ≥ 100 — liver concern" },
  { match: /\bAST\b|\bSGOT\b/i, high: 100, label: "AST ≥ 100 — liver concern" },
];

function pickCriticalRule(name: string): Critical | null {
  for (const rule of CRITICAL_RULES) {
    if (rule.match.test(name)) return rule;
  }
  return null;
}

type NewAlert = {
  reportId: string;
  testResultId: string | null;
  normalizedName: string;
  severity: "INFO" | "WARN" | "URGENT";
  title: string;
  reason: string;
  observedValue: string | null;
  previousValue: string | null;
};

/**
 * Run all detection rules for a single new test result.
 * Returns zero or one alerts (we pick the highest-severity rule that matched).
 */
function detectForResult(
  current: Pick<TestResult, "id" | "normalizedName" | "observedValueRaw" | "observedValueNumeric" | "observedValueUnit" | "interpretation" | "isOutOfRange" | "reportId">,
  previous: Pick<TestResult, "observedValueRaw" | "observedValueNumeric" | "interpretation" | "isOutOfRange" | "createdAt"> | null,
): NewAlert | null {
  const name = current.normalizedName;
  const latestNumeric = current.observedValueNumeric;
  const rule = pickCriticalRule(name);

  // 1. URGENT — hit a critical threshold
  if (rule && latestNumeric !== null) {
    if (rule.high !== undefined && latestNumeric >= rule.high) {
      return {
        reportId: current.reportId,
        testResultId: current.id,
        normalizedName: name,
        severity: "URGENT",
        title: `${name}: critical high (${current.observedValueRaw} ${current.observedValueUnit ?? ""})`,
        reason: `${rule.label}. Discuss with your doctor soon.`,
        observedValue: `${current.observedValueRaw} ${current.observedValueUnit ?? ""}`.trim(),
        previousValue: previous?.observedValueRaw ?? null,
      };
    }
    if (rule.low !== undefined && latestNumeric <= rule.low) {
      return {
        reportId: current.reportId,
        testResultId: current.id,
        normalizedName: name,
        severity: "URGENT",
        title: `${name}: critical low (${current.observedValueRaw} ${current.observedValueUnit ?? ""})`,
        reason: `${rule.label}. Discuss with your doctor soon.`,
        observedValue: `${current.observedValueRaw} ${current.observedValueUnit ?? ""}`.trim(),
        previousValue: previous?.observedValueRaw ?? null,
      };
    }
  }

  // 2. WARN — newly out-of-range (previously normal)
  if (current.isOutOfRange && previous && !previous.isOutOfRange) {
    return {
      reportId: current.reportId,
      testResultId: current.id,
      normalizedName: name,
      severity: "WARN",
      title: `${name}: newly out of range`,
      reason: `Previous reading (${previous.observedValueRaw}) was normal; latest (${current.observedValueRaw}) is flagged ${current.interpretation.toLowerCase()}.`,
      observedValue: `${current.observedValueRaw} ${current.observedValueUnit ?? ""}`.trim(),
      previousValue: previous.observedValueRaw,
    };
  }

  // 3. WARN — large worsening delta while already out of range
  if (
    current.isOutOfRange &&
    previous?.isOutOfRange &&
    latestNumeric !== null &&
    previous.observedValueNumeric !== null
  ) {
    const prevNum = previous.observedValueNumeric;
    if (prevNum !== 0) {
      const deltaPct = Math.abs((latestNumeric - prevNum) / prevNum);
      const worseDirection =
        (current.interpretation === "HIGH" && latestNumeric > prevNum) ||
        (current.interpretation === "LOW" && latestNumeric < prevNum);
      if (worseDirection && deltaPct >= 0.2) {
        return {
          reportId: current.reportId,
          testResultId: current.id,
          normalizedName: name,
          severity: "WARN",
          title: `${name}: worsening trend (${(deltaPct * 100).toFixed(0)}% change)`,
          reason: `Previous: ${previous.observedValueRaw}. Latest: ${current.observedValueRaw}. Trend is moving in the wrong direction.`,
          observedValue: `${current.observedValueRaw} ${current.observedValueUnit ?? ""}`.trim(),
          previousValue: previous.observedValueRaw,
        };
      }
    }
  }

  // 4. INFO — returned to normal from abnormal
  if (!current.isOutOfRange && previous?.isOutOfRange) {
    return {
      reportId: current.reportId,
      testResultId: current.id,
      normalizedName: name,
      severity: "INFO",
      title: `${name}: back to normal`,
      reason: `Latest (${current.observedValueRaw}) is in range. Previous reading was flagged ${previous.interpretation.toLowerCase()}.`,
      observedValue: `${current.observedValueRaw} ${current.observedValueUnit ?? ""}`.trim(),
      previousValue: previous.observedValueRaw,
    };
  }

  return null;
}

/**
 * Run alert detection for every test result in a freshly-created report.
 * Dedupes against existing NEW/SEEN alerts for the same name on the same report.
 */
export async function detectAlertsForReport(userId: string, reportId: string): Promise<number> {
  const results = await prisma.testResult.findMany({
    where: { reportId, userId },
    select: {
      id: true,
      normalizedName: true,
      observedValueRaw: true,
      observedValueNumeric: true,
      observedValueUnit: true,
      interpretation: true,
      isOutOfRange: true,
      reportId: true,
      createdAt: true,
    },
  });

  if (results.length === 0) return 0;

  const alerts: NewAlert[] = [];

  for (const r of results) {
    // Find the most recent prior reading for the same biomarker (excluding this report)
    const previous = await prisma.testResult.findFirst({
      where: {
        userId,
        normalizedName: r.normalizedName,
        reportId: { not: reportId },
        createdAt: { lte: r.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: {
        observedValueRaw: true,
        observedValueNumeric: true,
        interpretation: true,
        isOutOfRange: true,
        createdAt: true,
      },
    });

    const alert = detectForResult(r, previous);
    if (alert) alerts.push(alert);
  }

  if (alerts.length === 0) return 0;

  // Dedupe: don't re-raise if an identical alert already exists for this report
  const existing = await prisma.biomarkerAlert.findMany({
    where: {
      userId,
      reportId,
      normalizedName: { in: alerts.map((a) => a.normalizedName) },
    },
    select: { normalizedName: true, severity: true },
  });
  const seen = new Set(existing.map((e) => `${e.normalizedName}|${e.severity}`));

  const toCreate = alerts.filter((a) => !seen.has(`${a.normalizedName}|${a.severity}`));

  if (toCreate.length === 0) return 0;

  await prisma.biomarkerAlert.createMany({
    data: toCreate.map((a) => ({
      userId,
      reportId: a.reportId,
      testResultId: a.testResultId,
      normalizedName: a.normalizedName,
      severity: a.severity,
      title: a.title,
      reason: a.reason,
      observedValue: a.observedValue,
      previousValue: a.previousValue,
    })),
  });

  console.log(`[alerts] created ${toCreate.length} alert(s) for report ${reportId}`);

  // Fire-and-forget WhatsApp notifications for WARN + URGENT
  const notifiable = toCreate.filter((a) => a.severity !== "INFO");
  if (notifiable.length > 0) {
    notifyAlertsByWhatsApp(userId, notifiable).catch((err) => {
      console.warn("[alerts] notify failed:", err instanceof Error ? err.message : err);
    });
  }

  return toCreate.length;
}

async function notifyAlertsByWhatsApp(userId: string, alerts: NewAlert[]): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneVerified: true, whatsappOptIn: true, name: true },
  });
  if (!user?.phone || !user.phoneVerified || !user.whatsappOptIn) return;

  const urgent = alerts.filter((a) => a.severity === "URGENT");
  const warn = alerts.filter((a) => a.severity === "WARN");

  const lines: string[] = [
    `🩺 *Ayus health alert*${user.name ? ` — hi ${user.name.split(" ")[0]}` : ""}`,
    "",
  ];
  if (urgent.length > 0) {
    lines.push("🚨 *Urgent*");
    for (const a of urgent) lines.push(`• ${a.title}`);
    lines.push("");
  }
  if (warn.length > 0) {
    lines.push("⚠️ *Worth discussing with your doctor*");
    for (const a of warn) lines.push(`• ${a.title}`);
    lines.push("");
  }
  lines.push("Open the app to see full details and next steps.");
  lines.push("_Reply STOP to disable these alerts._");

  const { sendWhatsApp } = await import("@/lib/twilio");
  await sendWhatsApp(user.phone, lines.join("\n"));
}
