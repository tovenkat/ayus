import { z } from "zod/v4";
import type { ClinicalExtraction, PrescribedMed } from "./types";
import { extractJsonBlob } from "./types";
import { getProviderForUser } from "@/lib/ai/user-provider";

const MedItemSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  durationDays: z.number().int().nullable().optional(),
  instructions: z.string().nullable().optional(),
}).passthrough();

const PrescriptionSchema = z.object({
  performedOn: z.string().nullable().optional(),
  referringDoctor: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  indication: z.string().nullable().optional(),
  findings: z.string().nullable().optional(),
  impression: z.string().nullable().optional(),
  recommendations: z.string().nullable().optional(),
  items: z.array(MedItemSchema).default([]),
  abnormalFlags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
}).passthrough();

const SYSTEM_PROMPT = `You are a structured extractor for Indian doctor prescriptions (Rx). Extract each prescribed medication precisely. Never fabricate a drug name.

Return ONLY valid JSON:

{
  "performedOn":     "YYYY-MM-DD (prescription date)",
  "referringDoctor": "prescribing doctor name if a separate referring clinician exists, else null",
  "performedBy":     "prescribing doctor name ('Dr. Priya Ramesh'), ONLY the doctor — never the patient",
  "institution":     "clinic / hospital name",
  "indication":      "one-sentence reason for Rx if printed (e.g. 'fever with sore throat'), else null",
  "findings":        "brief vitals or examination notes if present, else null",
  "impression":      "working diagnosis if printed (e.g. 'acute pharyngitis'), else null",
  "recommendations": "advice / follow-up instructions (e.g. 'review in 5 days', 'avoid cold water'), else null",
  "items": [
    {
      "name":         "generic or brand name exactly as printed (e.g. 'Paracetamol 500 mg', 'Amlokind 5')",
      "dosage":       "strength if separate from name (e.g. '500 mg', '10 mg')",
      "frequency":    "free text as written ('twice daily after food', 'BD', '1-0-1', 'SOS')",
      "durationDays": 7,            // null if not specified
      "instructions": "any extra note ('before breakfast', 'with water')"
    }
  ],
  "abnormalFlags": [ "short phrase ...", ... ],
  "confidence":    0.0-1.0
}

Rules:
- NEVER put the patient's name in referringDoctor / performedBy. Patient is usually preceded by "Name:" / "Patient:" and sometimes followed by age/sex like "(45/M)".
- Indian prescriptions often use "1-0-1" / "1-1-1" / "BD" / "TDS" / "QID" / "OD" / "HS" / "SOS" — copy that VERBATIM into frequency; do not translate.
- Indian prescriptions often omit durationDays — set null if not explicitly numeric (e.g. "for 5 days" → 5; "to continue" → null).
- Each line item becomes one element of "items". Tablets, capsules, syrups, drops all count.
- Skip stationery: doctor's address, registration number, clinic phone, printed header slogans, tokens/QR hints.
- If the document is clearly NOT a prescription (e.g. a lab report), return an empty items array and set confidence < 0.3.`;

export async function extractPrescription(
  userId: string,
  text: string,
): Promise<ClinicalExtraction> {
  const excerpt = text.length > 12000 ? text.slice(0, 12000) : text;

  const { provider } = await getProviderForUser(userId, "extract");
  const res = await provider.chat(
    [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: `Prescription text:\n---\n${excerpt}\n---\n\nReturn ONLY the JSON object.` },
    ],
    { temperature: 0, num_ctx: 8192 },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonBlob(res.content));
  } catch (err) {
    throw new Error(`Prescription extractor returned invalid JSON: ${err instanceof Error ? err.message : err}`);
  }

  const validated = PrescriptionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Prescription schema mismatch: ${validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`);
  }

  const items: PrescribedMed[] = validated.data.items.map((m) => ({
    name: m.name,
    dosage: m.dosage ?? null,
    frequency: m.frequency ?? null,
    durationDays: m.durationDays ?? null,
    instructions: m.instructions ?? null,
  }));

  return {
    kind: "PRESCRIPTION",
    modality: null,
    bodyPart: null,
    procedureName: "Prescription",
    performedOn: validated.data.performedOn ?? null,
    referringDoctor: validated.data.referringDoctor ?? null,
    performedBy: validated.data.performedBy ?? null,
    institution: validated.data.institution ?? null,
    indication: validated.data.indication ?? null,
    technique: null,
    findings: validated.data.findings ?? null,
    impression: validated.data.impression ?? null,
    recommendations: validated.data.recommendations ?? null,
    measurements: null,
    abnormalFlags: validated.data.abnormalFlags,
    severity: null, // prescriptions don't get a severity; meds are inherently safe or contraindicated, not graded
    confidence: validated.data.confidence,
    rawJson: parsed,
    prescriptionItems: items,
  };
}

/**
 * Translate Indian dose notation ("1-0-1", "BD", "TDS", etc.) to our MedFrequency enum.
 * Falls back to AS_NEEDED when unclear, so the med always lands in the medications list.
 */
export function normalizeFrequencyToEnum(raw: string | null | undefined): "ONCE_DAILY" | "TWICE_DAILY" | "THRICE_DAILY" | "FOUR_TIMES_DAILY" | "AS_NEEDED" | "WEEKLY" | "ALTERNATE_DAYS" {
  if (!raw) return "AS_NEEDED";
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  // 1-0-1 style
  const dashMatch = s.match(/(\d)\s*[-/]\s*(\d)\s*[-/]\s*(\d)(?:\s*[-/]\s*(\d))?/);
  if (dashMatch) {
    const parts = dashMatch.slice(1).filter(Boolean).map((x) => Number(x));
    const doses = parts.reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    if (doses >= 4) return "FOUR_TIMES_DAILY";
    if (doses === 3) return "THRICE_DAILY";
    if (doses === 2) return "TWICE_DAILY";
    if (doses === 1) return "ONCE_DAILY";
  }
  if (/\b(qid|q\.?i\.?d\.?|four times)\b/.test(s)) return "FOUR_TIMES_DAILY";
  if (/\b(tid|t\.?d\.?s\.?|tds|thrice|three times)\b/.test(s)) return "THRICE_DAILY";
  if (/\b(bid|b\.?d\.?|twice)\b/.test(s)) return "TWICE_DAILY";
  if (/\b(od|once daily|qd|q\.?d\.?|hs|at bedtime)\b/.test(s)) return "ONCE_DAILY";
  if (/\b(sos|prn|as needed|when required)\b/.test(s)) return "AS_NEEDED";
  if (/\bweek/.test(s)) return "WEEKLY";
  if (/\balternate\b|every other day/.test(s)) return "ALTERNATE_DAYS";
  return "AS_NEEDED";
}
