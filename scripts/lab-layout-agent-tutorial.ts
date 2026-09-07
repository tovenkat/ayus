/**
 * Lab Report — Hybrid + Agent extraction (Lab 3 architecture).
 *
 * Document
 *   ├─► PaddleOCR PP-Structure (sidecar) ──► regions [{id, type, bbox, text, html?}]
 *   │                                        + ordered text
 *   └─► Same call also keeps the rasterized pages cached in the sidecar so /crop
 *       can return per-region PNGs on demand.
 *
 * Outer Agent (Claude, native tool_use loop) receives:
 *   • Ordered OCR text from all regions (so it understands narrative context)
 *   • Region inventory: id, type, bbox, short preview of text
 *   • Tool: analyze_table(region_id) → returns structured rows
 *           (TS orchestration fetches the crop and runs an inner Claude call
 *            with the image, returns the structured rows to the outer agent)
 *   • Tool: submit_report(panels[], rows[], skipped_region_ids[], notes)
 *
 * The outer agent decides WHICH tables to analyze (skipping demographics,
 * footers, etc.) and assembles the final report. We never hard-code the
 * routing.
 *
 * Run:
 *   1) start the sidecar:   cd scripts/layout-sidecar && uvicorn main:app --port 8000
 *   2) export ANTHROPIC_API_KEY=...
 *   3) npm run tutorial:lab-layout-agent -- <path-to-lab-report.pdf-or-image>
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const LAYOUT_SIDECAR_URL = process.env.LAYOUT_SIDECAR_URL ?? "http://localhost:8000";
const MODEL = "claude-sonnet-4-20250514";

// ── Layout sidecar client ────────────────────────────────────────────────────

type Region = {
  id: string;
  type: string;
  bbox: [number, number, number, number];
  text: string;
  html?: string;
};

type Page = {
  page: number;
  width: number;
  height: number;
  regions: Region[];
};

type AnalyzeResponse = { analysis_id: string; pages: Page[] };

async function analyzeLayout(filePath: string): Promise<AnalyzeResponse> {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".pdf" ? "application/pdf" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    "application/octet-stream";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), path.basename(filePath));

  const res = await fetch(`${LAYOUT_SIDECAR_URL}/analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`/analyze ${res.status}: ${await res.text()}`);
  return (await res.json()) as AnalyzeResponse;
}

async function fetchCropPngBase64(analysisId: string, regionId: string): Promise<string> {
  const res = await fetch(`${LAYOUT_SIDECAR_URL}/crop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ analysis_id: analysisId, region_id: regionId }),
  });
  if (!res.ok) throw new Error(`/crop ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

// ── Inner extractor: cropped table image → structured rows ───────────────────

type LabRow = {
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: "low" | "high" | "critical" | null;
};

type TableExtraction = {
  panel: "serum" | "urine" | "mixed" | "unknown" | "not_clinical";
  rows: LabRow[];
};

const TABLE_INNER_SYSTEM = `You are extracting one TABLE from a medical lab report.

You are given the cropped PNG of a single table region. Read every row and
emit structured lab results.

Rules:
1. Skip header rows ("Test", "Result", "Reference") and any non-result rows.
2. "value" preserved exactly as printed — keep "<", ">", decimals, "Negative",
   "1+", "Trace", etc. Do not round, convert units, or normalize.
3. "flag" only when the source clearly marks out-of-range (H/L/* marker, or a
   value clearly outside the printed range). Otherwise null.
4. If the table is not clinical results (e.g. demographics, lab metadata),
   panel="not_clinical" and rows=[].
5. Always call extract_table_rows.`;

const TABLE_INNER_TOOL: Anthropic.Tool = {
  name: "extract_table_rows",
  description: "Emit structured lab rows from one table image.",
  input_schema: {
    type: "object",
    properties: {
      panel: {
        type: "string",
        enum: ["serum", "urine", "mixed", "unknown", "not_clinical"],
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
            flag: { type: ["string", "null"], enum: ["low", "high", "critical", null] },
          },
          required: ["test", "value"],
        },
      },
    },
    required: ["panel", "rows"],
  },
};

async function extractTableFromImage(
  client: Anthropic,
  imageBase64: string,
): Promise<TableExtraction> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: TABLE_INNER_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: imageBase64 },
          },
          { type: "text", text: "Extract every clinical result row from this table." },
        ],
      },
    ],
    tools: [TABLE_INNER_TOOL],
    tool_choice: { type: "tool", name: "extract_table_rows" },
  });
  const response = await stream.finalMessage();
  const tu = response.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("inner agent did not call extract_table_rows");
  return tu.input as TableExtraction;
}

// ── Outer agent: chooses which tables to analyze, assembles final report ─────

type AgentResult = {
  panels: string[];
  rows: LabRow[];
  skipped_region_ids: string[];
  notes: string;
};

const OUTER_SYSTEM = `You are extracting clinical results from a medical lab report.

You will receive:
  • the ordered OCR text from all detected regions
  • an inventory of regions, each with: id, type (table|text|title|figure|...), bbox, text-preview

You must DECIDE which TABLE regions actually contain clinical results, and
analyze each of those with the analyze_table tool. SKIP tables that are
demographics, lab metadata, footers, or doctor info — use the surrounding
text and the position of the bbox to judge.

When done, call submit_report once with the assembled rows.

Rules:
- Call analyze_table with one region_id at a time.
- Aggregate the rows across analyses; preserve values exactly as returned.
- If analyze_table returns panel="not_clinical", include that region in
  skipped_region_ids and DO NOT include its rows.
- Make notes concise: only call out genuinely surprising or ambiguous things
  (multi-column splits, missing units, illegible reference ranges).`;

const ANALYZE_TOOL: Anthropic.Tool = {
  name: "analyze_table",
  description:
    "Send a cropped table region to a vision model for structured row extraction. " +
    "Returns the rows it found and the panel type, or panel='not_clinical' if it isn't actually results.",
  input_schema: {
    type: "object",
    properties: { region_id: { type: "string", description: "e.g. 'p0-r3'" } },
    required: ["region_id"],
  },
};

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_report",
  description: "Emit the final assembled lab report. Call exactly once when done.",
  input_schema: {
    type: "object",
    properties: {
      panels: { type: "array", items: { type: "string" } },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            test: { type: "string" },
            value: { type: "string" },
            unit: { type: ["string", "null"] },
            referenceRange: { type: ["string", "null"] },
            flag: { type: ["string", "null"], enum: ["low", "high", "critical", null] },
          },
          required: ["test", "value"],
        },
      },
      skipped_region_ids: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
    required: ["panels", "rows", "skipped_region_ids", "notes"],
  },
};

function buildInventory(pages: Page[]): { orderedText: string; inventoryLines: string[] } {
  const sorted = pages.flatMap((page) =>
    [...page.regions]
      .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
      .map((r) => ({ ...r, page: page.page })),
  );

  const orderedText = sorted
    .filter((r) => r.text)
    .map((r) => `[${r.id} ${r.type}] ${r.text}`)
    .join("\n");

  const inventoryLines = sorted.map((r) => {
    const preview = (r.text ?? "").slice(0, 80).replace(/\s+/g, " ");
    return `  ${r.id}  type=${r.type}  page=${r.page}  bbox=[${r.bbox.join(",")}]  text="${preview}"`;
  });

  return { orderedText, inventoryLines };
}

async function runAgent(filePath: string): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  console.log(`[layout] POST /analyze  ${path.basename(filePath)}`);
  const layout = await analyzeLayout(filePath);
  console.log(`[layout] analysis_id=${layout.analysis_id}  pages=${layout.pages.length}`);

  const { orderedText, inventoryLines } = buildInventory(layout.pages);
  const tableCount = layout.pages.reduce(
    (n, p) => n + p.regions.filter((r) => r.type === "table").length,
    0,
  );
  console.log(`[layout] tables detected: ${tableCount}`);

  const userPrompt = `# Ordered OCR text
${orderedText}

# Region inventory
${inventoryLines.join("\n")}

Decide which table regions contain clinical results and analyze each.
Call analyze_table per region, then submit_report.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

  for (let turn = 0; turn < 25; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: OUTER_SYSTEM,
      tools: [ANALYZE_TOOL, SUBMIT_TOOL],
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      throw new Error(
        `outer agent stopped without calling submit_report (stop_reason=${response.stop_reason})`,
      );
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let submitted: AgentResult | null = null;

    for (const tu of toolUses) {
      if (tu.type !== "tool_use") continue;

      if (tu.name === "submit_report") {
        submitted = tu.input as AgentResult;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" });
        continue;
      }

      if (tu.name === "analyze_table") {
        const { region_id } = tu.input as { region_id: string };
        console.log(`[agent] analyze_table(${region_id})`);
        try {
          const png = await fetchCropPngBase64(layout.analysis_id, region_id);
          const result = await extractTableFromImage(client, png);
          console.log(`  · panel=${result.panel}  rows=${result.rows.length}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  · failed: ${msg}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({ error: msg }),
            is_error: true,
          });
        }
      }
    }

    if (submitted) return submitted;
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("outer agent exceeded 25 turns without calling submit_report");
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run tutorial:lab-layout-agent -- <path-to-lab-report>");
    process.exit(1);
  }
  const filePath = path.resolve(arg);
  await fs.access(filePath);
  const result = await runAgent(filePath);

  console.log("\n=== Final report ===");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\npanels=${result.panels.join(",") || "(none)"}  rows=${result.rows.length}  skipped=${result.skipped_region_ids.length}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
