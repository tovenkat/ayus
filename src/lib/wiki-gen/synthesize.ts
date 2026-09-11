/**
 * Wiki Synthesizer — disk-first (L2 file-over-app)
 *
 * After a lab report is extracted, generates markdown on disk:
 * 1. Lab report summary  (wiki/lab-reports/YYYY-MM-DD.md)   — grouped by category, tables per section
 * 2. Biomarker entity pages (wiki/entities/<slug>.md)       — rewritten from full DB history each time,
 *                                                              user notes between MARKER comments preserved
 * 3. Master index (wiki/index.md)
 *
 * Disk is the source of truth. After each write, the DB cache is re-indexed
 * from the on-disk content so manual Obsidian edits below the readings table
 * survive re-generation.
 */

import { prisma } from "@/lib/prisma";
import { embedPendingChunks } from "@/lib/ingestion/pipeline";
import { toSlug } from "@/lib/ingestion/parsers/markdown";
import { writeWikiPage, readWikiPage, appendLog } from "@/lib/vault";
import { indexFileFromDisk } from "@/lib/vault-reconcile";

interface ReportForWiki {
  id: string;
  sampleCollectedOn: Date | null;
  referredBy: string | null;
  sampleType: string | null;
  testResults: {
    normalizedName: string;
    observedValueRaw: string;
    observedValueNumeric: number | null;
    observedValueUnit: string | null;
    referenceIntervalRaw: string | null;
    referenceLow: number | null;
    referenceHigh: number | null;
    interpretation: string;
    isOutOfRange: boolean;
  }[];
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function isValidDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function formatDateISO(d: Date | null): string {
  // Guard invalid Dates (not just null) — d.toISOString() throws on those.
  return (isValidDate(d) ? d : new Date()).toISOString().split("T")[0];
}

function formatDateHuman(d: Date | null): string {
  // A non-null but invalid Date otherwise renders as the literal "Invalid Date".
  return isValidDate(d)
    ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Unknown date";
}

function refCell(t: { referenceIntervalRaw: string | null; referenceLow: number | null; referenceHigh: number | null }): string {
  if (t.referenceIntervalRaw) return t.referenceIntervalRaw;
  if (t.referenceLow !== null && t.referenceHigh !== null) return `${t.referenceLow}–${t.referenceHigh}`;
  if (t.referenceHigh !== null) return `≤ ${t.referenceHigh}`;
  if (t.referenceLow !== null) return `≥ ${t.referenceLow}`;
  return "—";
}

function statusCell(interp: string, outOfRange: boolean): string {
  const badge = outOfRange ? "🔴" : interp.toUpperCase() === "NORMAL" ? "🟢" : "⚪";
  const text = outOfRange ? `**${interp.toLowerCase()}**` : interp.toLowerCase();
  return `${badge} ${text}`;
}

/** Escape pipe characters and newlines that would break markdown tables. */
function safeCell(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// ── Marker-based section preservation ──────────────────────────────────────
// User notes between these markers survive regeneration.

const READINGS_START = "<!-- ayus:readings-start -->";
const READINGS_END = "<!-- ayus:readings-end -->";

/**
 * Merge new auto-generated content between the markers into the existing
 * page. Anything OUTSIDE the marker block (before start or after end) is
 * preserved verbatim — the user can add notes there and they'll survive.
 * If the existing page has no markers, everything after the first heading
 * is treated as user content and appended after the new readings section.
 */
function mergeIntoMarkers(existing: string | null, freshBetweenMarkers: string, freshHeader: string): string {
  const block = `${READINGS_START}\n${freshBetweenMarkers}\n${READINGS_END}`;

  if (!existing) {
    // Brand-new page: header + readings + a Notes section for the user.
    return `${freshHeader}\n${block}\n\n## Notes\n\n_Add your own notes here. They survive regeneration._\n`;
  }

  const startIdx = existing.indexOf(READINGS_START);
  const endIdx = existing.indexOf(READINGS_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    // Page exists without markers (from the old format) — replace it. The
    // old bullet history is fully derivable from DB so no user data lost.
    return `${freshHeader}\n${block}\n\n## Notes\n\n_Add your own notes here. They survive regeneration._\n`;
  }

  const before = existing.slice(0, startIdx).trimEnd();
  const after = existing.slice(endIdx + READINGS_END.length).trimStart();
  // Only refresh the header block if the caller wants to update it too. Here
  // we keep whatever "before" text the user has — the header from freshHeader
  // is only used when the page is being created fresh.
  return `${before}\n\n${block}\n\n${after}`.trim() + "\n";
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function synthesizeLabReport(
  userId: string,
  report: ReportForWiki
): Promise<{ pagesCreated: number; pagesUpdated: number }> {
  // ── Wiki toggle ─────────────────────────────────────────────────────────
  // When WIKI_ENABLED=false, skip the markdown disk writes (summary +
  // biomarker entity pages + master index) but STILL run the two downstream
  // tasks that matter for the rest of the app:
  //   · embedPendingChunks   → RAG chat retrieves from raw PDF chunks
  //   · detectAlertsForReport → notifications bell / biomarker alerts
  // DB rows (Report, TestResult, ...) are unaffected — those come from the
  // ingestion service upstream. The dashboard/reports UI reads from DB and
  // works regardless of this flag.
  const wikiEnabled = (process.env.WIKI_ENABLED ?? "true").toLowerCase() === "true";
  if (!wikiEnabled) {
    console.log("[wiki-gen] WIKI_ENABLED=false — skipping page writes, running embedding + alerts only");
    await runPostSideEffects(userId, report.id);
    return { pagesCreated: 0, pagesUpdated: 0 };
  }

  let pagesCreated = 0;
  let pagesUpdated = 0;

  const dateStr = formatDateISO(report.sampleCollectedOn);
  const dateFormatted = formatDateHuman(report.sampleCollectedOn);

  // Fetch canonical metadata (category, specimen, LOINC, unit) for every
  // test in this report so we can group and enrich. Single query.
  const enrichedTests = await prisma.testResult.findMany({
    where: { reportId: report.id },
    include: {
      canonical: {
        select: {
          name: true, category: true, specimen: true,
          expectedUnit: true, loincNum: true,
        },
      },
    },
  });

  const testsByCategory = new Map<string, typeof enrichedTests>();
  for (const t of enrichedTests) {
    const cat = t.canonical?.category ?? "other";
    const list = testsByCategory.get(cat) ?? [];
    list.push(t);
    testsByCategory.set(cat, list);
  }

  // ── 1. Lab Report Summary ─────────────────────────────────────────────────

  const outOfRange = enrichedTests.filter((t) => t.isOutOfRange);
  const meanConfidence = enrichedTests.length === 0
    ? 0
    : enrichedTests.reduce((s, t) => s + t.confidence, 0) / enrichedTests.length;

  let summaryMd = `---
title: Lab Report — ${dateFormatted}
tags: [lab-report, ${dateStr}]
date: ${dateStr}
type: lab-report-summary
---

# Lab Report — ${dateFormatted}

`;

  // Metadata block as a compact 2-column table (renders nicely in Obsidian).
  summaryMd += `|  |  |\n|---|---|\n`;
  if (report.referredBy) summaryMd += `| **Referred by** | ${safeCell(report.referredBy)} |\n`;
  if (report.sampleType) summaryMd += `| **Sample** | ${safeCell(report.sampleType)} |\n`;
  summaryMd += `| **Tests** | ${enrichedTests.length} total · ${outOfRange.length} out of range |\n`;
  summaryMd += `| **Confidence** | ${(meanConfidence * 100).toFixed(0)}% |\n\n`;

  if (outOfRange.length > 0) {
    summaryMd += `## 🔴 Out of Range (${outOfRange.length})\n\n`;
    summaryMd += `| Test | Value | Unit | Reference | Status |\n|---|---|---|---|---|\n`;
    for (const t of outOfRange) {
      summaryMd += `| [[${safeCell(t.normalizedName)}]] `
        + `| ${safeCell(t.observedValueRaw)} `
        + `| ${safeCell(t.observedValueUnit)} `
        + `| ${safeCell(refCell(t))} `
        + `| ${statusCell(t.interpretation, true)} |\n`;
    }
    summaryMd += "\n";
  }

  summaryMd += `## Results by Category\n\n`;

  // Deterministic category order — group known categories first, "other" last.
  const CATEGORY_ORDER = [
    "hematology", "chemistry", "lipid", "cardiac", "endocrine",
    "urinalysis", "inflammation", "coagulation", "nutrition", "other",
  ];
  const sortedCategories = Array.from(testsByCategory.keys()).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const cat of sortedCategories) {
    const rows = testsByCategory.get(cat)!;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    summaryMd += `### ${label} (${rows.length})\n\n`;
    summaryMd += `| Test | Value | Unit | Reference | Status |\n|---|---|---|---|---|\n`;
    for (const t of rows) {
      summaryMd += `| [[${safeCell(t.normalizedName)}]] `
        + `| ${safeCell(t.observedValueRaw)} `
        + `| ${safeCell(t.observedValueUnit)} `
        + `| ${safeCell(refCell(t))} `
        + `| ${statusCell(t.interpretation, t.isOutOfRange)} |\n`;
    }
    summaryMd += "\n";
  }

  const summaryRel = `lab-reports/${dateStr}.md`;
  await writeWikiPage(userId, summaryRel, summaryMd);
  await indexFileFromDisk(userId, summaryRel);
  pagesCreated++;

  // ── 2. Biomarker Entity Pages (rewritten from full history each time) ──

  for (const test of enrichedTests) {
    const slug = toSlug(test.normalizedName);
    const entityRel = `entities/${slug}.md`;

    // Full history: every TestResult for this user with the same
    // canonical link (or same normalized name if unresolved). Newest first.
    const history = await prisma.testResult.findMany({
      where: {
        userId,
        ...(test.canonicalTestId
          ? { canonicalTestId: test.canonicalTestId }
          : { normalizedName: test.normalizedName, canonicalTestId: null }),
      },
      include: {
        report: { select: { id: true, sampleCollectedOn: true, createdAt: true } },
      },
      orderBy: [
        { report: { sampleCollectedOn: "desc" } },
        { createdAt: "desc" },
      ],
    });

    // Header + metadata (rendered above the readings marker block).
    const c = test.canonical;
    const outOfRangeInHistory = history.filter((h) => h.isOutOfRange).length;

    const freshHeader = `---
title: ${test.normalizedName}
tags: [biomarker${c?.category ? `, ${c.category}` : ""}${test.isOutOfRange ? ", out-of-range" : ""}]
type: biomarker-entity
${c?.loincNum ? `loincNum: ${c.loincNum}\n` : ""}${c?.specimen ? `specimen: ${c.specimen}\n` : ""}---

# ${test.normalizedName}

Auto-updated biomarker page. The readings table below is regenerated on every new lab report; the **Notes** section at the bottom is preserved across regenerations.

|  |  |
|---|---|
${c?.category ? `| **Category** | ${c.category} |\n` : ""}${c?.specimen ? `| **Specimen** | ${c.specimen} |\n` : ""}${c?.expectedUnit ? `| **Expected unit** | ${c.expectedUnit} |\n` : ""}${c?.loincNum ? `| **LOINC** | \`${c.loincNum}\` |\n` : ""}| **Readings** | ${history.length} total · ${outOfRangeInHistory} out of range |
`;

    // Build the readings table.
    let readingsBlock = `## Readings (${history.length})\n\n`;
    if (history.length === 0) {
      readingsBlock += `_No readings yet._\n`;
    } else {
      const latest = history[0];
      readingsBlock += `**Latest:** ${latest.observedValueRaw}${latest.observedValueUnit ? ` ${latest.observedValueUnit}` : ""}`;
      const latestDate = latest.report.sampleCollectedOn ?? latest.report.createdAt;
      readingsBlock += ` on ${formatDateISO(latestDate)} · ${statusCell(latest.interpretation, latest.isOutOfRange)}`;

      // Percent change vs prior numeric reading
      const priorNumeric = history.slice(1).find((h) => h.observedValueNumeric !== null);
      if (latest.observedValueNumeric !== null && priorNumeric?.observedValueNumeric !== undefined && priorNumeric?.observedValueNumeric !== null) {
        const diff = latest.observedValueNumeric - priorNumeric.observedValueNumeric;
        const pct = priorNumeric.observedValueNumeric === 0
          ? 0
          : (diff / priorNumeric.observedValueNumeric) * 100;
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "▬";
        readingsBlock += ` · ${arrow} ${diff > 0 ? "+" : ""}${diff.toFixed(2)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%) vs prior`;
      }
      readingsBlock += `\n\n`;

      readingsBlock += `| Date | Value | Unit | Reference | Status | Report |\n|---|---|---|---|---|---|\n`;
      for (const h of history) {
        const hDate = h.report.sampleCollectedOn ?? h.report.createdAt;
        const hDateStr = formatDateISO(hDate);
        const hDateHuman = formatDateHuman(hDate);
        readingsBlock += `| ${hDateStr} `
          + `| ${safeCell(h.observedValueRaw)} `
          + `| ${safeCell(h.observedValueUnit)} `
          + `| ${safeCell(refCell(h))} `
          + `| ${statusCell(h.interpretation, h.isOutOfRange)} `
          + `| [[Lab Report — ${hDateHuman}]] |\n`;
      }
    }

    // Merge into existing page — preserves user Notes below the block.
    const existing = await readWikiPage(userId, entityRel);
    const finalMd = mergeIntoMarkers(existing, readingsBlock, freshHeader);
    await writeWikiPage(userId, entityRel, finalMd);
    await indexFileFromDisk(userId, entityRel);
    if (existing) pagesUpdated++;
    else pagesCreated++;
  }

  // ── 3. Master Index ─────────────────────────────────────────────────────

  await updateMasterIndex(userId);

  // ── 4 + 5. Post-write side effects (embedding + alerts) ────────────────

  await runPostSideEffects(userId, report.id);

  await appendLog(
    userId,
    `lab report ${dateStr}: ${pagesCreated} page(s) created, ${pagesUpdated} updated`,
  );

  console.log(`[wiki-gen] Lab report ${dateStr}: ${pagesCreated} created, ${pagesUpdated} updated`);
  return { pagesCreated, pagesUpdated };
}

/**
 * Fire the two things that must happen after each extracted report,
 * regardless of whether wiki markdown was written:
 *  1. Embed any pending chunks so RAG chat has fresh context
 *  2. Detect biomarker alerts vs prior baseline
 * Both are best-effort — errors are logged, never re-thrown.
 */
async function runPostSideEffects(userId: string, reportId: string): Promise<void> {
  try {
    let batch = await embedPendingChunks(userId);
    while (batch > 0) batch = await embedPendingChunks(userId);
  } catch (err) {
    console.warn("[wiki-gen] Embedding failed:", err instanceof Error ? err.message : err);
  }

  try {
    const { detectAlertsForReport } = await import("@/lib/alerts");
    await detectAlertsForReport(userId, reportId);
  } catch (err) {
    console.warn("[wiki-gen] alert detection failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Regenerate the master index page on disk, then re-index into DB cache.
 */
export async function updateMasterIndex(userId: string): Promise<void> {
  const reports = await prisma.document.findMany({
    where: {
      userId,
      rawContent: { contains: "type: lab-report-summary" },
    },
    select: { slug: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const entities = await prisma.document.findMany({
    where: {
      userId,
      rawContent: { contains: "type: biomarker-entity" },
    },
    select: { slug: true, title: true },
    orderBy: { title: "asc" },
  });

  const meds = await prisma.medication.findMany({
    where: { userId, active: true },
    select: { name: true, dosage: true },
    orderBy: { name: "asc" },
  });

  let indexMd = `---
title: Health Index
tags: [index]
type: master-index
---

# Health Index

Your personal health record timeline and entity index.

## Recent Lab Reports

`;

  if (reports.length > 0) {
    indexMd += `| Report | Date |\n|---|---|\n`;
    for (const r of reports) {
      indexMd += `| [[${r.title}]] | ${r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} |\n`;
    }
  } else {
    indexMd += `_No lab reports yet. Upload a PDF to get started._\n`;
  }

  indexMd += `\n## Tracked Biomarkers\n\n`;
  if (entities.length > 0) {
    // Group by first letter for scannability.
    const byLetter = new Map<string, typeof entities>();
    for (const e of entities) {
      const letter = e.title.charAt(0).toUpperCase();
      const list = byLetter.get(letter) ?? [];
      list.push(e);
      byLetter.set(letter, list);
    }
    for (const letter of Array.from(byLetter.keys()).sort()) {
      indexMd += `### ${letter}\n`;
      for (const e of byLetter.get(letter)!) {
        indexMd += `- [[${e.title}]]\n`;
      }
      indexMd += "\n";
    }
  } else {
    indexMd += `_Biomarker pages are auto-created when lab reports are processed._\n`;
  }

  if (meds.length > 0) {
    indexMd += `\n## Active Medications\n\n`;
    indexMd += `| Medication | Dosage |\n|---|---|\n`;
    for (const m of meds) {
      indexMd += `| ${m.name} | ${m.dosage ?? "—"} |\n`;
    }
  }

  await writeWikiPage(userId, "index.md", indexMd);
  await indexFileFromDisk(userId, "index.md");
}
