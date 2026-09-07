import { z } from "zod/v4";
import { extractPdfText, cleanLabReportText } from "@/lib/pdf";
import { bufferToImageBase64s } from "@/lib/pdf-images";
import { prisma } from "@/lib/prisma";
import { getExtractProvider, getOcrProvider } from "@/lib/ai/chat-provider";
import { getDisplayModelName, loadAIConfig } from "@/lib/ai/config";
import {
  loadSynonymMap,
  normalizeReport,
  type LlmExtractionResult,
  type LlmRawTest,
  type NormalizedReport,
} from "@/lib/normalize";
import type { ExtractionData, PreviewTestRow } from "@/types/extraction";
import type { ChatProvider, ChatMessage, ChatOptions, DocumentBlock } from "@/lib/ai/types";

// ─── Zod validation schema ──────────────────────────────────────────────────
//
// Permissive schema — validates overall structure while allowing the flexible
// field names that different LLMs produce. The coerceTestRow/pickCI layer
// handles normalization after Zod validation passes.

const ZTestRow = z.object({
  raw_test_name: z.string().optional(),
  test_name: z.string().optional(),
  name: z.string().optional(),
  normalized_test_name: z.string().optional(),
  observed_value_raw: z.union([z.string(), z.number()]).nullable().optional(),
  value: z.union([z.string(), z.number()]).nullable().optional(),
  result: z.union([z.string(), z.number()]).nullable().optional(),
  observed_value_numeric: z.number().nullable().optional(),
  reference_interval_raw: z.string().nullable().optional(),
  reference_range: z.string().nullable().optional(),
  reference_low: z.number().nullable().optional(),
  reference_high: z.number().nullable().optional(),
  interpretation: z.string().nullable().optional(),
  confidence: z.number().optional(),
  // 1-indexed PDF page this test was extracted from. LLMs rarely emit this
  // reliably today; the layout path fills it in later during ingestion.
  source_page: z.number().int().nullable().optional(),
}).passthrough();

const ZLabReport = z.object({
  tests: z.array(ZTestRow).min(1, "Must contain at least 1 test result"),
}).passthrough();

const MAX_VALIDATION_RETRIES = 1;

const EXTRACTION_SYSTEM_PROMPT = `You are a precise medical lab report parser for Indian diagnostic reports (Thyrocare, SRL, Apollo, Dr Lal PathLabs, Metropolis, Lucid, and similar). Extract structured data exactly as printed. Respond ONLY in English.

══════════ GOLDEN RULES ══════════

G1. Return ONLY valid JSON. No markdown, no prose, no extra keys.
G2. NEVER invent data. If a value, unit, or range is not explicitly printed, set the field to null.
    A null is always better than a guess.
G3. Copy values EXACTLY as printed (operator, decimal, unit) into observed_value_raw before any parsing.
G4. Extract EVERY numeric test from EVERY section and EVERY page. A multi-page report typically yields 40–80+ tests.
G5. If the numeric value is unclear due to OCR noise, set confidence < 0.5 and add a warning. Do NOT "correct" the OCR.

══════════ DATES ══════════

D1. For report_date: prefer "Sample Collected" / "Collection Date" / "Collected On" over
    "Report Date" / "Printed On" / "Reported On". Set date_source accordingly.
D2. Indian date formats to handle (all → YYYY-MM-DD):
    - "15/01/2026"  → 2026-01-15   (DD/MM/YYYY is the norm; NEVER read as MM/DD)
    - "15-Jan-2026" → 2026-01-15
    - "15.01.2026"  → 2026-01-15
    - "15 Jan 2026" → 2026-01-15
    - "15.Jan.2026" → 2026-01-15
D3. Two-digit years: "15/01/26" → year < 50 treat as 20XX; year ≥ 50 treat as 19XX.
D4. Time stamps next to dates ("15/01/2026 09:35 AM") — ignore the time, keep just the date.

══════════ TEST NAME NORMALIZATION ══════════

N1. Set raw_test_name to the exact name printed. Set normalized_test_name using the canonical form below.
N2. Common Indian synonyms → canonical:
    - "Glycated Hemoglobin" / "Glycosylated Hb" / "HbA1C" / "GHb" → "HbA1c"
    - "Thyroid Stimulating Hormone" / "TSH (Ultrasensitive)" / "TSH Sensitive" → "TSH"
    - "Chol/HDL" / "TC/HDL" / "Total Chol/HDL" → "Total Cholesterol/HDL Ratio"
    - "LDL/HDL" → "LDL/HDL Ratio"
    - "SGOT" / "AST/SGOT" → "AST (SGOT)"  |  "SGPT" / "ALT/SGPT" → "ALT (SGPT)"
    - "S. Creatinine" / "Serum Creatinine" / "Creatinine (Enzymatic)" → "Creatinine"
    - "Urea" / "BUN (Urea)" → "Urea"     |  "Blood Urea Nitrogen" / "BUN" → "BUN"
    - "eGFR" / "Estimated GFR" / "CKD-EPI" → "eGFR"
    - "S. Uric Acid" / "Serum Uric Acid" → "Uric Acid"
    - "S. Bilirubin Total" / "Total Bilirubin" → "Total Bilirubin"
    - "Direct Bilirubin" / "Conjugated Bilirubin" → "Direct Bilirubin"
    - "Indirect Bilirubin" / "Unconjugated Bilirubin" → "Indirect Bilirubin"
    - "Alkaline Phosphatase" / "ALP" / "SAP" → "Alkaline Phosphatase (ALP)"
    - "GGT" / "Gamma GT" / "GGTP" → "Gamma GT (GGTP)"
    - "Total WBC Count" / "Total Leucocyte Count" / "TLC" → "WBC Count"
    - "Total RBC Count" / "TRBC" → "RBC Count"
    - "Hb" / "Haemoglobin" / "Hemoglobin" → "Hemoglobin"
    - "Hct" / "Haematocrit" / "PCV" / "Packed Cell Volume" → "Hematocrit (HCT)"
    - "Platelet Count" / "PLT" / "Thrombocyte Count" → "Platelet Count"
    - "Random Blood Sugar" / "RBS" / "Blood Glucose Random" → "Blood Glucose (Random)"
    - "Fasting Blood Sugar" / "FBS" / "Blood Glucose Fasting" → "Blood Glucose (Fasting)"
    - "PP Blood Sugar" / "PPBS" / "Post Prandial Blood Glucose" → "Blood Glucose (Post-Prandial)"
    - "Serum Na" / "Sodium" → "Sodium"  |  "Serum K" / "Potassium" → "Potassium"
    - "Serum Cl" / "Chloride" → "Chloride"  |  "Calcium (Total)" → "Calcium"
    - "Phosphorus" / "Phosphorous" / "Inorganic Phosphorus" → "Phosphorus"
    - "T3 Total" → "T3"  |  "T4 Total" → "T4"
    - "Free T3" / "FT3" → "Free T3"  |  "Free T4" / "FT4" → "Free T4"
    - "Anti-TPO" / "TPO Antibody" → "Anti-TPO"  |  "Anti-Tg" / "Thyroglobulin Antibody" → "Anti-Tg"
    - "Vit D" / "Vitamin D Total" / "25-OH Vitamin D" / "25(OH)D" / "25-Hydroxycholecalciferol" → "Vitamin D (25-OH)"
    - "Vit B12" / "Vitamin B12" / "Cyanocobalamin" → "Vitamin B12"
    - "Folic Acid" / "Folate" → "Folate"
    - "Ferritin" / "S. Ferritin" → "Ferritin"
    - "Iron" / "S. Iron" / "Serum Iron" → "Iron"
    - "TIBC" / "Total Iron Binding Capacity" → "TIBC"
    - "HOMA-IR" / "HOMA Index" → "HOMA-IR"
    - "Microalbumin" / "Urinary Microalbumin" → "Microalbumin"
    - "ACR" / "Albumin Creatinine Ratio" / "UACR" → "Urine ACR"
    - "hs-CRP" / "High Sensitivity CRP" → "hs-CRP"
    - "CRP" / "C-Reactive Protein" (qualitative) → "CRP"
    - "ESR" / "Erythrocyte Sedimentation Rate" → "ESR"
    - "Homocysteine" → "Homocysteine"
    - "C-Peptide" → "C-Peptide"  |  "Insulin (Fasting)" → "Fasting Insulin"

══════════ VALUES (CRITICAL) ══════════

V1. observed_value_raw: copy exactly as printed, including operators ("<200", ">1.5", "≤40"), units if inline,
    and any flag characters ("6.8 *", "6.8 H"). Do NOT clean this field — it is the source of truth.
V2. observed_value_numeric: parse the pure number.
    - Strip thousands separators: "1,200" → 1200; "1 200 000" → 1200000.
    - Operator prefix: "<200" → numeric=200, operator="<"; ">1.5" → numeric=1.5, operator=">";
      "≥40" → numeric=40, operator=">"; "≤200" → numeric=200, operator="<"; "~5.0" → numeric=5, operator="~".
    - Percent values ("40 %") → numeric=40, unit="%".
    - Scientific notation: "1.2 × 10^6" → numeric=1200000; "4.5 x 10³" → numeric=4500.
    - Semi-quantitative urine markers (+, ++, +++, ++++) → numeric=null, operator=null,
      unit = that symbol, interpretation=report's flag if any.
    - Trailing flag characters that are NOT digits are NOT part of the number:
      "6.8 *" → numeric=6.8; "6.8 H" → numeric=6.8, interpretation="high"; "140↑" → numeric=140, interpretation="high".
    - If the number itself is clearly garbled by OCR ("6 . 8", "6,8", "68" where 6.8 was expected) set confidence < 0.5
      and add a warning. Do NOT "correct" the number.
V3. Qualitative results ("Positive", "Negative", "Reactive", "Non-Reactive", "Detected", "Not Detected",
    "Nil", "NAD", "No growth"):
    numeric=null, operator=null, observed_value_raw = exact phrase, interpretation derived from the flag or "unknown".

══════════ UNITS (CANONICAL) ══════════

U1. Normalize unit text (case-insensitive match → canonical):
    - mg/dl | mg/100ml | mg%  → "mg/dL"
    - g/dl | gm/dl | gms/dl   → "g/dL"
    - ng/ml | ng/mL           → "ng/mL"
    - pg/ml | pg/mL           → "pg/mL"
    - mU/L | uU/mL | mIU/L    → preserve as-is (don't convert values)
    - IU/L | U/L              → preserve as-is
    - µg/dL | ug/dL | mcg/dL  → "µg/dL"
    - 10^6/µL | million/cumm | mill/cmm | x10⁶/cumm → "million/cumm"
    - 10^3/µL | thousand/cumm | thou/cmm → "thousand/cumm"
    - mmol/L | mmols/L        → "mmol/L"
U2. If the report prints a unit row-by-row, attach that unit to each value in that row.
U3. If a value has no printed unit, leave observed_value_unit = null. Do NOT fill from memory.

══════════ REFERENCE RANGES ══════════

R1. "13.0 - 17.0 g/dL" / "13.0–17.0 g/dL" → low=13.0, high=17.0, reference_unit="g/dL".
R2. "Up to 200" / "< 200" / "≤ 200" → low=null, high=200.
R3. "> 40" / "≥ 40" → low=40, high=null.
R4. Sex-specific: "Male: 13.5–17.5 / Female: 11.5–15.5" → reference_interval_raw = full string;
    set low/high to the widest combined range (11.5–17.5 here). Do not try to pick a sex.
R5. Multi-category (LDL, HbA1c):
    "Desirable: <100 | Near-optimal: 100-129 | Borderline: 130-159 | High: 160-189 | Very High: ≥190"
    → reference_interval_raw = full line; low/high from the FIRST ("Desirable" / "Optimal" / "Normal") band.
    For HbA1c: "Normal: <5.7 | Prediabetes: 5.7-6.4 | Diabetic: ≥6.5" → low=null, high=5.7.
R6. Age-specific ranges: use the adult range by default. reference_interval_raw keeps the full text.
R7. Never copy the range INTO observed_value_raw. They are distinct fields.

══════════ FLAGS & INTERPRETATION ══════════

F1. Interpretation values: "low" | "normal" | "high" | "unknown".
F2. If the report prints a flag next to the value, ALWAYS honour it:
    - "H" / "HIGH" / "High" / "Abnormal" / "A" / "Critical" / "*" / "**" / "↑" / "↑↑" / "!!!"  → "high"
    - "L" / "LOW" / "Low" / "↓" / "↓↓"                                                        → "low"
    - "N" / "NORMAL" / "Normal" / "WNL"                                                       → "normal"
F3. If no flag is printed, derive from numeric comparison to reference range (honour operator):
    - observed_value_operator "<" with numeric=V, reference high=H: if V ≤ H → normal, else high.
    - observed_value_operator ">" with numeric=V, reference low=L: if V ≥ L → normal, else low.
F4. Use "unknown" only when value is qualitative AND there is no explicit flag.

══════════ CONFIDENCE ══════════

C1. Per-test confidence:
    - 0.90–1.00: value, unit, and range all clearly printed & parsed
    - 0.70–0.90: value clear, unit or range inferred / partially parsed
    - 0.50–0.70: value present but unit missing or range ambiguous
    - < 0.50:   value unclear, OCR noise suspected, test name ambiguous → also add to warnings[]
C2. Overall report confidence = average of test confidences, minus 0.1 per warning, min 0.1.

══════════ SAMPLE TYPE ══════════

S1. Extract ALL specimen types mentioned. If multiple, join with ", ".
    Canonical forms:
    Blood-derived: Whole Blood | Serum | Plasma | Capillary Blood
    Secretions/Excretory: Urine | Stool | Sputum | Saliva | Sweat | Semen
    Body-cavity fluids: CSF | Synovial Fluid | Pleural Fluid | Pericardial Fluid | Peritoneal Fluid
    Tissue/cellular: Biopsy Tissue | FNA | Skin Scrapings | Swab
S2. If the report only says "Blood":
    - CBC / Haemogram panels → "Whole Blood"
    - Chemistry / Lipid / Hormone panels → "Serum"
    - Glucose: "Whole Blood" for capillary (glucometer style), else "Serum/Plasma"
S3. If panels of different sample types coexist → join with comma.

══════════ REFERRING DOCTOR ══════════

RD1. referred_by = ONLY the referring doctor's name. Never the patient's name,
     the lab technician, the pathologist signing the report, or an ID number.
RD2. VALID labels preceding the doctor (case-insensitive):
     "Ref.By.", "Ref.Dr.", "Referred By", "Referred by", "Referring Physician",
     "Ordering Physician", "Consultant", "Requested By",
     "Reference" (ONLY when the value that follows is a name — see RD4).
RD3. INVALID labels — DO NOT extract the value that follows as referred_by
     even if it appears adjacent to a valid label. Common decoys on Indian
     lab reports:
     - "Req No", "Requisition No", "Requisition Number"
     - "Order No", "Order ID", "Order Number", "Test Order ID"
     - "Sample ID", "Specimen ID", "Barcode", "Barcode No"
     - "Report ID", "Report No", "Registration No", "Reg No", "MRN"
     - "Reference No", "Reference Number", "Reference ID"  (differs from a
       bare "Reference" label — a NUMBER after it is never a doctor)
     - "Reference Range", "Reference Interval"  (that's the ref-range column)
     - "Patient Name", "Name", "Pt. Name", "Client Name"
     - "Collected By", "Received By", "Verified By", "Approved By",
       "Reported By", "Technician", "Pathologist", "Signed By"
RD4. Format rules for the extracted value:
     a. MUST contain letters and MUST NOT be purely numeric. Any value
        matching "^[0-9-/A-Z]+$" (typical of IDs like "OR-2412345678") is
        automatically INVALID → return null.
     b. A valid doctor name has "Dr.", "DR.", "Doctor" prefix, OR a medical
        suffix (MBBS, MD, DNB, MS, MRCP, FRCS, MRCS, MRCOG, DGO, DM, DCH).
        Without those markers, prefer null over guessing.
     c. "(NN Y/M)", "(NN/M)", "(NN years)" and similar age/sex tags identify
        a PATIENT, not a doctor. If that's all you can find, return null.
     d. Return ONLY the name (e.g., "Dr. Mounica Vadlamudi"). No surrounding
        label text.
RD5. When the report shows two adjacent key-value pairs on the same visual
     line (common: "Req No: 24123456   Reference: Dr. Someone"), read
     LEFT-TO-RIGHT and pick ONLY the value whose LABEL matches RD2. A
     numeric value adjacent to "Req No" is never the answer even if
     "Reference" appears nearby.

══════════ PANEL-SPECIFIC COVERAGE ══════════

P1. CBC / Complete Hemogram — extract EVERY sub-test separately:
    Hemoglobin, Hematocrit (HCT), RBC Count, WBC Count, Platelet Count,
    MCV, MCH, MCHC, RDW-CV, RDW-SD, MPV, and EVERY differential count:
    Neutrophils %, Lymphocytes %, Monocytes %, Eosinophils %, Basophils %.
    Never merge them into one entry.
P2. Lipid Profile: Total Cholesterol, HDL Cholesterol, LDL Cholesterol, VLDL, Triglycerides,
    Non-HDL Cholesterol, Total Cholesterol/HDL Ratio, LDL/HDL Ratio.
P3. LFT: Total Bilirubin, Direct Bilirubin, Indirect Bilirubin, AST (SGOT), ALT (SGPT),
    Alkaline Phosphatase (ALP), Gamma GT (GGTP), Total Protein, Albumin, Globulin, A/G Ratio.
P4. KFT / RFT: Urea, BUN, Creatinine, eGFR, Uric Acid, Sodium, Potassium, Chloride, Calcium, Phosphorus.
P5. Thyroid Profile: TSH, T3, T4, Free T3, Free T4, (sometimes Anti-TPO / Anti-Tg).
P6. Urine Routine: Physical (colour, appearance), Chemical (pH, specific gravity, protein, glucose, ketones,
    bilirubin, urobilinogen, nitrite, leukocyte esterase), Microscopic (pus cells, RBCs, epithelial cells, casts, crystals).
    For semi-quantitative values (pH, specific gravity) extract as numeric; for symbol-based (+, ++) use
    observed_value_raw = the symbol and numeric = null.
P7. Diabetes panel: FBS, PPBS, HbA1c, Fasting Insulin (if present), HOMA-IR (if present), C-Peptide (if present).
P8. Vitamin Panel: Vitamin D (25-OH), Vitamin B12, Folate, Iron, Ferritin, TIBC, Transferrin, Homocysteine.

══════════ WHAT TO SKIP ══════════

X1. Panel / section / table headers ("Liver Function Test", "Differential Count", "Lipid Profile").
X2. Qualitative blood-smear narrative ("Macrocytic Normochromic", "Adequate platelets", "Normal morphology"),
    interpretation paragraphs, free-text comments, methodology notes.
X3. Doctor signatures, lab accreditation lines, certificate numbers, barcode / QR prompts,
    page numbers, footers, disclaimers.
X4. Empty placeholder rows ("— —", "NA", "N/A", "Not Done", "Test not performed").
X5. Risk-classification tables ("Low risk: <200, High risk: >240") — these are reference-range info,
    not standalone tests. Fold them into the reference_interval_raw of the actual test.

══════════ DEDUPLICATION ══════════

DD1. If the same test appears in multiple sections (e.g. Glucose in both Diabetes and Biochemistry panels)
     OR in a summary "Tests Outside Reference Range" / "Report Availability" block:
     extract it ONCE, using the entry with the clearest value + unit + range.
DD2. Subtle differences in naming (e.g. "Glucose - Fasting" vs "Fasting Glucose") count as the same test.

══════════ RATIOS ──

RT1. Ratio-type tests MUST appear as individual entries with their numeric value:
     Total Cholesterol/HDL Ratio, LDL/HDL Ratio, Albumin/Globulin Ratio, BUN/Creatinine Ratio.
     Do NOT skip, merge, or omit them. They often sit below the two source values in the report.

══════════ COMPLETENESS ══════════

CP1. This report may span many pages with multiple departments / panels.
     Extract EVERY test from EVERY page / section. Do NOT stop early, truncate, or sample.
     A 20-page report with CBP, lipids, LFT, electrolytes, vitamins should yield 40–80+ tests.
CP2. If you're receiving a text chunk (not the full report), extract everything visible in this chunk
     without complaining about truncation. The caller will merge chunks.

SCHEMA:
{
  "report": {
    "report_date": "YYYY-MM-DD or null",
    "date_source": "sample_collected | report_date | unknown",
    "referred_by": "string or null",
    "sample_type": "string or null",
    "confidence": 0.0
  },
  "tests": [
    {
      "raw_test_name": "string",
      "normalized_test_name": "string",
      "observed_value_raw": "string",
      "observed_value_numeric": null,
      "observed_value_operator": "< | > | = | ~ | null",
      "observed_value_unit": "string or null",
      "reference_interval_raw": "string or null",
      "reference_low": null,
      "reference_high": null,
      "reference_unit": "string or null",
      "interpretation": "low | normal | high | unknown",
      "confidence": 0.0
    }
  ],
  "warnings": []
}`;

// ─── Extraction JSON Schema (for Claude tool_use) ───────────────────────────

const LAB_REPORT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    report: {
      type: "object",
      properties: {
        report_date: {
          type: ["string", "null"],
          description: "Sample collected date in YYYY-MM-DD format. Prefer 'Sample Collected' over 'Report Date'.",
        },
        date_source: {
          type: "string",
          enum: ["sample_collected", "report_date", "unknown"],
        },
        referred_by: {
          type: ["string", "null"],
          description: "Referring doctor name from labels like 'Ref.By.', 'Ref.Dr.', 'Referred By', 'Referring Physician', 'Ordering Physician', 'Consultant', 'Requested By', or a bare 'Reference' when followed by a name. MUST contain letters, MUST NOT be purely numeric. Never a Req No / Order ID / Sample ID / Barcode / Report No / Reg No / MRN. Never a patient name. Return null if no valid doctor name found.",
        },
        sample_type: {
          type: ["string", "null"],
          description: "Specimen/sample type(s). Use canonical names (Serum, Whole Blood, Plasma, Urine, Stool, Sputum, Saliva, CSF, Synovial Fluid, etc.). If multiple types, join with ', '.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Overall confidence score for the report extraction.",
        },
      },
      required: ["report_date", "date_source", "confidence"],
    },
    tests: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          raw_test_name: { type: "string", description: "Exact test name as printed on the report." },
          normalized_test_name: { type: "string", description: "Standardized test name per rule 3 (e.g., 'Glycated Hemoglobin' → 'HbA1c', 'SGPT' → 'ALT (SGPT)')." },
          observed_value_raw: { type: "string", description: "Value exactly as printed (e.g., '14.2', '<200', 'Positive', 'Not Detected')." },
          observed_value_numeric: { type: ["number", "null"], description: "Numeric part only. Remove commas (1,200 → 1200). null for qualitative results." },
          observed_value_operator: {
            type: ["string", "null"],
            enum: ["<", ">", "=", "~", null],
            description: "Operator prefix if present: '<200' → '<', '>1.5' → '>'.",
          },
          observed_value_unit: { type: ["string", "null"], description: "Unit as printed (e.g., 'g/dL', 'mg/dL', '%', 'IU/L', 'cells/µL')." },
          reference_interval_raw: { type: ["string", "null"], description: "Reference range exactly as printed (e.g., '13.0 - 17.0 g/dL', 'Up to 200', 'Male: 13.5–17.5 / Female: 11.5–15.5')." },
          reference_low: { type: ["number", "null"], description: "Lower bound of reference range. null if only an upper bound exists." },
          reference_high: { type: ["number", "null"], description: "Upper bound of reference range. null if only a lower bound exists." },
          reference_unit: { type: ["string", "null"], description: "Unit for reference range (may differ from observed unit)." },
          interpretation: {
            type: "string",
            enum: ["low", "normal", "high", "unknown"],
            description: "Use printed flag (H/L/High/Low/Abnormal) if present; otherwise derive from value vs range. 'unknown' only when no range and no flag.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence score for this test extraction.",
          },
          source_page: {
            type: "integer",
            minimum: 1,
            description: "1-indexed PDF page this test was extracted from. Omit if unknown.",
          },
        },
        required: [
          "raw_test_name", "normalized_test_name", "observed_value_raw",
          "observed_value_numeric", "interpretation", "confidence",
        ],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Ambiguous or uncertain extractions. Add items when confidence < 0.5.",
    },
  },
  required: ["report", "tests", "warnings"],
};

// ─── Text extraction (PDF or image) ─────────────────────────────────────────

export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (mimeType === "application/pdf") {
    const { text, needsOcr } = await extractPdfText(buffer);
    if (!needsOcr) return cleanLabReportText(text);
    return text;
  }

  return "";
}

// ─── Date normalization ──────────────────────────────────────────────────────
//
// Indian lab reports use DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, "15 Jan 2024",
// "15-Jan-2024", etc. The LLM might pass these through verbatim. We normalize
// every variant to YYYY-MM-DD (ISO 8601) for the HTML date input and DB storage.

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function normalizeDate(raw: unknown): string | null {
  if (raw == null) return null;
  // Strip trailing time component (e.g. "19-01-2026 21:50" → "19-01-2026")
  const s = String(raw).trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, "").trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (Indian standard)
  const ddmmyyyy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // MM/DD/YYYY — ambiguous, but if month > 12 it must be DD/MM
  // We default to DD/MM/YYYY (Indian) for ambiguous cases
  // Already handled above

  // YYYY/MM/DD or YYYY.MM.DD
  const yyyymmdd = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD Mon YYYY or DD-Mon-YYYY or DD/Mon/YYYY (e.g. "15 Jan 2024", "15-Jan-2024")
  const ddMonYyyy = s.match(/^(\d{1,2})[/.\-\s]+([A-Za-z]+)[/.\-\s,]+(\d{4})$/);
  if (ddMonYyyy) {
    const [, d, mon, y] = ddMonYyyy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  // Mon DD, YYYY or Mon DD YYYY (e.g. "Jan 15, 2024", "January 15 2024")
  const monDdYyyy = s.match(/^([A-Za-z]+)[.\s]+(\d{1,2})[,\s]+(\d{4})$/);
  if (monDdYyyy) {
    const [, mon, d, y] = monDdYyyy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  // DD YYYY Mon or other unusual orders — try Date.parse as last resort
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    if (y > 1900 && y < 2100) {
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

// ─── Coerce varying LLM JSON shapes into our expected structure ──────────────
//
// Different models (qwen, gemma, llama, mistral, etc.) return field names in
// wildly different styles — snake_case, camelCase, abbreviated, verbose, or
// domain-specific medical terms. The functions below try every known synonym
// so extraction works regardless of the model's formatting choices.

/** Pick the first defined value from an object for a list of candidate keys. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

/** Case-insensitive pick: tries exact keys first, then lowercase match. */
function pickCI(obj: Record<string, unknown>, keys: string[]): unknown {
  // Exact match first (fast path)
  const exact = pick(obj, keys);
  if (exact !== undefined) return exact;
  // Case-insensitive fallback
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  for (const [objKey, objVal] of Object.entries(obj)) {
    if (lowerKeys.has(objKey.toLowerCase()) && objVal !== undefined) return objVal;
  }
  return undefined;
}

// ── Tests array discovery ────────────────────────────────────────────────────

const TESTS_ARRAY_KEYS = [
  "tests", "results", "test_results", "testResults",
  "data", "items", "findings", "lab_results", "labResults",
  "investigations", "parameters", "analytes", "panels",
  "test_data", "testData", "lab_tests", "labTests",
  "measurements", "observations", "entries", "records",
  "test_list", "testList", "report_items", "reportItems",
];

function findTestsArray(obj: Record<string, unknown>): unknown[] | null {
  for (const key of TESTS_ARRAY_KEYS) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  // Check one level of nesting (e.g. { data: { tests: [...] } })
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const key of TESTS_ARRAY_KEYS) {
        if (Array.isArray(nested[key])) return nested[key] as unknown[];
      }
    }
  }
  // Last resort 1: if obj has exactly one array-valued key, use it
  const arrayKeys = Object.entries(obj).filter(([, v]) => Array.isArray(v));
  if (arrayKeys.length === 1) return arrayKeys[0][1] as unknown[];

  // Last resort 2: nested-object-keyed-by-name shape. Some local models
  // (qwen2.5:14b, gemma) ignore the schema and emit `{ "TestA": {...}, "TestB": {...} }`.
  // Detect and flatten. Also handles panels: `{ "Electrolytes": { "Sodium": {...} } }`.
  const flattened = flattenNestedTestObject(obj);
  if (flattened.length > 0) {
    console.log(`[extract] findTestsArray: recovered ${flattened.length} tests from nested-object shape`);
    return flattened;
  }

  return null;
}

// Field-name patterns recognized as "this object represents a single test row".
// If any of these appear as a key on a candidate object, we treat it as a test.
const TEST_VALUE_KEY_PATTERNS = [
  /^observed[\s_-]?value$/i,
  /^value$/i, /^result$/i, /^reading$/i, /^observation$/i,
  /^actual$/i, /^measured$/i, /^observed$/i,
];

const TEST_REF_KEY_PATTERNS = [
  /^biological[\s_-]?reference[\s_-]?interval$/i,
  /^reference[\s_-]?(?:interval|range|values?)$/i,
  /^normal[\s_-]?range$/i,
  /^bio[\s_-]?ref(?:erence)?$/i,
  /^range$/i, /^ref$/i,
];

const TEST_UNIT_KEY_PATTERNS = [/^units?$/i, /^uom$/i];
const TEST_FLAG_KEY_PATTERNS = [/^flag$/i, /^status$/i, /^interpretation$/i, /^remarks?$/i];

function pickByPatterns(obj: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const [k, v] of Object.entries(obj)) {
    if (patterns.some((p) => p.test(k))) return v;
  }
  return undefined;
}

/**
 * Serialize a reference-interval value that might be a nested object into a
 * categorical string. `parseReferenceRange` downstream recognizes labels like
 * "Normal:", "Sufficiency:", etc.
 *
 *   {"Insufficiency": "20 - 30", "Sufficiency": "30 - 100"}
 *     → "Insufficiency: 20 - 30 | Sufficiency: 30 - 100"
 */
function serializeReferenceInterval(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>)
      .map(([label, val]) => `${label}: ${String(val)}`)
      .join(" | ");
  }
  return String(v);
}

/**
 * Detect if a value looks like a single test-row object (has some form of
 * "Observed Value" as a direct key).
 */
function looksLikeTestRow(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.some((k) => TEST_VALUE_KEY_PATTERNS.some((p) => p.test(k)));
}

/**
 * Convert nested-object shapes into an array of test rows. Handles:
 *
 *   Flat:    { "HbA1c":       { "Observed Value": ...", "Ref": "..." } }
 *   Panels:  { "Electrolytes": { "Sodium": {...}, "Potassium": {...} } }
 *   Complex ref: reference interval that is itself a dict of categories
 *
 * Returns rows shaped like the LLM's expected array items so coerceTestRow
 * can consume them (raw_test_name / observed_value_raw / reference_interval_raw).
 */
function flattenNestedTestObject(obj: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];

  const emit = (name: string, row: Record<string, unknown>) => {
    const rawValue = pickByPatterns(row, TEST_VALUE_KEY_PATTERNS);
    const rawRef = pickByPatterns(row, TEST_REF_KEY_PATTERNS);
    const rawUnit = pickByPatterns(row, TEST_UNIT_KEY_PATTERNS);
    const rawFlag = pickByPatterns(row, TEST_FLAG_KEY_PATTERNS);

    out.push({
      raw_test_name: name,
      normalized_test_name: name,
      observed_value_raw: rawValue == null ? "" : String(rawValue),
      observed_value_unit: rawUnit == null ? null : String(rawUnit),
      reference_interval_raw: serializeReferenceInterval(rawRef),
      interpretation: rawFlag == null ? "unknown" : String(rawFlag).toLowerCase(),
      confidence: 0.7, // recovered from an alternative shape — mid confidence
    });
  };

  for (const [topName, topVal] of Object.entries(obj)) {
    if (!topVal || typeof topVal !== "object" || Array.isArray(topVal)) continue;

    if (looksLikeTestRow(topVal)) {
      // Single test — the top-level key is the test name.
      emit(topName, topVal as Record<string, unknown>);
      continue;
    }

    // Might be a panel — inspect direct children.
    for (const [subName, subVal] of Object.entries(topVal as Record<string, unknown>)) {
      if (looksLikeTestRow(subVal)) {
        emit(subName, subVal as Record<string, unknown>);
      }
    }
  }

  return out;
}

// ── Report object discovery ──────────────────────────────────────────────────

const REPORT_OBJECT_KEYS = [
  "report", "report_info", "reportInfo", "report_details", "reportDetails",
  "header", "metadata", "summary", "patient_report", "patientReport",
  "lab_report", "labReport", "report_header", "reportHeader",
  "report_data", "reportData", "info",
];

/**
 * Normalize a report object's field names to canonical keys.
 * Handles every known variant: snake_case, camelCase, abbreviations,
 * and domain-specific medical terms.
 */
function coerceReportObject(raw: Record<string, unknown>): Record<string, unknown> {
  console.log("[extract] coerceReportObject input keys:", Object.keys(raw));
  console.log("[extract] coerceReportObject input:", JSON.stringify(raw).slice(0, 500));

  const rawDate = pickCI(raw, [
    // snake_case
    "report_date", "sample_date", "collection_date", "specimen_date",
    "sample_collected_date", "sample_collection_date", "specimen_collection_date",
    "collected_date", "reported_date", "test_date",
    "date_of_report", "date_of_collection", "date_of_test",
    // camelCase
    "reportDate", "sampleDate", "collectionDate", "specimenDate",
    "collectedDate", "reportedDate", "testDate",
    // short
    "date", "collected_on", "reported_on",
  ]);

  console.log("[extract] rawDate picked:", rawDate, "→ normalizeDate:", normalizeDate(rawDate));

  const rawReferredBy = pickCI(raw, [
    // snake_case
    "referred_by", "ref_by", "ref_dr", "referring_doctor",
    "referring_physician", "ordered_by", "ordering_physician",
    "doctor", "physician", "consultant",
    // camelCase
    "referredBy", "refBy", "refDr", "referringDoctor",
    "referringPhysician", "orderedBy", "orderingPhysician",
    // legacy lab_name aliases (for backward compat with existing LLM responses)
    "lab_name", "laboratory_name", "laboratory", "lab",
    "labName", "laboratoryName",
  ]);

  const rawSampleType = pickCI(raw, [
    // snake_case
    "sample_type", "specimen_type", "specimen", "sample",
    "material", "sample_material", "specimen_material",
    // camelCase
    "sampleType", "specimenType", "sampleMaterial",
  ]);

  const cleanReferredBy = sanitizeReferredBy(rawReferredBy);
  const cleanSampleType = sanitizeSampleType(rawSampleType);

  console.log("[extract] rawReferredBy picked:", rawReferredBy, "→", cleanReferredBy);
  console.log("[extract] rawSampleType picked:", rawSampleType, "→", cleanSampleType);

  return {
    report_date: normalizeDate(rawDate),
    date_source: pickCI(raw, [
      "date_source", "dateSource", "source", "date_type", "dateType",
    ]) ?? "unknown",
    referred_by: cleanReferredBy,
    sample_type: cleanSampleType,
    confidence: pickCI(raw, [
      "confidence", "conf", "score", "accuracy",
      "certainty", "reliability",
    ]) ?? 0.5,
  };
}

/**
 * Strip patient-identity noise from a referred_by string.
 *
 * Indian lab reports often print the patient's name, age/sex, and referring
 * doctor on the same line. The LLM sometimes grabs the whole blob — or worse,
 * grabs only the patient's name. Rules, in order of precedence:
 *
 *  1. If a "Dr." / "DR." / "Doctor" token exists, extract just the doctor name.
 *  2. If a patient-identity marker (age/sex) is present, drop everything up to
 *     and including that marker — whatever's left is usually the doctor.
 *  3. If the whole string looks like a patient name (no Dr/medical suffix),
 *     return null rather than lying.
 */
function sanitizeReferredBy(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // 0. Reject ID-shape strings. Common failure: the LLM picks up a "Req No"
  //    or "Order ID" value when the report layout has "Req No: 24123456
  //    Reference: Dr. XYZ" on the same line.
  //    Match: purely digits/hyphens/slashes/dots, optionally with a short
  //    ALL-CAPS prefix or suffix (e.g. "OR-2412345678", "REQ2412345678",
  //    "SP/24/12345", "R.24.12345").
  const looksLikeId =
    /^[A-Z0-9._\-/\\]{4,}$/.test(raw)          // no lowercase letters at all
    || /^[0-9][0-9A-Z._\-/\\]{4,}$/i.test(raw) // starts with a digit
    || /^[A-Z]{1,5}[-_.]?\s*\d{3,}/i.test(raw); // short prefix + digit run
  if (looksLikeId) return null;

  // 1. "Dr. <Name>" — extract that forward
  const drMatch = raw.match(/\b(?:Dr\.?|DR\.?|Doctor)\s*\.?\s*([A-Z][A-Za-z.\s]{1,60})/);
  if (drMatch) {
    const name = `Dr. ${drMatch[1].trim()}`.replace(/\s+/g, " ");
    return name.replace(/[,\s]+$/, "").slice(0, 80) || null;
  }

  // 2. Age/sex marker anywhere — drop everything up to and including it.
  //    Handles "(53Y/M)", "(45/F)", "(60 yrs)", "M/53", "F 45".
  const ageSexRe = /\(?\s*\d{1,3}\s*(?:y|yr|yrs|years?)?\s*[/\s-]?\s*[mMfF]\s*\)?|\(?\s*[mMfF]\s*[/\s-]?\s*\d{1,3}\s*\)?/;
  const afterAge = raw.replace(new RegExp(`^.*?${ageSexRe.source}\\s*`), "").trim();
  if (afterAge && afterAge !== raw && afterAge.length > 2) {
    // Re-check for Dr. token in the stripped text
    const drInTail = afterAge.match(/\b(?:Dr\.?|DR\.?|Doctor)\s*\.?\s*([A-Z][A-Za-z.\s]{1,60})/);
    if (drInTail) {
      return `Dr. ${drInTail[1].trim()}`.replace(/\s+/g, " ").replace(/[,\s]+$/, "").slice(0, 80);
    }
    // Otherwise require a medical-looking suffix to trust it
    if (/\b(MBBS|MD|DM|DNB|MS|DO|MRCP|MRCS|FRCS|FRCP|FCPS|M\.?D\.?|Ph\.?D\.?)\b/i.test(afterAge)) {
      return afterAge.slice(0, 80);
    }
    // Can't confidently identify a doctor — discard
    return null;
  }

  // 3. Pure patient-name shapes (ALL CAPS or Title-Case-Only with NO Dr/suffix
  //    AND NO org marker).
  //
  //    Referring party can legitimately be an organization: hospitals, labs,
  //    diagnostic centers, or clinics that ordered the panel. Names like
  //    "PREVIA HEALTH PVT LTD", "APOLLO HOSPITALS", "TENET DIAGNOSTICS" are
  //    valid referred_by values and should NOT be rejected as patient names.
  const hasDrOrSuffix = /\b(?:Dr\.?|DR\.?|Doctor|MBBS|MD|DM|DNB|MS|MRCP|FRCS|FRCP)\b/i.test(raw);
  const looksLikeOrg = /\b(?:LTD|LLP|LLC|PVT|INC|CORP|CO|HOSPITALS?|CLINIC|CENTER|CENTRE|LABS?|LABORATORY|LABORATORIES|MEDICAL|HEALTHCARE|HEALTH|DIAGNOSTICS?|PATHOLOGY|IMAGING|WELLNESS)\b/i.test(raw);
  if (!hasDrOrSuffix && !looksLikeOrg) {
    // Embedded age/sex anywhere → it's the patient, not a doctor
    if (ageSexRe.test(raw)) return null;
    // ALL CAPS (common for patient names on Indian reports)
    if (/^[A-Z][A-Z\s.]{2,}$/.test(raw)) return null;
    // "Name: XYZ" label — also patient
    if (/^(?:name|patient|pt\.?)\b/i.test(raw)) return null;
  }

  return raw.slice(0, 80);
}

const KNOWN_SAMPLE_TYPES = [
  "Serum", "Plasma", "Blood", "Whole Blood", "EDTA Blood", "Citrate Plasma",
  "Urine", "Random Urine", "24 Hour Urine", "First Morning Urine",
  "Stool", "Saliva", "Sputum", "CSF", "Semen", "Synovial Fluid", "Pleural Fluid",
  "Swab", "Throat Swab", "Nasal Swab", "Vaginal Swab",
  "Tissue", "Biopsy", "Fine Needle Aspirate",
];

/**
 * Constrain sample_type to a recognizable medical specimen. If we can't
 * confidently identify one, return null so the UI shows "—" rather than junk.
 */
function sanitizeSampleType(value: unknown): string | null {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw) return null;

  // Strip labels the extractor might have kept (e.g. "Sample Type: Serum")
  raw = raw.replace(/^(?:sample\s*type|specimen\s*type|specimen|sample\s*material)\s*[:\-]?\s*/i, "").trim();
  if (!raw) return null;

  // Drop trailing lab metadata / punctuation
  raw = raw.split(/[,;|\n]/)[0].trim();
  if (raw.length < 2 || raw.length > 40) return null;

  // Try to match against known types (case-insensitive, word-boundary)
  const lower = raw.toLowerCase();
  for (const known of KNOWN_SAMPLE_TYPES) {
    if (lower === known.toLowerCase()) return known;
  }
  for (const known of KNOWN_SAMPLE_TYPES) {
    if (new RegExp(`\\b${known.toLowerCase()}\\b`).test(lower)) return known;
  }

  // Nothing recognizable — discard rather than show garbage
  return null;
}

function findReportObject(obj: Record<string, unknown>): Record<string, unknown> | null {
  // Try known report-object keys
  for (const key of REPORT_OBJECT_KEYS) {
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return coerceReportObject(val as Record<string, unknown>);
    }
  }
  // Check one level of nesting (e.g. { data: { report: {...} } })
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const key of REPORT_OBJECT_KEYS) {
        const inner = nested[key];
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          return coerceReportObject(inner as Record<string, unknown>);
        }
      }
    }
  }
  // Report fields might be at the top level with varying names
  const coerced = coerceReportObject(obj);
  if (coerced.report_date !== null || coerced.referred_by !== null) {
    return coerced;
  }
  return null;
}

// ── Test row coercion ────────────────────────────────────────────────────────

/**
 * Remap a single test object from whatever field names the LLM chose
 * to the canonical LlmRawTest shape.
 *
 * Covers snake_case, camelCase, abbreviated, verbose, and medical terms.
 */
function coerceTestRow(raw: unknown): LlmRawTest | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;

  const rawName = pickCI(t, [
    // snake_case
    "raw_test_name", "test_name", "parameter_name", "analyte_name",
    "investigation", "test_description", "lab_test",
    // camelCase
    "testName", "rawTestName", "parameterName", "analyteName",
    // short / medical
    "name", "parameter", "analyte", "test", "component",
    "marker", "biomarker", "assay", "panel_item", "panelItem",
    "description", "title", "investigation_name", "investigationName",
  ]) as string | undefined;

  const normalizedName = pickCI(t, [
    "normalized_test_name", "normalizedTestName", "normalized_name",
    "normalizedName", "standard_name", "standardName",
    "canonical_name", "canonicalName", "common_name", "commonName",
    "display_name", "displayName", "preferred_name", "preferredName",
  ]) as string | undefined;

  const valueRaw = pickCI(t, [
    // snake_case
    "observed_value_raw", "observed_value", "result_value",
    "test_result", "measured_value", "patient_value",
    "actual_value", "reported_value",
    // camelCase
    "observedValueRaw", "observedValue", "resultValue",
    "testResult", "measuredValue", "patientValue",
    // short
    "value", "result", "finding", "reading", "outcome",
    "observed", "measurement",
  ]);

  const valueNumeric = pickCI(t, [
    "observed_value_numeric", "numeric_value", "numericValue",
    "observedValueNumeric", "value_numeric", "valueNumeric",
    "numerical_value", "numericalValue",
    "number", "numeric",
  ]) as number | null | undefined;

  const valueOperator = pickCI(t, [
    "observed_value_operator", "observedValueOperator",
    "operator", "comparator", "prefix", "sign", "modifier",
    "value_operator", "valueOperator",
  ]) as string | null | undefined;

  const valueUnit = pickCI(t, [
    "observed_value_unit", "observedValueUnit",
    "unit", "units", "measurement_unit", "measurementUnit",
    "uom", "unit_of_measure", "unitOfMeasure",
    "value_unit", "valueUnit",
  ]) as string | null | undefined;

  const refRaw = pickCI(t, [
    // snake_case
    "reference_interval_raw", "reference_range", "ref_range",
    "normal_range", "biological_reference_interval",
    "normal_value", "normal_interval", "expected_range",
    "bio_ref_interval", "reference_value", "ref_interval",
    "standard_range", "typical_range",
    // camelCase
    "referenceRange", "refRange", "normalRange",
    "referenceIntervalRaw", "referenceInterval",
    "biologicalReferenceInterval", "expectedRange",
    // short
    "reference", "range", "ref",
  ]) as string | null | undefined;

  const refLow = pickCI(t, [
    "reference_low", "ref_low", "lower_limit",
    "lower_bound", "normal_low", "ref_min",
    "referenceLow", "refLow", "lowerLimit",
    "lowerBound", "normalLow", "refMin",
    "low", "lower", "min", "minimum",
  ]) as number | null | undefined;

  const refHigh = pickCI(t, [
    "reference_high", "ref_high", "upper_limit",
    "upper_bound", "normal_high", "ref_max",
    "referenceHigh", "refHigh", "upperLimit",
    "upperBound", "normalHigh", "refMax",
    "high", "upper", "max", "maximum",
  ]) as number | null | undefined;

  const refUnit = pickCI(t, [
    "reference_unit", "ref_unit", "reference_units", "ref_units",
    "referenceUnit", "refUnit", "referenceUnits", "refUnits",
  ]) as string | null | undefined;

  const interpretation = pickCI(t, [
    "interpretation", "result_flag", "abnormal_flag",
    "clinical_significance", "result_interpretation",
    "finding_status", "normal_abnormal", "evaluation",
    "resultFlag", "abnormalFlag", "resultInterpretation",
    "clinicalSignificance", "findingStatus",
    // short
    "status", "flag", "remark", "classification",
    "assessment", "indication", "outcome_status",
  ]) as string | undefined;

  const confidence = pickCI(t, [
    "confidence", "conf", "score", "certainty", "accuracy",
  ]) as number | undefined;

  const sourcePageRaw = pickCI(t, [
    "source_page", "sourcePage", "page", "page_number", "pageNumber",
    "pageNum", "page_num",
  ]);
  const sourcePage = typeof sourcePageRaw === "number" && Number.isFinite(sourcePageRaw) && sourcePageRaw > 0
    ? Math.floor(sourcePageRaw)
    : null;

  return {
    raw_test_name: rawName ?? "",
    normalized_test_name: normalizedName ?? rawName ?? "",
    observed_value_raw: valueRaw != null ? String(valueRaw) : "",
    observed_value_numeric: valueNumeric ?? null,
    observed_value_operator: valueOperator ?? null,
    observed_value_unit: valueUnit ?? null,
    reference_interval_raw: refRaw ?? null,
    reference_low: refLow ?? null,
    reference_high: refHigh ?? null,
    reference_unit: refUnit ?? null,
    interpretation: interpretation ?? "unknown",
    confidence: confidence ?? 0.5,
    source_page: sourcePage,
  };
}

function coerceLlmResponse(raw: unknown): LlmExtractionResult {
  if (!raw || typeof raw !== "object") {
    console.warn("[extract] LLM returned non-object:", typeof raw);
    return { tests: [], warnings: ["LLM returned unexpected format"] };
  }

  const obj = raw as Record<string, unknown>;

  // Debug: log the raw LLM response shape
  console.log("[extract] LLM response keys:", Object.keys(obj));
  console.log("[extract] LLM response (first 1000 chars):", JSON.stringify(raw).slice(0, 1000));

  const rawTests = findTestsArray(obj);
  const report = findReportObject(obj);

  console.log("[extract] Found report:", JSON.stringify(report));

  if (!rawTests || rawTests.length === 0) {
    console.warn("[extract] No tests array found in LLM response. Keys:", Object.keys(obj));
  }

  // Coerce each test row to handle variant field names
  const tests = (rawTests ?? [])
    .map(coerceTestRow)
    .filter((t): t is LlmRawTest => t !== null);

  return {
    report: report as LlmExtractionResult["report"],
    tests,
    warnings: (Array.isArray(obj["warnings"]) ? obj["warnings"] : []) as string[],
  };
}

// ─── Text-level fallback for report metadata ────────────────────────────────
//
// When the LLM fails to extract report_date, referred_by, or sample_type, we scan the raw text
// directly for common patterns found in Indian lab reports.

/** Labels that pdf-parse might emit right after a "Ref.By" label when the PDF
 *  uses a multi-column layout. Skip these when hunting for the actual value. */
const OTHER_LABEL_PATTERNS = [
  /^req\.?\s*no/i, /^requisition/i, /^order\s*(?:no|id)/i,
  /^name\b/i, /^age\b/i, /^gender/i, /^sex\b/i, /^dob\b/i,
  /^patient/i, /^mr\.?\s+/i,
  /^tid\b/i, /^sid\b/i, /^lab\s*id/i, /^barcode/i,
  /^reported\s*on/i, /^collected\s*on/i, /^registered\s*on/i,
  /^sample\s*(?:collected|received)/i, /^specimen\b/i, /^sample\b/i,
  /^test\s*report/i, /^ref\.?\s*by/i, /^ref\.?\s*dr/i,
  /^please\s*scan/i, /^to\s*verify/i,
  /^department\b/i, /^page\s+\d/i,
];

function looksLikeOtherLabel(line: string): boolean {
  return OTHER_LABEL_PATTERNS.some((p) => p.test(line));
}

function looksLikeReferrer(line: string): boolean {
  // Doctor prefix or medical suffix.
  if (/\b(?:Dr\.?|Doctor|MBBS|M\.?D\.?|D\.?M\.?|DNB|M\.?S\.?|MRCP|MRCS|FRCS|FRCP|FCPS|Ph\.?D\.?)\b/i.test(line)) return true;
  // Organization keyword.
  if (/\b(?:LTD|LLP|PVT|LLC|INC|CORP|HOSPITALS?|CLINIC|CENTER|CENTRE|LABS?|LABORATORY|LABORATORIES|MEDICAL|HEALTHCARE|HEALTH|DIAGNOSTICS?|PATHOLOGY|IMAGING|WELLNESS)\b/i.test(line)) return true;
  return false;
}

/**
 * Find the referring doctor/institution in the raw report text, handling
 * both same-line and pdf-parse-multi-column layouts. Returns a sanitized
 * value or null.
 */
function findReferredByInText(text: string): string | null {
  const labelRe = /\b(ref\.?\s*by\.?|ref\.?\s*dr\.?|referred\s*by|referring\s*(?:doctor|physician)|ordered\s*by|ordering\s*physician)\b/i;
  const labelMatch = text.match(labelRe);
  if (!labelMatch) return null;

  const startPos = (labelMatch.index ?? 0) + labelMatch[0].length;
  // Window big enough to cover a couple of dozen columnar entries.
  const window = text.slice(startPos, startPos + 1500);
  const lines = window.split(/\r?\n/).map((l) => l.replace(/^[:\s]+/, "").trim());

  // Attempt 1: same-line value on the label itself.
  if (lines[0] && !looksLikeOtherLabel(lines[0])) {
    const sanitized = sanitizeReferredBy(lines[0]);
    if (sanitized && looksLikeReferrer(sanitized)) return sanitized;
  }

  // Attempt 2: scan forward — first non-label line that looks like a
  // referrer (has Dr. prefix or organization keyword).
  for (let i = 1; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (!line || line.length < 2 || line.length > 100) continue;
    if (looksLikeOtherLabel(line)) continue;
    if (!looksLikeReferrer(line)) continue;
    const sanitized = sanitizeReferredBy(line);
    if (sanitized) return sanitized;
  }

  // Attempt 3: relaxed — any non-label line (accept even without markers).
  //   Only used when the earlier passes found nothing.
  for (let i = 1; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    if (!line || line.length < 3 || line.length > 100) continue;
    if (looksLikeOtherLabel(line)) continue;
    const sanitized = sanitizeReferredBy(line);
    if (sanitized) return sanitized;
  }

  return null;
}

function extractReportMetaFromText(text: string): { date: string | null; referredBy: string | null; sampleType: string | null } {
  let date: string | null = null;
  let referredBy: string | null = null;
  let sampleType: string | null = null;

  // --- Date extraction from text ---
  const dateLabelPatterns = [
    /(?:sample\s*collected|collection\s*date|specimen\s*date|collected\s*on|date\s*of\s*collection)[:\s]+([^\n,;]+)/i,
    /(?:report\s*date|reported\s*on|date\s*of\s*report|reporting\s*date)[:\s]+([^\n,;]+)/i,
    /(?:date)[:\s]+([^\n,;]+)/i,
  ];

  for (const pattern of dateLabelPatterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = normalizeDate(match[1].trim());
      if (candidate) {
        date = candidate;
        break;
      }
    }
  }

  if (!date) {
    const datePatterns = [
      /(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/,
      /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]+\d{4})/i,
      /(\d{4}-\d{2}-\d{2})/,
    ];
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        const candidate = normalizeDate(match[1].trim());
        if (candidate) {
          date = candidate;
          break;
        }
      }
    }
  }

  // --- Referred By extraction from text ---
  //
  // Two common layouts:
  //   Same-line:  "Ref.By: PREVIA HEALTH PVT LTD"
  //   Multi-col:  "Ref.By\nReq.No\nName :\n...\nPREVIA HEALTH PVT LTD\nBIL1873163\n..."
  //               (pdf-parse extracts columns as label-list-then-value-list)
  //
  // A naive regex captures the NEXT LINE after `Ref.By`, which in the
  // multi-col case is another label (`Req.No`). We need to look ahead
  // through the text and pick the first line that looks like an actual
  // referrer (contains "Dr." / MBBS / org keyword) and is NOT another label.
  referredBy = findReferredByInText(text);

  // --- Sample Type extraction from text ---
  const sampleTypePatterns = [
    /(?:sample\s*type|specimen\s*type|specimen|sample\s*material)[:\s]*([^\n,;]+)/i,
  ];

  for (const pattern of sampleTypePatterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      if (candidate.length > 1 && candidate.length < 50) {
        sampleType = sanitizeSampleType(candidate);
        if (sampleType) break;
      }
    }
  }

  return { date, referredBy, sampleType };
}

/**
 * Fill in missing reference_interval_raw values from inline
 * "Bio. Ref. Interval. :- 0.2 - 20 ng/mL" fragments in the raw pdf-parse text.
 *
 * Why this exists: the layout-strategy row parser rescues intra-row cells,
 * but Indian lab reports often emit the ref interval as a SEPARATE text
 * region below the test row, not as a cell of the same row. Docling then
 * gives us the test in one table row and the ref interval elsewhere — the
 * row parser can't see across regions.
 *
 * Approach: scan the whole document text for inline ref-interval fragments,
 * then for each test without a ref, attach the nearest fragment within a
 * 400-char window of the test name. Conservative on false positives — the
 * inline pattern demands an explicit `Ref` / `Interval` label + dash, so a
 * plain numeric range in prose won't be picked up by mistake.
 */
function fillMissingRefIntervalsFromText(result: LlmExtractionResult, text: string): void {
  if (!result.tests || result.tests.length === 0) return;

  // Range-shaped token — dash-range OR operator-anchored bound.
  // - Trailing unit groups use `[ \t]*` (not `\s*`) so a match cannot cross a
  //   newline into the next test's row (fix for `"56 - 145\nFemale : 53 - 138"`
  //   otherwise gluing into one).
  // - Excludes bare single numbers (those are almost always the observed value).
  const RANGE_TOKEN = /([<>≤≥]?\s*\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?(?:[ \t]*[\w%µμ/.]+)*|[<>≤≥]=?\s*\d+(?:\.\d+)?(?:[ \t]*[\w%µμ/.]+)*)/g;

  const ranges: Array<{ pos: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = RANGE_TOKEN.exec(text)) !== null) {
    ranges.push({ pos: m.index, text: m[0].trim() });
  }
  if (ranges.length === 0) return;

  // TOC / index-page skip. Indian lab reports typically have a page-1 index
  // that lists every test with a "Ready" / "Processing" status column but no
  // values or ranges. `indexOf(name)` naturally hits the TOC first, which has
  // no range nearby → the whole test falls off. Detect and skip.
  const TOC_STATUS = /^\s*(ready|processing|cancelled|pending|received|completed|not\s+received|reported|awaited)\b/i;

  const lowerText = text.toLowerCase();
  let filled = 0;
  const usedRangePos = new Set<number>();
  const stillMissing: Array<{ name: string; nameIdx: number }> = [];

  for (const t of result.tests) {
    if (t.reference_interval_raw) continue;
    if (!t.raw_test_name) continue;
    const nameLower = t.raw_test_name.toLowerCase().trim();
    if (nameLower.length < 5) continue; // too short → risk of matching random tokens

    // Enumerate EVERY occurrence of the name (not just the first one). The
    // page-1 TOC always contains the name; we need to skip past it to the
    // actual test row.
    const occurrences: number[] = [];
    let idx = 0;
    while ((idx = lowerText.indexOf(nameLower, idx)) !== -1) {
      occurrences.push(idx);
      idx += nameLower.length;
    }
    // Prefix fallback when the LLM extracted a longer name than what's in text.
    if (occurrences.length === 0 && nameLower.length > 15) {
      const shortName = nameLower.slice(0, 20);
      idx = 0;
      while ((idx = lowerText.indexOf(shortName, idx)) !== -1) {
        occurrences.push(idx);
        idx += shortName.length;
      }
    }
    if (occurrences.length === 0) {
      console.log(`[extract:refdbg] test name NOT FOUND in raw text: "${t.raw_test_name.slice(0, 60)}"`);
      continue;
    }

    let best: { dist: number; range: string; pos: number } | null = null;
    for (const occ of occurrences) {
      const nameEnd = occ + nameLower.length;
      // Skip TOC occurrences — where the name is immediately followed by a
      // status word ("Ready", "Processing", …).
      const contextAfter = text.slice(nameEnd, Math.min(text.length, nameEnd + 40));
      if (TOC_STATUS.test(contextAfter)) continue;

      for (const r of ranges) {
        if (usedRangePos.has(r.pos)) continue;
        // Prefer ranges AFTER the name (most Indian lab reports emit ref-range
        // below the row); allow ranges BEFORE too for the reversed linearization
        // Docling sometimes produces.
        const dist = r.pos >= nameEnd
          ? r.pos - nameEnd
          : occ - (r.pos + r.text.length);
        if (dist < 0 || dist > 400) continue;
        if (!best || dist < best.dist) best = { dist, range: r.text, pos: r.pos };
      }
    }

    if (best) {
      t.reference_interval_raw = best.range;
      usedRangePos.add(best.pos);
      filled++;
    } else {
      stillMissing.push({ name: t.raw_test_name, nameIdx: occurrences[occurrences.length - 1] });
    }
  }

  if (filled > 0) {
    console.log(`[extract] Fallback: filled ${filled} missing reference interval(s) from raw text.`);
  }
  // Debug: dump surrounding text for tests that STILL have no ref. Capped at 5
  // dumps per upload. TODO: remove once ref-range extraction is reliable.
  for (const miss of stillMissing.slice(0, 5)) {
    const from = Math.max(0, miss.nameIdx - 200);
    const to = Math.min(text.length, miss.nameIdx + miss.name.length + 350);
    const around = text.slice(from, to).replace(/\n/g, "⏎").slice(0, 700);
    console.log(`[extract:refdbg] no ref for "${miss.name.slice(0, 50)}" — text[±350]: ${around}`);
  }
  console.log(`[extract:refdbg] ranges found=${ranges.length}, tests missing ref post-fallback=${stillMissing.length}`);
}

/** Apply text-based metadata fallback when LLM missed report metadata. */
/**
 * Debug: dump ±200 chars around each metadata label so we can see exactly
 * what the fallback saw when a field ends up null. Cap output at 3 hits per
 * label to keep the log readable. TODO: remove once metadata extraction is
 * reliable across the labs you're testing.
 */
function debugDumpMetadataContext(text: string): void {
  const LABELS = [
    { name: "collection", pattern: /\b(sample\s*collected|collection\s*date|specimen\s*(?:collection|date)|collected\s*on|date\s*of\s*collection)/gi },
    { name: "report_date", pattern: /\b(report\s*date|reported\s*on|date\s*of\s*report|printed\s*on|reporting\s*date)/gi },
    { name: "referred", pattern: /\b(referr?ed\s*by|ref(?:erring)?\.?\s*(?:by|dr|physician)|ordering\s*physician|requested\s*by|req\.?\s*by|consultant)/gi },
    { name: "sample_type", pattern: /\b(sample\s*(?:type|material)|specimen\s*type|specimen)/gi },
  ];
  for (const l of LABELS) {
    l.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = l.pattern.exec(text)) !== null && count < 3) {
      const from = Math.max(0, m.index - 40);
      const to = Math.min(text.length, m.index + m[0].length + 200);
      const around = text.slice(from, to).replace(/\n/g, "⏎").replace(/\r/g, "").slice(0, 260);
      console.log(`[extract:metadbg] ${l.name} @${m.index}: ${around}`);
      count++;
    }
    if (count === 0) {
      console.log(`[extract:metadbg] ${l.name}: NO LABEL MATCH in raw text`);
    }
  }
}

function applyMetadataFallback(result: LlmExtractionResult, text: string): void {
  if (!result.report?.report_date || !result.report?.referred_by || !result.report?.sample_type) {
    const fallback = extractReportMetaFromText(text);
    if (result.report) {
      if (!result.report.report_date && fallback.date) {
        console.log("[extract] Fallback: found date in text:", fallback.date);
        result.report.report_date = fallback.date;
        result.report.date_source = "unknown";
      }
      if (!result.report.referred_by && fallback.referredBy) {
        console.log("[extract] Fallback: found referred by in text:", fallback.referredBy);
        result.report.referred_by = fallback.referredBy;
      }
      if (!result.report.sample_type && fallback.sampleType) {
        console.log("[extract] Fallback: found sample type in text:", fallback.sampleType);
        result.report.sample_type = fallback.sampleType;
      }
    } else {
      result.report = {
        report_date: fallback.date ?? null,
        date_source: fallback.date ? "unknown" : null,
        referred_by: fallback.referredBy ?? null,
        sample_type: fallback.sampleType ?? null,
        confidence: 0.3,
      };
    }
    // Dump raw-text context around each metadata label whenever ANY of the
    // three fields is still missing after fallback — helps tune the regex
    // per-lab format.
    const r = result.report;
    if (r && (!r.report_date || !r.referred_by || !r.sample_type)) {
      console.log(`[extract:metadbg] post-fallback state: date=${r.report_date ?? "∅"} referred_by=${r.referred_by ?? "∅"} sample_type=${r.sample_type ?? "∅"}`);
      debugDumpMetadataContext(text);
    }
  }
}

// ─── Call Ollama for structured parsing ──────────────────────────────────────

/**
 * Extract JSON from raw LLM output — handles markdown fences, leading
 * prose, and trailing garbage that some models produce.
 */
function extractJsonString(raw: string): string {
  const s = raw.trim();

  // Strip markdown code fences
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();

  // If the string starts with '{', find the matching closing '}'
  if (s.startsWith("{")) return s;

  // Model sometimes prefixes with prose — find first '{'
  const start = s.indexOf("{");
  if (start !== -1) {
    // Walk forward to find matching brace
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
    // Unbalanced — return from first brace to end
    return s.slice(start);
  }

  return s;
}

/**
 * Call provider.chat() and return the content string.
 * Non-streaming — simpler, has built-in retry logic in OllamaChatProvider.
 */
async function chatAndExtract(
  provider: ChatProvider,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<string> {
  const response = await provider.chat(messages, options);
  return response.content;
}

/**
 * Retry extraction by feeding the error back to the LLM so it can fix its output.
 */
async function retryWithError(
  provider: ChatProvider,
  originalMessages: ChatMessage[],
  previousOutput: string,
  errorDescription: string,
  options: ChatOptions
): Promise<string> {
  const retryMessages: ChatMessage[] = [
    ...originalMessages,
    { role: "assistant" as const, content: previousOutput },
    {
      role: "user" as const,
      content: `Your JSON was invalid: ${errorDescription}\n\nReturn ONLY a valid JSON object with a "tests" array. No explanation, no markdown fences.`,
    },
  ];
  return chatAndExtract(provider, retryMessages, options);
}

/**
 * Parse LLM output with Zod validation and automatic retry on failure.
 *
 * 1. extractJsonString() to strip fences/prose
 * 2. JSON.parse() — if fails, retry with error
 * 3. Zod validation on the "tests" array structure — if fails, retry with issues
 * 4. coerceLlmResponse() for normalization
 * 5. On all retries exhausted → return null
 */
async function parseWithRetry(
  rawContent: string,
  provider: ChatProvider,
  originalMessages: ChatMessage[],
  options: ChatOptions,
  label: string
): Promise<LlmExtractionResult | null> {
  let content = rawContent;

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    const attemptLabel = attempt === 0 ? label : `${label} retry #${attempt}`;

    if (!content.trim()) {
      console.warn(
        `[extract] ${attemptLabel}: empty response  ` +
        `(rawContent length=${rawContent.length}, trimmed length=${content.trim().length})`,
      );
      // Some vision-shaped models (qwen3-vl) silently emit `""` when they
      // can't handle a text-heavy JSON task. Fall through so the retry loop
      // can at least attempt with error feedback.
      if (attempt < MAX_VALIDATION_RETRIES) {
        console.log(`[extract] ${attemptLabel}: retrying with explicit reminder…`);
        content = await retryWithError(
          provider,
          originalMessages,
          content,
          "Response was empty. You MUST return a valid JSON object with a 'tests' array.",
          options,
        );
        continue;
      }
      return null;
    }

    // Step 1: Extract JSON string
    const jsonStr = extractJsonString(content);

    // Step 2: JSON.parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.warn(`[extract] ${attemptLabel}: JSON parse failed — ${errMsg}`);

      if (attempt < MAX_VALIDATION_RETRIES) {
        console.log(`[extract] ${attemptLabel}: retrying with error feedback...`);
        content = await retryWithError(provider, originalMessages, content, `JSON parse error: ${errMsg}`, options);
        continue;
      }
      return null;
    }

    // Step 3: Find tests array and validate with Zod
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const testsArray = findTestsArray(obj);

      if (testsArray && testsArray.length > 0) {
        // Validate structure using Zod — wrap in { tests: [...] } for validation
        const validationResult = ZLabReport.safeParse({ ...obj, tests: testsArray });

        if (!validationResult.success) {
          const issues = validationResult.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          console.warn(`[extract] ${attemptLabel}: Zod validation failed — ${issues}`);

          if (attempt < MAX_VALIDATION_RETRIES) {
            console.log(`[extract] ${attemptLabel}: retrying with validation errors...`);
            content = await retryWithError(provider, originalMessages, content, `Validation errors: ${issues}`, options);
            continue;
          }
          // Fall through — use coerceLlmResponse even if Zod fails (best effort)
        }
      }
    }

    // Step 4: coerce and return (even on validation failure — best effort)
    const result = coerceLlmResponse(parsed);
    if ((result.tests?.length ?? 0) > 0) {
      console.log(`[extract] ${attemptLabel}: validated ${result.tests!.length} tests`);
      return result;
    }

    // No tests found — retry
    console.warn(`[extract] ${attemptLabel}: no tests found in parsed output`);
    if (attempt < MAX_VALIDATION_RETRIES) {
      content = await retryWithError(
        provider, originalMessages, content,
        "No test results found in JSON. Ensure the response has a 'tests' array with at least one test.",
        options
      );
    }
  }

  return null;
}

// ─── Chunking for large reports ──────────────────────────────────────────────
//
// Large reports (>3K chars) overwhelm small models in a single pass — they
// either run out of output tokens or take too long with big context windows.
// We split the text at paragraph boundaries (~2K chars each), extract each
// chunk with context 8192, and merge the results.

// Chunking is only needed for local/Ollama models with small context windows.
// Cloud providers (Gemini, OpenAI, Claude) have 1M+ token contexts — never chunk.
// Set EXTRACT_NO_CHUNK=1 in .env to force single-pass for local models too.
//
// `providerHint` is the actual per-request provider (from getProviderForUser).
// The env-based `config.internetLlm` check WOULD misfire when the user has
// aiProvider=OLLAMA_LOCAL but INTERNET_LLM=OPENAI is also set in .env — the
// user's Ollama request would incorrectly skip chunking.
function isNoChunk(providerHint?: string) {
  if (process.env.EXTRACT_NO_CHUNK === "1") return true;
  if (providerHint === "OLLAMA_LOCAL" || providerHint === "VLLM" || providerHint === "LLAMACPP") {
    return false; // local models MUST chunk
  }
  const config = loadAIConfig();
  return !!config.internetLlm; // cloud always single-pass
}
const CHUNK_THRESHOLD = 6000; // chars — below this, single-pass is fine
const CHUNK_TARGET = 5000; // chars per chunk

/** Always split into chunks (ignores NO_CHUNK). Used as fallback when single-pass fails. */
function splitIntoChunksForced(text: string): string[] {
  if (text.length <= CHUNK_THRESHOLD) return [text];
  return doSplit(text);
}

function splitIntoChunks(text: string, providerHint?: string): string[] {
  if (isNoChunk(providerHint)) {
    const reason = loadAIConfig().internetLlm ? "cloud provider" : "EXTRACT_NO_CHUNK";
    console.log(`[extract] Full-text mode (${reason}): sending ${text.length} chars as single pass`);
    return [text];
  }

  if (text.length <= CHUNK_THRESHOLD) return [text];
  return doSplit(text);
}

function doSplit(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  // Panel headers that signal "keep the following block together"
  const PANEL_HEADERS = /(?:Complete\s+Blood|CBC|CBP|Hemogram|Liver\s+Function|LFT|Renal\s+Function|RFT|Lipid|Thyroid)/i;

  for (const para of paragraphs) {
    const wouldExceed = current.length + para.length + 2 > CHUNK_TARGET && current.length > 500;

    if (wouldExceed) {
      // Don't split if we're inside a panel section (current chunk has a panel header
      // but paragraph looks like test data) — allow up to 1.5x target
      const currentHasPanel = PANEL_HEADERS.test(current);
      const paraHasData = /:\s*\d/.test(para);

      if (currentHasPanel && paraHasData && current.length + para.length < CHUNK_TARGET * 1.5) {
        current += "\n\n" + para;
        continue;
      }

      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  console.log(`[extract] Split ${text.length} chars into ${chunks.length} chunks: [${chunks.map((c) => c.length).join(", ")}]`);
  return chunks;
}

/**
 * Extract a single chunk of text and return the coerced result.
 * Uses parseWithRetry for Zod validation + automatic retry on failure.
 */
async function extractChunk(
  provider: ChatProvider,
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  onProgress?: ProgressCallback,
  systemPrompt: string = EXTRACTION_SYSTEM_PROMPT
): Promise<LlmExtractionResult> {
  const chatOpts: ChatOptions = { temperature: 0, num_ctx: 8192 };
  const isFirstChunk = chunkIndex === 0;

  const userMsg = isFirstChunk
    ? `Here is part 1 of ${totalChunks} of a lab report:\n---\n${chunkText}\n---\n\nExtract the report metadata AND all test results found. Return ONLY the JSON object.`
    : `Here is part ${chunkIndex + 1} of ${totalChunks} of the same lab report (continue extracting):\n---\n${chunkText}\n---\n\nExtract all test results found in this section. Return ONLY the JSON object.`;

  const messages: ChatMessage[] = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMsg },
  ];

  const t0 = Date.now();
  const label = `Chunk ${chunkIndex + 1}/${totalChunks}`;
  console.log(`[extract] ${label}: ${chunkText.length} chars — sending to ${getDisplayModelName("extract")}...`);
  onProgress?.("ai", `Analyzing section ${chunkIndex + 1} of ${totalChunks}...`);

  const content = await chatAndExtract(provider, messages, chatOpts);
  const llmMs = Date.now() - t0;
  console.log(`[extract] ${label}: ${getDisplayModelName("extract")} responded in ${(llmMs / 1000).toFixed(1)}s (${content.length} chars)`);

  const result = await parseWithRetry(content, provider, messages, chatOpts, label);

  if (result) {
    const testCount = result.tests?.length ?? 0;
    console.log(`[extract] ${label}: parsed ${testCount} tests in ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
    onProgress?.("ai", `Section ${chunkIndex + 1}/${totalChunks}: found ${testCount} tests`);
    return result;
  }

  console.error(`[extract] ${label}: parse failed after retries (first 500 chars):`, content.slice(0, 500));
  onProgress?.("ai", `Section ${chunkIndex + 1}/${totalChunks}: retrying...`);
  return { tests: [], warnings: [`${label}: invalid JSON after retries`] };
}

/**
 * Merge multiple chunk results into one LlmExtractionResult.
 * Report metadata comes from the first chunk that provides it.
 * Tests are concatenated and deduplicated by raw_test_name.
 */
function mergeChunkResults(results: LlmExtractionResult[]): LlmExtractionResult {
  let report: LlmExtractionResult["report"] = undefined;
  const allTests: LlmRawTest[] = [];
  const allWarnings: string[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    // Take the first report metadata with a date
    if (!report?.report_date && r.report?.report_date) {
      report = r.report;
    } else if (!report && r.report) {
      report = r.report;
    }

    // Deduplicate tests by name+value
    for (const t of r.tests ?? []) {
      const key = `${(t.raw_test_name || t.normalized_test_name || "").toLowerCase()}|${t.observed_value_raw}`;
      if (!seen.has(key)) {
        seen.add(key);
        allTests.push(t);
      }
    }

    if (r.warnings) allWarnings.push(...r.warnings);
  }

  console.log(`[extract] Merged ${results.length} chunks → ${allTests.length} unique tests`);
  return { report, tests: allTests, warnings: allWarnings };
}

/**
 * Retrieve a compact wiki context string from an existing health wiki.
 * Returns an empty string if the user has no prior records.
 */
async function buildWikiContext(userId: string): Promise<string> {
  try {
    const entities = await prisma.document.findMany({
      where: {
        userId,
        rawContent: { contains: "type: biomarker-entity" },
      },
      select: { title: true, rawContent: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });

    if (entities.length === 0) return "";

    const lines: string[] = [
      "── HEALTH WIKI (your existing records) ──",
      "Use these biomarker names exactly for normalized_test_name when they match:",
    ];

    for (const entity of entities) {
      const match = entity.rawContent.match(/\*\*Value:\*\*\s*([^\n]+)/);
      const lastValue = match ? match[1].trim() : null;
      lines.push(lastValue ? `- ${entity.title}: last ${lastValue}` : `- ${entity.title}`);
    }

    lines.push("── END HEALTH WIKI ──");
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function callOllamaExtraction(
  text: string,
  mimeType: string,
  buffer: Buffer,
  onProgress?: ProgressCallback,
  userId?: string
): Promise<LlmExtractionResult> {
  const isImage = mimeType.startsWith("image/");
  const isScannedPdf =
    mimeType === "application/pdf" && text.trim().length < 50;

  // Prefer text path when Tesseract/pdf-parse already extracted content.
  // Vision is only needed when no usable text is available.
  const hasUsableText = text.trim().length >= 50;
  const useVision = !hasUsableText && (isImage || isScannedPdf);
  const t0 = Date.now();
  const config = loadAIConfig();

  // ── Layout strategy dispatch ──────────────────────────────────────────────
  //   EXTRACTION_STRATEGY=layout → always use PaddleOCR sidecar
  //   EXTRACTION_STRATEGY=auto   → sidecar only for image / scanned PDF
  //   EXTRACTION_STRATEGY=llm    → skip sidecar entirely (existing default)
  //
  // Any sidecar error falls through to the LLM path — extraction quality is
  // more important than architectural purity.
  const shouldTryLayout =
    config.extractionStrategy === "layout"
    || (config.extractionStrategy === "auto" && (useVision || isImage));
  if (shouldTryLayout) {
    console.log(`[extract:layout] strategy=${config.extractionStrategy} — checking sidecar at ${config.layoutSidecarUrl}...`);
    try {
      const { extractViaLayout, isSidecarReachable } = await import("./extraction/layout-strategy");
      const reachT0 = Date.now();
      const reachable = await isSidecarReachable();
      console.log(`[extract:layout] sidecar reachable: ${reachable} (${Date.now() - reachT0}ms)`);
      if (reachable) {
        onProgress?.("ai", "Running layout-first extraction (PaddleOCR sidecar)...");
        console.log(`[extract:layout] POST /analyze — first call downloads ~300 MB of models if not cached (~/.paddleocr/)`);
        const analyzeT0 = Date.now();
        const layoutResult = await extractViaLayout(buffer, mimeType);
        console.log(
          `[extract:layout] complete: ${layoutResult.tests.length} tests, ${((Date.now() - analyzeT0) / 1000).toFixed(1)}s (total ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
        );
        // Belt-and-suspenders: if the layout metadata scan missed
        // `report_date` / `referred_by` / `sample_type`, run the text-based
        // regex fallback on the pdf-parse text stream. This is the SAME
        // fallback the LLM path uses (see applyMetadataFallback), and it
        // catches formats Docling exposes as unstructured text but the
        // in-region regexes don't cover.
        applyMetadataFallback(layoutResult as LlmExtractionResult, text);
        // Fill any remaining missing reference intervals by scanning the raw
        // text for inline "Bio. Ref. Interval :- X" fragments (Indian labs
        // often emit these as separate text regions below the test row).
        fillMissingRefIntervalsFromText(layoutResult as LlmExtractionResult, text);
        return layoutResult as LlmExtractionResult;
      }
      console.warn(`[extract] EXTRACTION_STRATEGY=${config.extractionStrategy} but sidecar unreachable — falling back to LLM path`);
    } catch (err) {
      console.warn(
        `[extract] layout strategy failed — falling back to LLM path:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Resolve provider from user preferences (user.privacyMode, user.aiProvider, org default, env)
  // Falls back to env-configured provider if userId is missing (backfill paths, CLI scripts).
  let provider: ChatProvider;
  let effectiveExtractLabel: string;
  let providerId: string | undefined; // AiProvider enum value — used for chunking decisions
  if (userId) {
    const { getProviderForUser } = await import("@/lib/ai/user-provider");
    const resolved = await getProviderForUser(userId, "extract");
    provider = resolved.provider;
    effectiveExtractLabel = resolved.settings.model;
    providerId = resolved.settings.provider;
    console.log(`[extract] Extract provider resolved (${resolved.settings.source}): ${resolved.settings.provider} / ${resolved.settings.model}`);
  } else {
    provider = await getExtractProvider();
    effectiveExtractLabel = getDisplayModelName("extract");
    providerId = loadAIConfig().internetLlm ?? "OLLAMA_LOCAL";
    console.log(`[extract] Extract provider ready in ${Date.now() - t0}ms (model: ${effectiveExtractLabel})`);
  }
  // OCR model is resolved per-request below when we actually need it — skip the
  // env-derived log here since it would mislead users who have picked their own provider.

  // ── Build wiki context from user's existing health records ──────────────
  const wikiContext = userId ? await buildWikiContext(userId) : "";
  const effectiveSystemPrompt = wikiContext
    ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${wikiContext}`
    : EXTRACTION_SYSTEM_PROMPT;

  if (wikiContext) {
    console.log(`[extract] Wiki context: ${wikiContext.split("\n").length} lines injected`);
  }

  let result: LlmExtractionResult;

  // ── Native structured extraction (Claude tool_use + PDF document blocks) ──
  if (provider.extract) {
    console.log(`[extract] Using native extraction via ${effectiveExtractLabel} (tool_use + document blocks)`);
    onProgress?.("ai", `Analyzing with ${effectiveExtractLabel} (structured extraction)...`);

    const documents: DocumentBlock[] = [];
    if (mimeType === "application/pdf") {
      documents.push({ data: buffer.toString("base64"), mediaType: "application/pdf", title: "Lab Report" });
    } else if (mimeType.startsWith("image/")) {
      documents.push({ data: buffer.toString("base64"), mediaType: mimeType });
    }

    const userContent = documents.length > 0
      ? "Extract all test results from this lab report document. Follow the system prompt rules exactly."
      : `Here is the lab report text:\n---\n${text}\n---\n\nExtract all test results.`;

    try {
      const response = await provider.extract(
        effectiveSystemPrompt,
        userContent,
        documents,
        { temperature: 0, schema: LAB_REPORT_EXTRACTION_SCHEMA, schemaName: "extract_lab_report" }
      );

      const parsed = JSON.parse(response.content);
      const nativeResult = coerceLlmResponse(parsed);

      if ((nativeResult.tests?.length ?? 0) > 0) {
        applyMetadataFallback(nativeResult, text);
        fillMissingRefIntervalsFromText(nativeResult, text);
        console.log(`[extract] Native extraction: ${nativeResult.tests!.length} tests in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        onProgress?.("ai", `Found ${nativeResult.tests!.length} tests`);
        return nativeResult;
      }

      console.warn("[extract] Native extraction produced 0 tests, falling back to text-based path");
    } catch (err) {
      console.warn("[extract] Native extraction failed, falling back to text-based path:", err instanceof Error ? err.message : err);
    }
  }

  if (useVision) {
    const hasOcrModel = !!config.ocrModel;

    if (hasOcrModel) {
      // Two-step pipeline: OCR model (image→text) then extract model (text→JSON)
      let ocrProvider: ChatProvider;
      let effectiveOcrModel: string;
      const ocrT0 = Date.now();
      if (userId) {
        const { getProviderForUser } = await import("@/lib/ai/user-provider");
        const resolved = await getProviderForUser(userId, "ocr");
        ocrProvider = resolved.provider;
        effectiveOcrModel = resolved.settings.model;
        console.log(`[extract] OCR provider resolved (${resolved.settings.source}): ${resolved.settings.provider} / ${effectiveOcrModel}`);
      } else {
        effectiveOcrModel = getDisplayModelName("ocr");
        ocrProvider = await getOcrProvider();
        console.log(`[extract] OCR provider ready in ${Date.now() - ocrT0}ms (model: ${effectiveOcrModel})`);
      }
      onProgress?.("ai", `Running OCR with ${effectiveOcrModel}...`);
      const pageImages = await bufferToImageBase64s(buffer, mimeType);
      console.log(`[extract] Rasterized ${pageImages.length} page(s) for vision OCR`);
      const ocrOpts: ChatOptions = { temperature: 0, num_ctx: 8192 };
      const pageTexts: string[] = [];
      const ocrStart = Date.now();
      for (let i = 0; i < pageImages.length; i++) {
        onProgress?.("ai", `Running OCR on page ${i + 1} of ${pageImages.length}...`);
        const pageStart = Date.now();
        const ocrMessages: ChatMessage[] = [
          {
            role: "user" as const,
            content: "Extract all text from this document image. Return the raw text exactly as it appears, preserving layout and structure.",
            images: [pageImages[i]],
          },
        ];
        const pageText = await chatAndExtract(ocrProvider, ocrMessages, ocrOpts);
        const pageMs = Date.now() - pageStart;
        const elapsedS = ((Date.now() - ocrStart) / 1000).toFixed(1);
        const avgS = ((Date.now() - ocrStart) / 1000 / (i + 1)).toFixed(1);
        const remaining = pageImages.length - (i + 1);
        const etaS = (remaining * (Number(avgS))).toFixed(0);
        console.log(`[extract] OCR page ${i + 1}/${pageImages.length}: ${pageText.trim().length} chars in ${(pageMs / 1000).toFixed(1)}s (avg ${avgS}s, elapsed ${elapsedS}s, eta ~${etaS}s)`);
        if (pageText.trim()) pageTexts.push(pageText);
      }
      const ocrContent = pageTexts.join("\n\n");
      if (!ocrContent.trim()) throw new Error("OCR model returned empty text");
      console.log(`[extract] OCR step: ${ocrContent.length} chars extracted across ${pageImages.length} page(s) in ${((Date.now() - ocrStart) / 1000).toFixed(1)}s`);

      // Clean the OCR text and feed into the structured extraction pipeline
      const cleanedOcrText = cleanLabReportText(ocrContent);
      onProgress?.("ai", `Extracting structured data with ${effectiveExtractLabel}...`);

      // Now use the text path with the extract provider
      const chunks = splitIntoChunks(cleanedOcrText);
      if (chunks.length === 1) {
        const singleOpts: ChatOptions = { temperature: 0, num_ctx: 8192 };
        const singleMessages: ChatMessage[] = [
          { role: "system" as const, content: effectiveSystemPrompt },
          {
            role: "user" as const,
            content: `Here is the lab report text:\n---\n${cleanedOcrText}\n---\n\nReturn ONLY the JSON object.`,
          },
        ];
        const content = await chatAndExtract(provider, singleMessages, singleOpts);
        const singleResult = await parseWithRetry(content, provider, singleMessages, singleOpts, "OCR+Extract");
        if (singleResult && (singleResult.tests?.length ?? 0) > 0) {
          result = singleResult;
        } else {
          throw new Error("AI returned invalid JSON from OCR text extraction — try re-extracting");
        }
      } else {
        onProgress?.("ai", `Splitting OCR text into ${chunks.length} sections...`);
        const chunkResults: LlmExtractionResult[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkResult = await extractChunk(provider, chunks[i], i, chunks.length, onProgress, effectiveSystemPrompt);
          chunkResults.push(chunkResult);
        }
        result = mergeChunkResults(chunkResults);
      }
    } else {
      // Single-step: extract provider handles vision directly
      const pageImages = await bufferToImageBase64s(buffer, mimeType);
      console.log(`[extract] Rasterized ${pageImages.length} page(s) for vision`);
      onProgress?.("ai", `Analyzing ${pageImages.length} page(s) with ${effectiveExtractLabel} vision...`);
      const chatOpts: ChatOptions = { temperature: 0, num_ctx: 8192 };
      const visionMessages: ChatMessage[] = [
        {
          role: "user" as const,
          content: `${effectiveSystemPrompt}\n\nExtract all test results from this lab report. Return ONLY the JSON object.`,
          images: pageImages,
        },
      ];
      const content = await chatAndExtract(provider, visionMessages, chatOpts);
      if (!content.trim()) throw new Error("Empty response from AI provider");
      const visionResult = await parseWithRetry(content, provider, visionMessages, chatOpts, "Vision");
      if (visionResult) {
        result = visionResult;
      } else {
        throw new Error("AI returned invalid JSON from vision extraction — try re-extracting");
      }
    }
  } else {
    // Text path: chunk if large, single-pass if small.
    // Pass the resolved provider so chunking honours actual routing
    // rather than the env-configured default.
    const chunks = splitIntoChunks(text, providerId);

    if (chunks.length === 1) {
      // Local models: keep num_ctx modest. 30k chars = ~7.5k tokens.
      // A 16k context comfortably fits input + prompt + output. num_ctx=131072
      // makes Ollama allocate a giant KV cache for no benefit (~4× slower).
      // Cloud providers ignore num_ctx entirely so the value doesn't matter.
      const numCtx = isNoChunk(providerId) ? 16384 : 8192;
      const singleOpts: ChatOptions = { temperature: 0, num_ctx: numCtx };
      const singleMessages: ChatMessage[] = [
        { role: "system" as const, content: effectiveSystemPrompt },
        {
          role: "user" as const,
          content: `Here is the lab report text:\n---\n${text}\n---\n\nReturn ONLY the JSON object.`,
        },
      ];

      console.log(`[extract] Single-pass: ${text.length} chars, num_ctx: ${numCtx} — sending to ${effectiveExtractLabel}...`);
      onProgress?.("ai", `Sending full report to ${effectiveExtractLabel}...`);
      const singleT0 = Date.now();
      const content = await chatAndExtract(provider, singleMessages, singleOpts);

      console.log(`[extract] Single-pass: ${effectiveExtractLabel} responded in ${((Date.now() - singleT0) / 1000).toFixed(1)}s (${content.length} chars)`);

      const singleResult = await parseWithRetry(content, provider, singleMessages, singleOpts, "Single-pass");

      if (singleResult && (singleResult.tests?.length ?? 0) > 0) {
        result = singleResult;
        console.log(`[extract] Single-pass: parsed ${result.tests?.length ?? 0} tests in ${((Date.now() - singleT0) / 1000).toFixed(1)}s total`);
        onProgress?.("ai", `Found ${result.tests?.length ?? 0} tests`);
      } else if (text.length > CHUNK_THRESHOLD) {
        // Fallback to chunked extraction
        console.warn("[extract] Single-pass failed — falling back to chunked extraction");
        onProgress?.("ai", "Splitting report into sections for better accuracy...");
        const fallbackChunks = splitIntoChunksForced(text);
        const startTime = Date.now();
        const chunkResults: LlmExtractionResult[] = [];
        for (let i = 0; i < fallbackChunks.length; i++) {
          const chunkResult = await extractChunk(provider, fallbackChunks[i], i, fallbackChunks.length, onProgress, effectiveSystemPrompt);
          chunkResults.push(chunkResult);
        }
        const mergeT0 = Date.now();
        result = mergeChunkResults(chunkResults);
        console.log(`[extract] Fallback: ${fallbackChunks.length} chunks done in ${((Date.now() - startTime) / 1000).toFixed(1)}s, merge took ${Date.now() - mergeT0}ms`);
        onProgress?.("ai", `Merged ${fallbackChunks.length} sections — ${result.tests?.length ?? 0} unique tests`);
      } else {
        throw new Error("AI returned invalid JSON — try re-extracting");
      }
    } else {
      // Chunked extraction for large reports
      onProgress?.("ai", `Splitting into ${chunks.length} sections for analysis...`);
      const startTime = Date.now();
      const chunkResults: LlmExtractionResult[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkResult = await extractChunk(provider, chunks[i], i, chunks.length, onProgress, effectiveSystemPrompt);
        chunkResults.push(chunkResult);
      }

      const mergeT0 = Date.now();
      result = mergeChunkResults(chunkResults);
      console.log(`[extract] All ${chunks.length} chunks done in ${((Date.now() - startTime) / 1000).toFixed(1)}s, merge took ${Date.now() - mergeT0}ms`);
      onProgress?.("ai", `Merged ${chunks.length} sections — ${result.tests?.length ?? 0} unique tests`);
    }
  }

  applyMetadataFallback(result, text);
  fillMissingRefIntervalsFromText(result, text);

  console.log(`[extract] callOllamaExtraction done: ${result.tests?.length ?? 0} tests in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return result;
}

// ─── Convert normalized report to preview data ─────────────────────────────

function toExtractionData(report: NormalizedReport): ExtractionData {
  const tests: PreviewTestRow[] = report.tests.map((t) => ({
    id: crypto.randomUUID(),
    rawTestName: t.rawTestName,
    normalizedName: t.normalizedName,
    observedValueRaw: t.observedValueRaw,
    observedValueNumeric: t.observedValueNumeric,
    observedValueOperator: t.observedValueOperator,
    observedValueUnit: t.observedValueUnit,
    referenceIntervalRaw: t.referenceIntervalRaw,
    referenceLow: t.referenceLow,
    referenceHigh: t.referenceHigh,
    interpretation: t.interpretation,
    isOutOfRange: t.isOutOfRange,
    confidence: t.confidence,
  }));

  return {
    sampleCollectedOn: report.sampleCollectedOn,
    referredBy: report.referredBy,
    sampleType: report.sampleType,
    confidence: report.confidence,
    tests,
  };
}

// ─── Main extraction orchestrator ───────────────────────────────────────────

export type ProgressCallback = (step: string, message: string) => void;

/**
 * Full extraction pipeline: text extraction → LLM parsing → normalization.
 * Returns ExtractionData suitable for the preview UI.
 * Optional `onProgress` callback receives step updates for streaming UIs.
 */
export async function extractLabResults(
  buffer: Buffer,
  mimeType: string,
  synonymMap: Map<string, string>,
  onProgress?: ProgressCallback,
  userId?: string
): Promise<ExtractionData> {
  const pipelineStart = Date.now();

  onProgress?.(
    "text",
    mimeType === "application/pdf"
      ? "Ayus is extracting text from your PDF..."
      : "Ayus is reading your image..."
  );
  const textT0 = Date.now();
  const text = await extractText(buffer, mimeType);
  console.log(`[extract] Text extraction: ${((Date.now() - textT0) / 1000).toFixed(1)}s (${text.length} chars)`);

  const modelName = getDisplayModelName("extract");
  onProgress?.("ai", `Analyzing using ${modelName} model...`);
  const raw = await callOllamaExtraction(text, mimeType, buffer, onProgress, userId);

  onProgress?.("normalizing", "Normalizing test names and reference ranges...");
  const normT0 = Date.now();
  const extractProvider = await getExtractProvider();
  const normalized = await normalizeReport(raw, synonymMap, extractProvider);
  console.log(`[extract] Normalization: ${Date.now() - normT0}ms (${normalized.tests.length} tests)`);
  console.log(`[extract] Total pipeline: ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`);
  return toExtractionData(normalized);
}

/**
 * Full extraction pipeline returning the normalized report (richer than
 * ExtractionData — includes dateSource, warnings, referenceUnit).
 * Used by the worker for direct DB insertion.
 */
export async function extractLabResultsFull(
  buffer: Buffer,
  mimeType: string,
  synonymMap: Map<string, string>,
  userId?: string
): Promise<NormalizedReport> {
  const pipelineStart = Date.now();
  const text = await extractText(buffer, mimeType);
  console.log(`[extract] Text extraction: ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s (${text.length} chars)`);
  const raw = await callOllamaExtraction(text, mimeType, buffer, undefined, userId);
  const normT0 = Date.now();
  const fullProvider = await getExtractProvider();
  const result = await normalizeReport(raw, synonymMap, fullProvider);
  console.log(`[extract] Normalization: ${Date.now() - normT0}ms (${result.tests.length} tests)`);
  console.log(`[extract] Total pipeline: ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`);
  return result;
}

// Re-export for backward compatibility
export { loadSynonymMap };
