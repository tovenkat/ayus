import type { ClinicalReportKind, UploadType } from "@prisma/client";
import { classifyDocument } from "./classifier";
import { extractImaging } from "./imaging";
import { extractPrescription } from "./prescription";
import { extractCodedBioEntities, type CodedBioEntity } from "./gliner-client";
import type { ClinicalExtraction } from "./types";

export type DispatchResult = {
  kind: ClinicalReportKind;
  extraction: ClinicalExtraction | null;
  classificationConfidence: number;
  classificationReason?: string;
  /**
   * Biomedical entities (lab tests → LOINC, diseases, medications, …) from the
   * GLiNER-BioMed sidecar. Empty unless ENABLE_GLINER is on and the sidecar is
   * reachable — so this is inert by default and never blocks extraction.
   */
  entities: CodedBioEntity[];
};

/**
 * Classify a clinical document and route to the specialized extractor.
 * Returns extraction=null for kinds we don't yet handle (ECG, ECHO, etc.) —
 * the caller can persist a minimal shell record in that case.
 */
export async function extractClinicalReport(
  userId: string,
  text: string,
  opts: { uploadType?: UploadType } = {},
): Promise<DispatchResult> {
  const classification = await classifyDocument(userId, text, opts);

  let extraction: ClinicalExtraction | null = null;
  try {
    if (classification.kind === "IMAGING") {
      extraction = await extractImaging(userId, text);
    } else if (classification.kind === "PRESCRIPTION") {
      extraction = await extractPrescription(userId, text);
    }
    // Other kinds (ECG, ECHO, BIOPSY, …) will be added later; for now
    // we persist a minimal record with just the classification.
  } catch (err) {
    console.warn(`[clinical] extraction failed for kind=${classification.kind}:`, err instanceof Error ? err.message : err);
  }

  // Biomedical NER over the narrative text — runs for every kind (even ones
  // without a specialized extractor). Gated + graceful: returns [] when the
  // GLiNER sidecar is off, so it never blocks or fails extraction.
  let entities: CodedBioEntity[] = [];
  try {
    entities = await extractCodedBioEntities(text);
    if (entities.length > 0) {
      const coded = entities.filter((e) => e.loincNum).length;
      console.log(`[clinical] GLiNER: ${entities.length} entities (${coded} LOINC-coded)`);
    }
  } catch (err) {
    console.warn(`[clinical] GLiNER NER failed (non-fatal):`, err instanceof Error ? err.message : err);
  }

  return {
    kind: classification.kind,
    extraction,
    classificationConfidence: classification.confidence,
    classificationReason: classification.reason,
    entities,
  };
}

export type { ClinicalExtraction };
export { classifyDocument } from "./classifier";
