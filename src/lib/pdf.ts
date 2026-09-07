import { PDFParse } from "pdf-parse";

// Do NOT call PDFParse.setWorker("") — pdfjs-dist treats "" as falsy and
// throws "No GlobalWorkerOptions.workerSrc specified". On Node.js, pdfjs
// already defaults workerSrc to "./pdf.worker.mjs" and disables the real
// web worker, so no configuration is needed. The "pdf-parse" entry in
// next.config.ts serverExternalPackages ensures the module is loaded
// natively (not bundled), so the relative path resolves correctly.

const MIN_TEXT_LENGTH = 50;

// ─── Lab report text denoising ──────────────────────────────────────────────
//
// Multi-page Indian lab PDFs repeat headers, footers, doctor signatures, and
// interpretive paragraphs on every page. A 22-page report can produce 10K+
// tokens — way beyond a small local LLM's context window. This function strips
// the repeated boilerplate so only actual test-data rows (plus one copy of the
// header for metadata extraction) reach the model.

/** Lines matching any of these patterns are always removed. */
const STRIP_LINE_PATTERNS: RegExp[] = [
  // Doctor signatures
  /^\s*Dr\.\s*[A-Z]/,
  /^\s*Dr\s+[A-Z][a-z]+\s+[A-Z]/,
  // Designation lines (Consultant Biochemistry, Consultant Microbiologist, etc.)
  /^\s*Consultant\s+/i,
  /^\s*Sr\.?\s*Bio ?chemist/i,
  /^\s*(?:Medical|Lab)\s+Director/i,
  // MBBS / degree designation lines
  /^\s*M\.?B\.?B\.?S\.?\s/i,
  // Method lines (both standalone and parenthesized, with optional space before colon)
  /^\s*Method\s*:/i,
  /^\s*\(Method\s*:/i,
  /\tMethod\s*:/,
  // End of report markers
  /\*{0,2}End\s+Of\s+Report\*{0,2}/i,
  // Print / page metadata
  /^\s*Print\s+Date\s*:/i,
  /^\s*Page\s*:\s*\d+\s+of\s+\d+/i,
  /^\s*Page\s+\d+\s+of\s+\d+/i,
  // Page separator lines from pdf-parse (e.g. "-- 1 of 14 --")
  /^\s*--\s*\d+\s+of\s+\d+\s*--/i,
  // Footer / address lines
  /^\s*Regd\.?\s*Office\s*:/i,
  /^\s*Plot\s*#/i,
  /^\s*Ph\s*:/i,
  /^\s*www\./i,
  /^\s*https?:\/\//i,
  // Clinical-noise note lines (but NOT critical alert notes)
  /^\s*Note\s*:\s*-?\s*Suggested\s+Clinical\s+Correlation/i,
  /^\s*Note\s*:\s*Reference\s+range/i,
  /^\s*Remarks\s*:/i,
  /^\s*Report\s+Remarks\s*:/i,
  // Reference / citation lines
  /^\s*Reference\s*:/i,
  /^\s*References?\s*:/i,
  /^\s*Beckman/i,
  // "Scan to Validate" / "Scan QR to verify" QR prompts
  /^\s*Scan\s+(?:to\s+Validate|QR\s+to\s+verify)/i,
  // Lab code / barcode lines
  /^\s*Labcode\s*:/i,
  // Disclaimer lines
  /^\s*Disclaimer\s*:/i,
  // Alert lines (e.g. "Alert !!! 10-12 hours fasting is mandatory")
  /^\s*Alert\s*!+/i,
  // Method abbreviation lines (e.g. "CHOL - Cholesterol Oxidase, Esterase")
  /^\s*[A-Z]{2,6}\s+-\s+(?:Modified|Direct|Derived|Enzymatic|Biuret|Albumin|Diazonium|Calculated|IFCC)/i,
  // NCEP / guideline reference headers
  /^\s*\*REFERENCE\s+RANGES\s+AS\s+PER/i,
  // External quality control lines
  /^\s*External\s+quality\s+control/i,
  /^\s*College\s+Of\s+American/i,
  // ICP-MS method note
  /^\s*ICP\s*-\s*MASS\s+SPECTROMETRY/i,
  // Intra/Inter assay precision lines
  /^\s*Intra\s+Assay\s+Precision/i,
  /Precision\s*%?\s*CV\s*:?/i,
  // "Please correlate with clinical" noise
  /^\s*Please\s+correlate\s+with\s+clinical/i,
  // Single-line academic citations (Author et al ... year)
  /^\s*\d+\.\s*[A-Z][a-z]+\s+[A-Z]{1,3}[\s,]/,
  // Citation lines from medical journals
  /\b(?:Lancet|Ann\s+Intern\s+Med|Clin\s+Chem|Biochem|J\s+Immunol|Arthritis\s+Rheum|Clin\s+Nephrol)\b/i,
  /\bBooks-Verl/i,
  /\b(?:Ann\s+Rheum|doi:\d)/i,
  // Thyrocare method abbreviation lines with tab (e.g. "Fully Automated H.P.L.C method\tMethod :")
  /Fully\s+Automated/i,
  // "Derived from" calculation notes
  /^\s*Derived\s+from\s+/i,
  // "As per ADA Guidelines" etc.
  /^\s*As\s+per\s+[A-Z]{2,}/i,
  // "Guidance For Known Diabetics"
  /^\s*Guidance\s+For\s+Known/i,
  // "Note :" followed by general text (but NOT "Note: ..." that contains test data)
  /^\s*Note\s*:\s*The\s+Biological/i,
  /^\s*Note\s*:\s*Please\s+refer/i,
  // Report availability status lines (e.g. "GLUCOSE-6-PHOSPHATE DEHYDROGENASE Ready")
  /\bReady$/,
  // Report availability summary header
  /^\s*Report\s+Availability\s+Summary/i,
  /^\s*TEST\s+DETAILS\s+REPORT\s+STATUS/i,
  /\d+\s+Ready\s+\d+\s+Ready\s+with/,
  // "Tests Outside Reference Range" header
  /^\s*Tests?\s+Outside\s+Reference\s+Range/i,
  /^\s*Test\s+Name\s+Observed\s+Value/i,
  // Risk classification table lines (confuse the model)
  /(?:Low|Average|High|Very\s+High)\s+Risk\s*$/i,
  /(?:Low|Average|High|Very\s+High)\s+Risk\s*:/i,
  /^\s*(?:Deficiency|Insufficiency|Sufficiency|Toxicity)\s*:/i,
  // Category headers in summary table (ARTHRITIS, CARDIAC RISK MARKERS, etc.)
  /^\s*(?:ARTHRITIS|CARDIAC\s+RISK|COMPLETE\s+HEMOGRAM|DIABETES|ELECTROLYTES|ELEMENTS|G6PD|LIPID|LIVER|OTHER\s+COUNTS|PANCREATIC|RENAL|VITAMINS)\s*$/i,
  // Lipid NCEP classification table lines
  /^\s*>?\d+\s+(?:VERY\s+HIGH|HIGH|BORDERLINE|NORMAL|DESIRABLE|OPTIMAL|NEAR\s+OPTIMAL|LOW)\s*$/i,
  /\(mg\/dl\)\s+(?:TRIGLYCERIDES|LDL|HDL|TOTAL)/i,
  // Processed At header
  /^\s*Processed\s+At\s*:/i,
  // Tests Done header
  /^\s*Tests\s+Done\s*:/i,
  // Bio. Ref. Interval header
  /^\s*Bio\.\s*Ref\.\s*Interval/i,
  // Panel profile names (e.g. "AAROGYAM F PLUS PROFILE WITH")
  /^\s*AAROGYAM\s+/i,
  // "Sample Collected At" (without data)
  /^\s*Sample\s+Collected\s+At\s*$/i,
  // "Note : Kindly correlate clinically"
  /^\s*Note\s*:?\s*Kindly\s+correlate\s+clinically/i,
  // "Note: Biological Reference Ranges are changed ..."
  /^\s*Note\s*:?\s*Biological\s+Reference\s+Ranges?\s+are/i,
  // "* Sample processed at ..."
  /^\s*\*?\s*Sample\s+processed\s+at\s+/i,
  // Lab address lines (common in Indian reports)
  /^\s*\d+\s+\w+\s+Towers?\s*,/i,
  // "PLEASE SCAN QR CODE" / "TO VERIFY THE REPORT"
  /^\s*PLEASE\s+SCAN\s+QR/i,
  /^\s*TO\s+VERIFY\s+THE\s+REPORT/i,
  // Lab taglines
  /^\s*It'?s?\s+Good\s+to\s+Know/i,
  // Certificate number lines
  /^\s*Certificate\s+No\.?\s*/i,
  // TEST REPORT header
  /^\s*TEST\s+REPORT\s*$/i,
  // "Kindly correlate clinically" standalone
  /^\s*Kindly\s+correlate\s+clinically\s*$/i,
  // Thyrocare disclaimer continuation
  /^\s*interpretation,\s+kindly\s+refer/i,
  // Absence/Presence interpretation lines
  /^\s*Absence\s+of\s+IgG/i,
  /^\s*Presence\s+of\s+IgG/i,
  // Negative/Positive classification lines
  /^\s*Negative\s*:\s*</,
  /^\s*Positive\s*:\s*[=>]/,
  // Hyperhomocysteinemia classification
  /^\s*(?:Mild|Moderate|Severe)\s+Hyperhomocysteinemia/i,
  // Diabetic control classification lines
  /^\s*Below\s+\d+.*:\s*(?:Normal|Good|Fair|Pre)/i,
  /^\s*>=?\d+.*:\s*(?:Diabetic|Poor)/i,
  /^\s*\d+.*%\s*-\s*\d+.*:\s*(?:Fair|Unsatisfactory)/i,
  // ESR age-specific ranges
  /^\s*[<>]\s*\d+\s*yr\s*:/i,
  /^\s*Children\s*:/i,
];

/** Block-start markers — everything from here to next test heading is noise. */
const BLOCK_START_PATTERNS: RegExp[] = [
  // Peripheral blood smear observations (qualitative, not test data)
  /^\s*PERIPHERAL\s+BLOOD\s+(?:PICTURE|SMEAR|FILM)\s*$/i,
  // "Interpretation", "Interpretation:", "INTERPRETATION:-", "Interpretation: -", "Intepretation:" (typo in some labs)
  /^\s*Int[e]?rpretation\s*:?\s*-?\s*$/i,
  // "Interpretation: <text>" inline (Tenet Diagnostics - followed by clinical description)
  /^\s*Int[e]?rpretation\s*:\s*[A-Z]/i,
  // "Increased :", "Increased:", "Increased In"
  /^\s*Increased\s*(?:In\b|:)/i,
  // "Decreased :", "Decreased:", "Decreased In"
  /^\s*Decreased\s*(?:In\b|:)/i,
  /^\s*Use\s*:/i,
  /^\s*Criteria\s+for\s+diagnosis/i,
  // Clinical significance blocks (Thyrocare, SRL, Metropolis)
  /^\s*Clinical\s+Significance\s*[;:]/i,
  /^\s*Clinical\s+significance\s*$/i,
  // Specification / precision blocks
  /^\s*Specifications?\s*[;:]/i,
  /^\s*Specifications?\s*$/i,
  /^\s*Speficcation\s*[;:]/i,
  // Kit validation references
  /^\s*Kit\s+Validation\s+[Rr]eference/i,
  // Precision lines that start multi-line blocks
  /^\s*Precision\s*[:(]/i,
  // "High Values:", "Low Values:" interpretive blocks
  /^\s*High\s+Values\s*:/i,
  /^\s*Low\s+Values\s*:/i,
  // "Causes of high/low" blocks
  /^\s*Causes\s+of\s+(?:high|low|elevated|decreased)/i,
  // Lipemic sera / clinical description blocks
  /^\s*Lipemic\s+Sera/i,
  // Long clinical sentence starting (> 60 chars, starts with word, ends with period)
  // These are clinical info paragraphs, not test data
  /^\s*(?:Three\s+types\s+of|approximately\s+\d)/i,
  // "Possibly due to" interpretation text
  /^\s*>\s*\d+\.?\d*\s+-\s+Possibly/i,
  // Infection/disease explanation text
  /^\s*infection\s*,\s*active/i,
  // Disclaimer blocks (Tenet, SRL)
  /^\s*Disclaimer\s*:/i,
  // Limitations blocks (D-Dimer reports etc.)
  /^\s*Limitations?\s*:/i,
  // "Note:" followed by multi-sentence explanation (not "Note: Kindly..." which is stripped)
  /^\s*Note\s*:\s*These\s+results/i,
  /^\s*Note\s*:\s*As\s+Triglycerides/i,
  // "False Negative:" / "False Positive:" blocks
  /^\s*\d+\.\s*False\s+(?:Negative|Positive)\s*:/i,
  // HbA1c control classification blocks
  /^\s*(?:Excellent|Fair\s+to\s+Good|Unsatisfactory|Poor)\s+Control\s*[-–:]/i,
  /^\s*In\s+known\s+diabetic\s+patients/i,
];

/**
 * Heuristic: does this line look like test data, a test name, or a section
 * heading? Used to detect where an interpretation block ends.
 */
function looksLikeTestContent(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Test value lines from pdf-parse: ": 9.9 mg/dL 8.8-10.6"
  if (/^:\s*\d/.test(trimmed)) return true;
  // Lines with numbers and units (include Unicode μ for µg/dL)
  if (/\d+\.?\d*\s*(?:g\/dL|mg\/dL|[µμu]g\/dL|[µμu]g\/L|%|mEq\/L|IU\/L|U\/L|U\/g|mmol|umol|[µμu]mol|ng\/mL|ng\/dL|pg\/mL|fL|mill|thou|lakhs|cells|sec|mm\s*\/?\s*hr|nmol)/i.test(trimmed)) return true;
  // Thyrocare format: unit tab value (e.g. "mg/dL\t14.7" or "U/L\t125.1")
  if (/^(?:g\/dL|mg\/dL|[µμu]g\/dL|[µμu]g\/L|%|IU\/L|U\/L|U\/g|mmol\/L|ng\/mL|ng\/dL|pg\/mL|fL|nmol)\t/i.test(trimmed)) return true;
  // Tab-separated test data rows (value tab technology tab testname)
  if (/^\d+\.?\d*\t/.test(trimmed) || /^[<>]\s*\d/.test(trimmed)) return true;
  // Short lines starting with uppercase that don't end with punctuation are
  // likely test names or section headings (e.g. "Gamma GT (GGTP)", "Client"),
  // NOT interpretation sentences.
  if (trimmed.length < 80 && /^[A-Z(]/.test(trimmed) && !/[.!?]$/.test(trimmed)) return true;
  return false;
}

/**
 * Strip repeated headers/footers, interpretive paragraphs, and clinical noise
 * from multi-page lab PDF text. Keeps the first header block intact for
 * metadata extraction (date, doctor, sample type).
 *
 * Pass order matters:
 *   1. Count line frequencies (on raw text)
 *   2. Strip always-remove patterns (Method, Dr., signatures, footers)
 *   3. Strip interpretation blocks (Interpretation → next test content)
 *   4. Deduplicate repeated lines (header/footer boilerplate, repeated test rows)
 *   5. Collapse whitespace
 *
 * Block removal BEFORE dedup ensures interpretation markers ("Interpretation",
 * "Increased :") are still present on every page when blocks are processed.
 */
export function cleanLabReportText(raw: string): string {
  const lines = raw.split("\n");

  // ── 1. Count line frequency (exact match after trim) ──
  const freq = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  // ── 2. Strip always-remove patterns ──
  const pass1: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { pass1.push(line); continue; }
    if (STRIP_LINE_PATTERNS.some((p) => p.test(trimmed))) continue;
    pass1.push(line);
  }

  // ── 3. Strip interpretation / clinical blocks ──
  // Block starts at known markers and ends when the next line looks like
  // test content (value row, test name, or section heading).
  // When a line ends a block, it falls through to the block-start check
  // so markers like "Increased :" that end one block can start another.
  const pass2: string[] = [];
  let inBlock = false;

  for (const line of pass1) {
    const trimmed = line.trim();

    if (inBlock) {
      if (looksLikeTestContent(trimmed)) {
        inBlock = false;
        // Fall through — this line might itself be a block starter
      } else {
        // Still in block — skip this line
        continue;
      }
    }

    // Check for block start (also handles lines that just ended a block)
    if (trimmed && BLOCK_START_PATTERNS.some((p) => p.test(trimmed))) {
      inBlock = true;
      continue;
    }

    pass2.push(line);
  }

  // ── 3b. Merge orphaned value lines with their test names ──
  // pdf-parse often puts the test name on one line and ": value unit ref" on
  // the next (common in Indian lab report PDFs from Lucid, Thyrocare, etc.).
  // Merging produces "TestName: 9.0 g/dL 12.0-15.0" which the LLM can parse.
  const pass2b: string[] = [];
  for (const line of pass2) {
    const trimmed = line.trim();
    // Match lines starting with ": <digit>" or ": <operator><digit>"
    // e.g. ": 9.0 g/dL 12.0-15.0" or ": 26.8 % : 2.84 millions/cumm"
    if (/^:\s*[<>~]?\s*\d/.test(trimmed)) {
      // Find the last non-empty line and merge
      let merged = false;
      for (let i = pass2b.length - 1; i >= 0; i--) {
        if (pass2b[i].trim()) {
          pass2b[i] = pass2b[i].trimEnd() + " " + trimmed;
          merged = true;
          break;
        }
      }
      if (!merged) pass2b.push(line);
    } else {
      pass2b.push(line);
    }
  }

  // ── 4. Deduplicate repeated lines (keep first occurrence) ──
  // After block removal, remaining repeated lines are header/footer boilerplate
  // and test data appearing on multiple panel pages (e.g. Iron on TIBC page).
  const seenRepeated = new Set<string>();
  const pass3: string[] = [];

  for (const line of pass2b) {
    const trimmed = line.trim();
    if (!trimmed) { pass3.push(line); continue; }

    const count = freq.get(trimmed) ?? 0;
    if (count >= 2) {
      if (seenRepeated.has(trimmed)) continue;
      seenRepeated.add(trimmed);
    }

    pass3.push(line);
  }

  // ── 5. Collapse consecutive blank lines → single blank ──
  const result: string[] = [];
  let blankRun = 0;
  for (const line of pass3) {
    if (!line.trim()) {
      blankRun++;
      if (blankRun <= 1) result.push(line);
    } else {
      blankRun = 0;
      result.push(line);
    }
  }

  const cleaned = result.join("\n").trim();
  console.log(
    `[pdf] cleanLabReportText: ${raw.length} chars → ${cleaned.length} chars (${Math.round((1 - cleaned.length / raw.length) * 100)}% reduction)`
  );
  return cleaned;
}

export type PdfExtractionResult = {
  text: string;
  needsOcr: boolean;
};

export async function extractPdfText(
  buffer: Buffer
): Promise<PdfExtractionResult> {
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await pdf.getText();
    const text = result.text.trim();
    return {
      text,
      needsOcr: text.length < MIN_TEXT_LENGTH,
    };
  } finally {
    await pdf.destroy();
  }
}
