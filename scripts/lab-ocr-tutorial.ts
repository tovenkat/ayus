/**
 * Lab Report OCR → Regex → Agent — tutorial script.
 *
 * Adapted from DeepLearning.AI "Document AI: From OCR to Agentic Doc Extraction" (L2),
 * targeting blood serum and urine lab reports.
 *
 * Run:   npm run tutorial:lab-ocr -- <path-to-image-or-pdf>
 *
 * NOTE: this is an educational baseline. Production extraction in this repo lives in
 * src/lib/clinical-extraction/ and skips OCR by sending the PDF directly to a vision
 * LLM — far more accurate on medical numerics. See step 5 (OCR Limitations) below.
 */

// 1. Import Libraries ────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import { createWorker } from "tesseract.js";
import Anthropic from "@anthropic-ai/sdk";

// 2. Create OCR Tool ─────────────────────────────────────────────────────────
//
// A single function that takes an image path and returns plain text.
// The agent (step 3) will call this through Claude's tool_use mechanism.
async function ocrImage(imagePath: string): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imagePath);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// 2.1. Use OCR to Parse a Sample Document ────────────────────────────────────
//
// Demo helper — useful for sanity-checking what OCR sees before regex/agent run.
async function demoOcr(imagePath: string): Promise<string> {
  console.log(`[ocr] reading ${imagePath} …`);
  const text = await ocrImage(imagePath);
  console.log("─── raw OCR text ───");
  console.log(text);
  console.log("─── end ───");
  return text;
}

// 2.2. Use Regex to Extract Information ──────────────────────────────────────
//
// Lab reports have a fairly stable shape:
//   <Test Name>   <Value>  <Unit>   <Reference Range>
// e.g. "Hemoglobin    13.5   g/dL    13.0 - 17.0"
// e.g. "Glucose, Fasting   98   mg/dL   70-100"
// e.g. "Urine - Protein    Negative          Negative"
//
// These regexes are intentionally permissive — Tesseract introduces noise
// (O ↔ 0, l ↔ 1, stray spaces) so we accept what we can and let the agent
// reconcile the rest.
export type LabRow = {
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
};

const NUMERIC_ROW =
  /^([A-Z][A-Za-z0-9 ,()/.\-']{2,40}?)\s+([<>]?\s*\d+\.?\d*)\s*([a-zA-Z%/µμ^0-9]+)?\s+([\d.]+\s*[-–]\s*[\d.]+|[<>]\s*\d+\.?\d*)?\s*$/;

const QUALITATIVE_ROW =
  /^([A-Z][A-Za-z0-9 ,()/.\-']{2,40}?)\s+(Negative|Positive|Trace|Nil|Absent|Present|Normal|Abnormal)\s+(Negative|Nil|Absent|Normal)?\s*$/i;

export function extractRowsByRegex(rawText: string): LabRow[] {
  const rows: LabRow[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = trimmed.match(NUMERIC_ROW);
    if (m) {
      rows.push({
        test: m[1].trim(),
        value: m[2].replace(/\s+/g, ""),
        unit: m[3] ?? null,
        referenceRange: m[4] ?? null,
      });
      continue;
    }

    const q = trimmed.match(QUALITATIVE_ROW);
    if (q) {
      rows.push({
        test: q[1].trim(),
        value: q[2],
        unit: null,
        referenceRange: q[3] ?? null,
      });
    }
  }
  return rows;
}

// 3. Create the Agent ────────────────────────────────────────────────────────
//
// The "agent" is a Claude conversation with two tools exposed:
//   - run_ocr           — re-run OCR on a region or whole page if the first pass is messy
//   - extract_lab_rows  — final, structured output (forces a JSON shape)
//
// The system prompt is the *real* product here — it tells Claude how to behave
// when OCR text is noisy, ambiguous, or missing units. See "explaining the chat
// prompt" in the response message that accompanies this script.

const SYSTEM_PROMPT = `You are a clinical data extractor for blood serum and urine lab reports.

Your input is OCR text from a single lab report. OCR is unreliable: characters may be
misread (O↔0, l↔1, S↔5), columns may be merged or split, and reference ranges may be
cut off. Your job is to recover the structured tests as faithfully as possible — and
to refuse to guess when the source is unreadable.

Rules:
1. Only emit a test row if you can see (a) a test name, AND (b) a value. If either is
   missing or ambiguous, omit the row rather than fabricate one.
2. Preserve the value EXACTLY as printed (including "<", ">", decimals). Do not
   round, convert units, or "normalize" qualitative results.
3. Units must match what is printed on the page. If a unit is missing in OCR but the
   test is universally reported in one unit (e.g. Hemoglobin → g/dL), you MAY infer it
   — but mark such rows with "unitInferred": true.
4. For urine dipstick rows ("Protein", "Glucose", "Ketones", "Blood", "Leukocytes",
   "Nitrite", "Bilirubin", "Urobilinogen"), accept qualitative values (Negative, Trace,
   1+, 2+, 3+, 4+).
5. Skip header rows ("Test", "Result", "Reference"), patient demographics, doctor
   names, and lab metadata. Only emit clinical results.
6. If the OCR text appears to be from a non-lab document (prescription, imaging,
   discharge summary), return an empty array and set "documentLooksWrong": true.

Always call the extract_lab_rows tool with your final output. Never reply in prose.`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_lab_rows",
  description: "Emit the final structured lab results.",
  input_schema: {
    type: "object",
    properties: {
      documentLooksWrong: {
        type: "boolean",
        description: "True if the OCR text does not appear to be a lab report.",
      },
      panel: {
        type: "string",
        enum: ["serum", "urine", "mixed", "unknown"],
        description: "Inferred panel type from test names.",
      },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            test: { type: "string" },
            value: { type: "string" },
            unit: { type: ["string", "null"] },
            referenceRange: { type: ["string", "null"] },
            unitInferred: { type: "boolean" },
            flag: {
              type: ["string", "null"],
              enum: ["low", "high", "critical", null],
              description: "Set if the value falls outside the printed reference range.",
            },
          },
          required: ["test", "value"],
        },
      },
    },
    required: ["panel", "rows"],
  },
};

const OCR_TOOL: Anthropic.Tool = {
  name: "run_ocr",
  description:
    "Re-run OCR on the source image. Use this if the initial text is unreadable or truncated.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why a re-OCR is needed (e.g. 'first pass had no numerics').",
      },
    },
    required: ["reason"],
  },
};

// 4. Run the Agent and Extract Information ───────────────────────────────────

export type AgentResult = {
  panel: "serum" | "urine" | "mixed" | "unknown";
  rows: LabRow[];
  documentLooksWrong?: boolean;
  regexRows: LabRow[]; // baseline for comparison
};

async function runAgent(imagePath: string): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  let ocrText = await ocrImage(imagePath);
  const regexRows = extractRowsByRegex(ocrText);
  console.log(`[regex] matched ${regexRows.length} rows in the first OCR pass`);

  const userPrompt = `Here is the OCR text of a single lab report page.

\`\`\`
${ocrText}
\`\`\`

Regex baseline (may be wrong, treat as a hint only):
${JSON.stringify(regexRows, null, 2)}

Extract the structured lab rows. Call extract_lab_rows when done.`;

  // Agent loop — allow up to 3 turns so it can call run_ocr once if needed.
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  for (let turn = 0; turn < 3; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [OCR_TOOL, EXTRACT_TOOL],
      messages,
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Agent did not call a tool — check the system prompt.");
    }

    if (toolUse.name === "extract_lab_rows") {
      const out = toolUse.input as {
        panel: AgentResult["panel"];
        rows: LabRow[];
        documentLooksWrong?: boolean;
      };
      return { ...out, regexRows };
    }

    if (toolUse.name === "run_ocr") {
      console.log(`[agent] requested re-OCR: ${(toolUse.input as { reason: string }).reason}`);
      ocrText = await ocrImage(imagePath); // in a real impl, vary preprocessing
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: ocrText,
          },
        ],
      });
    }
  }

  throw new Error("Agent loop exceeded 3 turns without producing extract_lab_rows");
}

// 5. OCR Limitations ─────────────────────────────────────────────────────────
//
// Tesseract on lab reports fails in predictable ways. Each one is a reason this
// project's production pipeline (src/lib/clinical-extraction/) does NOT use OCR:
//
//   • Numeric confusion: 0/O, 1/l/I, 5/S, 6/G — a hemoglobin of 13.5 may OCR as 13.S.
//   • Column collapse: when "Value" and "Unit" columns are narrow, Tesseract emits
//     "13.5g/dL" with no space, breaking the regex above.
//   • Reference ranges with en-dash (–) vs hyphen (-) vs tilde (~) — must be handled.
//   • Multi-line test names: "Total Cholesterol /\n HDL Ratio" gets split.
//   • Stamps, signatures, watermarks: ink overlays on the result column produce garbage.
//   • Scanned-from-fax PDFs: low DPI makes small footnote text (units, ranges) illegible.
//   • Multi-column layouts (e.g. CBC with diff): Tesseract reads left-to-right across
//     columns and shuffles tests.
//
// The fix the course pivots to in later lessons is layout-aware ADE (Agentic Document
// Extraction) — bounding-box-grounded extraction by a vision model. This repo skips
// straight to that approach by passing the original PDF/image to Claude as a
// `document` / `image` block, with a JSON-schema-constrained tool. See
// src/lib/ai/cloud-chat.ts `claudeExtract()` for the real implementation.

// ─── CLI entrypoint ──────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run tutorial:lab-ocr -- <path-to-image>");
    process.exit(1);
  }
  const imagePath = path.resolve(arg);
  await fs.access(imagePath);

  await demoOcr(imagePath);
  const result = await runAgent(imagePath);

  console.log("\n=== Agent output ===");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\nregex baseline: ${result.regexRows.length} rows · agent: ${result.rows.length} rows`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
