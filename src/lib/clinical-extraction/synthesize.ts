import { prisma } from "@/lib/prisma";
import { writeWikiPage, appendLog } from "@/lib/vault";
import { toSlug } from "@/lib/ingestion/parsers/markdown";
import { indexFileFromDisk } from "@/lib/vault-reconcile";
import { updateMasterIndex } from "@/lib/wiki-gen/synthesize";
import { sendWhatsApp } from "@/lib/twilio";
import { normalizeFrequencyToEnum } from "./prescription";
import type { ClinicalExtraction } from "./types";
import type { ClinicalReportKind, MedFrequency } from "@prisma/client";

type PersistInput = {
  userId: string;
  uploadId: string;
  kind: ClinicalReportKind;
  extraction: ClinicalExtraction | null;
  classificationConfidence: number;
};

export type PersistResult = {
  reportId: string;
  medicationsAdded: number;
  wikiPath: string | null;
};

/**
 * Persist a clinical report end-to-end:
 *  1. Create ClinicalReport row (even with minimal data if extraction was null)
 *  2. Auto-merge prescribed medications into the Medication table
 *  3. Write a wiki page under the right folder
 *  4. Append to the vault log
 *  5. Fire a WhatsApp alert for SEVERE / CRITICAL severities
 */
export async function persistClinicalReport(input: PersistInput): Promise<PersistResult> {
  const { userId, uploadId, kind, extraction, classificationConfidence } = input;

  const performedDate = extraction?.performedOn ? safeDate(extraction.performedOn) : null;
  const report = await prisma.clinicalReport.create({
    data: {
      userId,
      uploadId,
      kind,
      modality: extraction?.modality ?? null,
      bodyPart: extraction?.bodyPart ?? null,
      procedureName: extraction?.procedureName ?? null,
      performedOn: performedDate,
      referringDoctor: extraction?.referringDoctor ?? null,
      performedBy: extraction?.performedBy ?? null,
      institution: extraction?.institution ?? null,
      indication: extraction?.indication ?? null,
      technique: extraction?.technique ?? null,
      findings: extraction?.findings ?? null,
      impression: extraction?.impression ?? null,
      recommendations: extraction?.recommendations ?? null,
      measurements: extraction?.measurements ? JSON.parse(JSON.stringify(extraction.measurements)) : undefined,
      abnormalFlags: extraction?.abnormalFlags ?? [],
      severity: extraction?.severity ?? null,
      rawJson: extraction?.rawJson ? JSON.parse(JSON.stringify(extraction.rawJson)) : undefined,
      confidence: extraction?.confidence ?? classificationConfidence,
    },
  });

  let medicationsAdded = 0;
  if (kind === "PRESCRIPTION" && extraction?.prescriptionItems?.length) {
    medicationsAdded = await mergePrescriptionIntoMedications(userId, extraction.prescriptionItems, performedDate);
  }

  const wikiPath = await writeClinicalWikiPage(userId, kind, extraction, report.id, performedDate);

  await appendLog(
    userId,
    `${kind.toLowerCase()} report ingested (${report.id.slice(0, 8)}): ${extraction?.impression?.slice(0, 80) ?? extraction?.procedureName ?? "no extraction"}`,
  );

  if (extraction?.severity === "SEVERE" || extraction?.severity === "CRITICAL") {
    notifyClinicalAlert(userId, kind, extraction).catch((err) => {
      console.warn("[clinical] alert notify failed:", err instanceof Error ? err.message : err);
    });
  }

  try {
    await updateMasterIndex(userId);
  } catch (err) {
    console.warn("[clinical] master index update failed:", err instanceof Error ? err.message : err);
  }

  return { reportId: report.id, medicationsAdded, wikiPath };
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Medication merge ──────────────────────────────────────────────────────

async function mergePrescriptionIntoMedications(
  userId: string,
  items: NonNullable<ClinicalExtraction["prescriptionItems"]>,
  rxDate: Date | null,
): Promise<number> {
  let added = 0;
  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;

    // If an active med with the same name (case-insensitive) already exists,
    // update its metadata rather than create a duplicate.
    const existing = await prisma.medication.findFirst({
      where: {
        userId,
        active: true,
        name: { equals: name, mode: "insensitive" },
      },
    });

    const frequency = normalizeFrequencyToEnum(item.frequency) as MedFrequency;
    const notesParts: string[] = [];
    if (item.frequency && item.frequency !== frequency) notesParts.push(`Rx: ${item.frequency}`);
    if (item.instructions) notesParts.push(item.instructions);
    if (item.durationDays) notesParts.push(`for ${item.durationDays} days`);
    const notes = notesParts.length > 0 ? notesParts.join(" · ") : null;

    if (existing) {
      await prisma.medication.update({
        where: { id: existing.id },
        data: {
          dosage: item.dosage ?? existing.dosage,
          frequency,
          notes,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.medication.create({
        data: {
          userId,
          name,
          dosage: item.dosage ?? null,
          frequency,
          notes,
          active: true,
          startDate: rxDate ?? new Date(),
        },
      });
      added += 1;
    }
  }
  return added;
}

// ─── Wiki page generation ──────────────────────────────────────────────────

function wikiFolderFor(kind: ClinicalReportKind): string {
  switch (kind) {
    case "IMAGING": return "imaging";
    case "ECG": case "ECHO": return "cardiac";
    case "BIOPSY": return "pathology";
    case "DISCHARGE_SUMMARY": return "encounters";
    case "PRESCRIPTION": return "prescriptions";
    case "CONSULTATION": return "encounters";
    case "VACCINATION": return "vaccinations";
    default: return "notes";
  }
}

async function writeClinicalWikiPage(
  userId: string,
  kind: ClinicalReportKind,
  extraction: ClinicalExtraction | null,
  reportId: string,
  performedDate: Date | null,
): Promise<string | null> {
  const folder = wikiFolderFor(kind);
  const dateStr = (performedDate ?? new Date()).toISOString().split("T")[0];
  const dateFormatted = (performedDate ?? new Date()).toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric",
  });

  const slugParts: string[] = [dateStr];
  if (extraction?.modality) slugParts.push(toSlug(extraction.modality));
  else if (extraction?.performedBy) slugParts.push(toSlug(extraction.performedBy));
  else slugParts.push(reportId.slice(0, 6));
  const slug = slugParts.join("-");
  const relPath = `${folder}/${slug}.md`;

  const kindLower = kind.toLowerCase().replace(/_/g, "-");
  const title = buildTitle(kind, extraction, dateFormatted);

  const sections: string[] = [];
  sections.push(`---`);
  sections.push(`title: ${title}`);
  sections.push(`tags: [${kindLower}, ${dateStr}${extraction?.severity ? `, ${extraction.severity.toLowerCase()}` : ""}]`);
  sections.push(`date: ${dateStr}`);
  sections.push(`type: clinical-report`);
  sections.push(`kind: ${kind}`);
  if (extraction?.severity) sections.push(`severity: ${extraction.severity}`);
  sections.push(`---`);
  sections.push("");
  sections.push(`# ${title}`);
  sections.push("");

  if (extraction?.institution) sections.push(`**Institution:** ${extraction.institution}  `);
  if (extraction?.performedBy) sections.push(`**Reported by:** ${extraction.performedBy}  `);
  if (extraction?.referringDoctor) sections.push(`**Referred by:** ${extraction.referringDoctor}  `);
  if (extraction?.bodyPart) sections.push(`**Body part:** ${extraction.bodyPart}  `);
  if (extraction?.modality) sections.push(`**Modality:** ${extraction.modality}  `);
  if (extraction?.severity) sections.push(`**Severity:** \`${extraction.severity}\`  `);
  sections.push("");

  if (extraction?.indication) {
    sections.push(`## Indication`);
    sections.push(extraction.indication);
    sections.push("");
  }
  if (extraction?.technique) {
    sections.push(`## Technique`);
    sections.push(extraction.technique);
    sections.push("");
  }
  if (extraction?.findings) {
    sections.push(`## Findings`);
    sections.push(extraction.findings);
    sections.push("");
  }
  if (extraction?.impression) {
    sections.push(`## Impression`);
    sections.push(extraction.impression);
    sections.push("");
  }
  if (extraction?.measurements && Object.keys(extraction.measurements).length > 0) {
    sections.push(`## Measurements`);
    sections.push("");
    sections.push("| Metric | Value |");
    sections.push("|---|---|");
    for (const [k, v] of Object.entries(extraction.measurements)) {
      sections.push(`| ${k} | ${String(v)} |`);
    }
    sections.push("");
  }
  if (extraction?.abnormalFlags && extraction.abnormalFlags.length > 0) {
    sections.push(`## Flagged`);
    for (const f of extraction.abnormalFlags) sections.push(`- ${f}`);
    sections.push("");
  }
  if (extraction?.recommendations) {
    sections.push(`## Recommendations`);
    sections.push(extraction.recommendations);
    sections.push("");
  }

  if (kind === "PRESCRIPTION" && extraction?.prescriptionItems?.length) {
    sections.push(`## Prescribed medications`);
    sections.push("");
    sections.push("| Medication | Dosage | Frequency | Duration |");
    sections.push("|---|---|---|---|");
    for (const m of extraction.prescriptionItems) {
      sections.push(`| ${m.name} | ${m.dosage ?? "—"} | ${m.frequency ?? "—"} | ${m.durationDays ? `${m.durationDays} days` : "—"} |`);
    }
    sections.push("");
  }

  if (!extraction) {
    sections.push(`> ⚠️ Automatic extraction isn't supported for this document kind yet.`);
    sections.push(`> The original upload is still searchable and can be downloaded from Reports.`);
    sections.push("");
  }

  const content = sections.join("\n");

  try {
    await writeWikiPage(userId, relPath, content);
    await indexFileFromDisk(userId, relPath);
  } catch (err) {
    console.warn(`[clinical] wiki write failed:`, err instanceof Error ? err.message : err);
    return null;
  }
  return relPath;
}

function buildTitle(kind: ClinicalReportKind, extraction: ClinicalExtraction | null, dateFormatted: string): string {
  if (kind === "PRESCRIPTION") {
    const doctor = extraction?.performedBy ?? extraction?.referringDoctor;
    return doctor ? `Prescription — ${doctor} (${dateFormatted})` : `Prescription — ${dateFormatted}`;
  }
  const label = extraction?.modality ?? extraction?.procedureName ?? prettyKind(kind);
  return `${label} — ${dateFormatted}`;
}

function prettyKind(kind: ClinicalReportKind): string {
  return kind.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Alerts ────────────────────────────────────────────────────────────────

async function notifyClinicalAlert(
  userId: string,
  kind: ClinicalReportKind,
  extraction: ClinicalExtraction,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneVerified: true, whatsappOptIn: true, name: true },
  });
  if (!user?.phone || !user.phoneVerified || !user.whatsappOptIn) return;

  const icon = extraction.severity === "CRITICAL" ? "🚨" : "⚠️";
  const kindLabel = prettyKind(kind);
  const lines = [
    `${icon} *Ayus clinical alert*${user.name ? ` — hi ${user.name.split(" ")[0]}` : ""}`,
    "",
    `*${kindLabel}*${extraction.modality ? ` · ${extraction.modality}` : ""}`,
    `Severity: *${extraction.severity}*`,
  ];
  if (extraction.impression) {
    lines.push("", extraction.impression.slice(0, 300));
  }
  if (extraction.abnormalFlags && extraction.abnormalFlags.length > 0) {
    lines.push("", "Key findings:");
    for (const f of extraction.abnormalFlags.slice(0, 5)) lines.push(`• ${f}`);
  }
  lines.push("", "Open the Ayus app to see the full report and share it with your doctor.");
  lines.push("_Reply STOP to disable alerts._");

  try {
    await sendWhatsApp(user.phone, lines.join("\n"));
  } catch (err) {
    console.warn("[clinical] whatsapp send failed:", err instanceof Error ? err.message : err);
  }
}
