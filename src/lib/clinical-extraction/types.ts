import type { ClinicalReportKind, ReportSeverity } from "@prisma/client";

/** Canonical clinical report output — one row in `ClinicalReport`. */
export type ClinicalExtraction = {
  kind: ClinicalReportKind;
  modality?: string | null;
  bodyPart?: string | null;
  procedureName?: string | null;
  performedOn?: string | null; // YYYY-MM-DD
  referringDoctor?: string | null;
  performedBy?: string | null;
  institution?: string | null;

  indication?: string | null;
  technique?: string | null;
  findings?: string | null;
  impression?: string | null;
  recommendations?: string | null;

  measurements?: Record<string, unknown> | null;
  abnormalFlags?: string[];
  severity?: ReportSeverity | null;

  /** 0–1 */
  confidence: number;
  /** Raw model output, retained for auditing. */
  rawJson?: unknown;

  /** Prescription-specific payload — used only when kind === "PRESCRIPTION". */
  prescriptionItems?: PrescribedMed[];
};

export type PrescribedMed = {
  name: string;
  dosage?: string | null;
  frequency?: string | null; // free text ("twice daily after food")
  durationDays?: number | null;
  instructions?: string | null;
};

/** Strip markdown fences + trailing prose around a JSON blob. */
export function extractJsonBlob(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;
}
