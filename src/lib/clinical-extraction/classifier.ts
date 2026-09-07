import { z } from "zod/v4";
import type { ClinicalReportKind, UploadType } from "@prisma/client";
import { getProviderForUser } from "@/lib/ai/user-provider";
import { extractJsonBlob } from "./types";

const KINDS: ClinicalReportKind[] = [
  "IMAGING", "ECG", "ECHO", "BIOPSY", "DISCHARGE_SUMMARY",
  "PRESCRIPTION", "CONSULTATION", "VACCINATION", "OTHER",
];

const ClassificationSchema = z.object({
  kind: z.enum(KINDS),
  confidence: z.number().min(0).max(1).optional().default(0.6),
  reason: z.string().optional(),
}).passthrough();

export type DocumentClassification = {
  kind: ClinicalReportKind;
  confidence: number;
  reason?: string;
};

/** Quick keyword-based classifier. Used when an LLM call is skipped or as a prior. */
function keywordClassify(text: string): DocumentClassification | null {
  const t = text.toLowerCase();
  const score = (words: string[]) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);

  const prescription = score(["rx", "℞", "tab.", "cap.", "ml orally", "bd ", "tid ", "od ", "sos", "syrup", "dosage", "signature", "prescription"]);
  const ecg = score(["ecg", "ekg", "electrocardio", "sinus rhythm", "qt interval", "pr interval", "heart rate", "lbbb", "rbbb"]);
  const echo = score(["echocardio", "lvef", "lv ejection fraction", "mitral", "tricuspid", "aortic valve", "doppler", "rvsp"]);
  const imaging = score(["impression:", "findings:", "radiolog", "x-ray", "chest x-ray", "cxr", "ultrasound", "sonograph", "mri ", "ct scan", "ct brain", "ct chest", "usg ", "abdominal usg"]);
  const biopsy = score(["biopsy", "microscopy", "histopath", "specimen", "malignant", "benign", "grade i", "grade ii", "grade iii"]);
  const discharge = score(["admission", "date of admission", "discharge summary", "discharge advice", "hospital stay", "length of stay"]);
  const consult = score(["chief complaint", "h/o", "presenting complaint", "assessment:", "plan:", "s.o.a.p", "outpatient"]);
  const vaccination = score(["vaccination", "vaccine", "immunisation", "immunization", "batch no", "dose #", "booster"]);

  const scores = [
    { k: "PRESCRIPTION" as ClinicalReportKind, s: prescription },
    { k: "ECG" as ClinicalReportKind, s: ecg },
    { k: "ECHO" as ClinicalReportKind, s: echo },
    { k: "IMAGING" as ClinicalReportKind, s: imaging },
    { k: "BIOPSY" as ClinicalReportKind, s: biopsy },
    { k: "DISCHARGE_SUMMARY" as ClinicalReportKind, s: discharge },
    { k: "CONSULTATION" as ClinicalReportKind, s: consult },
    { k: "VACCINATION" as ClinicalReportKind, s: vaccination },
  ].sort((a, b) => b.s - a.s);

  if (scores[0].s >= 2) {
    const confidence = Math.min(0.85, 0.5 + scores[0].s * 0.08);
    return { kind: scores[0].k, confidence, reason: "keyword match" };
  }
  return null;
}

/** Map the user's manually-chosen UploadType to a clinical kind if unambiguous. */
export function uploadTypeToKind(uploadType: UploadType): ClinicalReportKind | null {
  if (uploadType === "PRESCRIPTION") return "PRESCRIPTION";
  if (uploadType === "DISCHARGE_SUMMARY") return "DISCHARGE_SUMMARY";
  if (uploadType === "DOCTOR_NOTE") return "CONSULTATION";
  return null;
}

const SYSTEM_PROMPT = `You classify Indian medical documents. Read the excerpt and pick the single best category.

Categories:
- IMAGING: X-ray, CT, MRI, USG/Ultrasound, mammogram, DEXA — any radiology impression.
- ECG: electrocardiogram (12-lead or rhythm strip).
- ECHO: echocardiogram (2D echo, doppler, stress echo).
- BIOPSY: histopathology / cytology / FNAC / microscopy.
- DISCHARGE_SUMMARY: hospital discharge (admission → discharge narrative).
- PRESCRIPTION: doctor's prescription (Rx with medication list). Often has Rx symbol, tablets/capsules with dosages.
- CONSULTATION: outpatient / OPD / consultation note (chief complaint + exam + plan).
- VACCINATION: immunisation record / vaccine certificate.
- OTHER: anything else that isn't a standard lab report.

Rules:
- A document with lab values + reference ranges is a LAB report — do NOT classify those here; return OTHER.
- If it's primarily a list of medications with dosages → PRESCRIPTION.
- If it describes imaging findings by a radiologist → IMAGING.
- When unsure, pick OTHER with low confidence.

Return JSON ONLY:
{"kind": "<one of the categories>", "confidence": 0.0-1.0, "reason": "one sentence"}`;

export async function classifyDocument(
  userId: string,
  text: string,
  fallback: { uploadType?: UploadType } = {},
): Promise<DocumentClassification> {
  // 1. User's manual uploadType wins — they know what they uploaded.
  if (fallback.uploadType) {
    const fromType = uploadTypeToKind(fallback.uploadType);
    if (fromType) return { kind: fromType, confidence: 0.99, reason: "user-selected uploadType" };
  }

  // 2. Cheap keyword prior — if confident (>=0.75), skip the LLM call.
  const kw = keywordClassify(text);
  if (kw && kw.confidence >= 0.75) return kw;

  // 3. LLM classifier. Short excerpt to keep the call cheap.
  const excerpt = text.slice(0, 4000);
  try {
    const { provider } = await getProviderForUser(userId, "chat");
    const res = await provider.chat(
      [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: `Document excerpt:\n\n${excerpt}` },
      ],
      { temperature: 0, num_ctx: 8192 },
    );
    const parsed = JSON.parse(extractJsonBlob(res.content));
    const validated = ClassificationSchema.parse(parsed);
    return {
      kind: validated.kind,
      confidence: validated.confidence,
      reason: validated.reason,
    };
  } catch (err) {
    console.warn("[classifier] LLM classification failed, falling back to keyword prior:", err instanceof Error ? err.message : err);
    return kw ?? { kind: "OTHER", confidence: 0.3, reason: "fallback" };
  }
}
