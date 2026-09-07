/**
 * Lab Report — Layout-aware extraction (Hybrid approach).
 *
 * Architecture (per the DeepLearning.AI / LandingAI hybrid slide):
 *
 *   Document ─► Layout Analysis ─► regions[{type, bbox}]
 *                                    │
 *                                    ├── type=table  ─► VLM with table-to-JSON prompt
 *                                    ├── type=text   ─► OCR text (already in region.text)
 *                                    └── type=figure ─► (not handled in this first slice)
 *
 * This first slice routes ONLY table regions through Claude (since lab-report
 * value is concentrated in tables). Text / figure / chart routing comes next.
 *
 * Run:
 *   1) start the sidecar:   cd scripts/layout-sidecar && uvicorn main:app --port 8000
 *   2) export ANTHROPIC_API_KEY=...
 *   3) npm run tutorial:lab-layout -- <path-to-lab-report.pdf-or-image>
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const LAYOUT_SIDECAR_URL = process.env.LAYOUT_SIDECAR_URL ?? "http://localhost:8000";

// ── Layout sidecar client ────────────────────────────────────────────────────

type RegionType =
  | "title"
  | "text"
  | "table"
  | "figure"
  | "figure_caption"
  | "table_caption"
  | "header"
  | "footer"
  | "reference"
  | "equation"
  | string;

type Region = {
  type: RegionType;
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

type AnalyzeResponse = { pages: Page[] };

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
  if (!res.ok) {
    throw new Error(`layout sidecar returned ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AnalyzeResponse;
}

// ── Table → JSON extractor (Claude) ──────────────────────────────────────────

type LabRow = {
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: "low" | "high" | "critical" | null;
};

type TableExtraction = {
  panel: "serum" | "urine" | "mixed" | "unknown";
  rows: LabRow[];
};

const TABLE_SYSTEM_PROMPT = `You convert a single lab-report TABLE into structured rows.

Your input is the HTML reconstruction of one table from a lab report page,
produced by a layout-analysis model. The HTML preserves cell structure but
may have minor OCR errors in cell text.

Rules:
1. Each output row corresponds to one CLINICAL test result. Skip header rows,
   sub-section labels, and blank rows.
2. "value" is preserved exactly as printed (including "<", ">", decimals,
   "Negative", "1+", etc.). Do not round, convert units, or normalize.
3. Set "flag" only if the source clearly indicates out-of-range (an "H"/"L"/"*"
   marker, or a value that falls outside the printed reference range).
4. If the table is not a lab-results table (e.g. patient demographics), return
   an empty rows array.
5. Always call extract_table_rows.`;

const TABLE_TOOL: Anthropic.Tool = {
  name: "extract_table_rows",
  description: "Emit structured lab rows from a single table.",
  input_schema: {
    type: "object",
    properties: {
      panel: {
        type: "string",
        enum: ["serum", "urine", "mixed", "unknown"],
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

async function extractTable(
  client: Anthropic,
  tableHtml: string,
  tableTextFallback: string,
): Promise<TableExtraction> {
  const userContent = tableHtml
    ? `Convert this reconstructed table into lab rows.\n\n\`\`\`html\n${tableHtml}\n\`\`\``
    : `The layout model could not reconstruct table HTML for this region. Here is the raw OCR text instead:\n\n\`\`\`\n${tableTextFallback}\n\`\`\``;

  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0,
    system: TABLE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools: [TABLE_TOOL],
    tool_choice: { type: "tool", name: "extract_table_rows" },
  });

  const response = await stream.finalMessage();
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("agent did not call extract_table_rows");
  }
  return toolUse.input as TableExtraction;
}

// ── Assembler ────────────────────────────────────────────────────────────────

type RegionExtraction = {
  page: number;
  bbox: [number, number, number, number];
  type: RegionType;
  panel?: TableExtraction["panel"];
  rows?: LabRow[];
};

async function run(filePath: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  console.log(`[layout] POST ${LAYOUT_SIDECAR_URL}/analyze  (${path.basename(filePath)})`);
  const layout = await analyzeLayout(filePath);

  const regionCounts: Record<string, number> = {};
  for (const page of layout.pages) {
    for (const r of page.regions) regionCounts[r.type] = (regionCounts[r.type] ?? 0) + 1;
  }
  console.log(
    `[layout] ${layout.pages.length} page(s); regions:`,
    Object.entries(regionCounts).map(([t, n]) => `${t}=${n}`).join(" "),
  );

  const extractions: RegionExtraction[] = [];
  for (const page of layout.pages) {
    const tables = page.regions.filter((r) => r.type === "table");
    console.log(`[router] page ${page.page}: ${tables.length} table region(s) → Claude`);
    for (const region of tables) {
      try {
        const result = await extractTable(client, region.html ?? "", region.text);
        extractions.push({
          page: page.page,
          bbox: region.bbox,
          type: region.type,
          panel: result.panel,
          rows: result.rows,
        });
        console.log(
          `  · bbox=${region.bbox.join(",")}  panel=${result.panel}  rows=${result.rows.length}`,
        );
      } catch (err) {
        console.warn(`  · bbox=${region.bbox.join(",")}  FAILED:`, err instanceof Error ? err.message : err);
      }
    }
  }

  const allRows = extractions.flatMap((e) => e.rows ?? []);
  console.log("\n=== Final ===");
  console.log(
    JSON.stringify(
      {
        sourceFile: path.basename(filePath),
        pagesAnalyzed: layout.pages.length,
        tableRegionsExtracted: extractions.length,
        totalRows: allRows.length,
        extractions,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run tutorial:lab-layout -- <path-to-lab-report>");
    process.exit(1);
  }
  const filePath = path.resolve(arg);
  await fs.access(filePath);
  await run(filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
