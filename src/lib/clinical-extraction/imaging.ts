import { z } from "zod/v4";
import type { ClinicalExtraction } from "./types";
import { extractJsonBlob } from "./types";
import { getProviderForUser } from "@/lib/ai/user-provider";

const ImagingSchema = z.object({
  modality: z.string().nullable().optional(),
  bodyPart: z.string().nullable().optional(),
  procedureName: z.string().nullable().optional(),
  performedOn: z.string().nullable().optional(),
  referringDoctor: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  indication: z.string().nullable().optional(),
  technique: z.string().nullable().optional(),
  findings: z.string().nullable().optional(),
  impression: z.string().nullable().optional(),
  recommendations: z.string().nullable().optional(),
  measurements: z.record(z.string(), z.any()).nullable().optional(),
  abnormalFlags: z.array(z.string()).default([]),
  severity: z.enum(["NORMAL", "MINOR", "MODERATE", "SEVERE", "CRITICAL"]).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.6),
}).passthrough();

const SYSTEM_PROMPT = `You are a structured extractor for Indian radiology reports (X-ray, CT, MRI, USG/Ultrasound, Mammogram, DEXA). Extract the radiologist's findings faithfully — never invent, embellish, or editorialise.

Return ONLY valid JSON matching this schema:

{
  "modality":        "e.g. Chest X-ray, CT Chest, MRI Lumbar Spine, Abdominal USG, Mammogram (left), DEXA Scan",
  "bodyPart":        "e.g. Chest, Abdomen + Pelvis, Lumbar Spine, Right Breast",
  "procedureName":   "short canonical name (e.g. 'CXR PA view', 'HRCT Thorax')",
  "performedOn":     "YYYY-MM-DD",
  "referringDoctor": "e.g. 'Dr. Raghavan' — ONLY referring clinician, never the patient",
  "performedBy":     "radiologist who signed the report",
  "institution":     "hospital / imaging centre name",
  "indication":      "why the scan was ordered (one short sentence)",
  "technique":       "how it was acquired (one short sentence, or null)",
  "findings":        "verbatim findings paragraph(s) from the report — preserve the radiologist's phrasing",
  "impression":      "verbatim impression / conclusion paragraph — this is the most important field",
  "recommendations": "any follow-up advice or next steps (or null)",
  "measurements":    { "<key>": "<value + unit>" }     // optional structured measurements, e.g. {"LV dimension": "48 mm"}. Null if none.
  "abnormalFlags":   [ "short phrase", ... ]           // discrete abnormal observations ("right lower lobe opacity", "fatty liver grade II")
  "severity":        "NORMAL | MINOR | MODERATE | SEVERE | CRITICAL",
  "confidence":      0.0-1.0
}

Severity guidance (err toward LESS severe when unsure):
- NORMAL:   report explicitly states "No abnormality detected" / "Study within normal limits" / "Normal".
- MINOR:    incidental or mild findings that don't need urgent action (e.g. "mild hepatomegaly", "few cortical cysts").
- MODERATE: notable findings that warrant clinical correlation but not emergency (e.g. "moderate pleural effusion", "grade II fatty liver").
- SEVERE:   worrying findings needing near-term follow-up (e.g. "large mass", "complete obstruction", "grade IV fatty liver with fibrosis").
- CRITICAL: requires immediate attention (suspected malignancy, active haemorrhage, pulmonary embolism, complete infarct).

Anti-hallucination rules:
- If a field isn't in the report, set it to null. Don't fabricate.
- Copy findings + impression verbatim (small formatting fixes OK, no rewording).
- Don't guess severity from modality alone. Read the impression.
- If the report says "malignant" / "carcinoma" / "neoplasm" / "suspicious for malignancy" / "mass lesion" in the impression, severity is at least SEVERE.
- If the report mentions active haemorrhage, infarct, embolism, obstruction, perforation, rupture, or "emergent" → CRITICAL.
- Trust the radiologist's words. If they say "likely benign", don't upgrade it.`;

export async function extractImaging(
  userId: string,
  text: string,
): Promise<ClinicalExtraction> {
  const excerpt = text.length > 16000 ? text.slice(0, 16000) : text;

  const { provider } = await getProviderForUser(userId, "extract");
  const res = await provider.chat(
    [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: `Imaging report text:\n---\n${excerpt}\n---\n\nReturn ONLY the JSON object.` },
    ],
    { temperature: 0, num_ctx: 16384 },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonBlob(res.content));
  } catch (err) {
    throw new Error(`Imaging extractor returned invalid JSON: ${err instanceof Error ? err.message : err}`);
  }

  const validated = ImagingSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Imaging extractor schema mismatch: ${validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`);
  }

  return {
    kind: "IMAGING",
    modality: validated.data.modality ?? null,
    bodyPart: validated.data.bodyPart ?? null,
    procedureName: validated.data.procedureName ?? null,
    performedOn: validated.data.performedOn ?? null,
    referringDoctor: validated.data.referringDoctor ?? null,
    performedBy: validated.data.performedBy ?? null,
    institution: validated.data.institution ?? null,
    indication: validated.data.indication ?? null,
    technique: validated.data.technique ?? null,
    findings: validated.data.findings ?? null,
    impression: validated.data.impression ?? null,
    recommendations: validated.data.recommendations ?? null,
    measurements: validated.data.measurements ?? null,
    abnormalFlags: validated.data.abnormalFlags ?? [],
    severity: validated.data.severity ?? null,
    confidence: validated.data.confidence,
    rawJson: parsed,
  };
}
