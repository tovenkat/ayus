import { requireAuth } from "@/lib/auth-helpers";
import { getDocument } from "@/lib/wiki-queries";
import { DocumentViewer, type BiomarkerHistory } from "@/components/wiki/document-viewer";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: `${decodeURIComponent(slug)} — Ayus` };
}

function iso(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** If this doc is a biomarker entity page, fetch the structured readings for the chart. */
async function loadBiomarkerHistory(userId: string, title: string): Promise<BiomarkerHistory | null> {
  const rows = await prisma.testResult.findMany({
    where: {
      userId,
      normalizedName: { equals: title, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    include: { report: { select: { sampleCollectedOn: true, createdAt: true } } },
  });
  if (rows.length === 0) return null;

  const points = rows
    .filter((r) => r.observedValueNumeric !== null)
    .map((r) => ({
      date: iso(r.report?.sampleCollectedOn ?? r.report?.createdAt ?? r.createdAt),
      value: r.observedValueNumeric as number,
    }));

  const latest = rows[0];
  const refBounds = rows.find((r) => r.referenceLow !== null || r.referenceHigh !== null);

  return {
    name: latest.normalizedName,
    unit: latest.observedValueUnit,
    latestValue: latest.observedValueRaw,
    latestInterpretation: latest.interpretation,
    latestDate: iso(latest.report?.sampleCollectedOn ?? latest.report?.createdAt ?? latest.createdAt),
    readingsCount: rows.length,
    outOfRangeCount: rows.filter((r) => r.isOutOfRange).length,
    referenceLow: refBounds?.referenceLow ?? null,
    referenceHigh: refBounds?.referenceHigh ?? null,
    referenceText: refBounds?.referenceIntervalRaw ?? null,
    points,
  };
}

export default async function WikiDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const userId = await requireAuth();
  const { slug } = await params;

  const doc = await getDocument(userId, decodeURIComponent(slug));
  if (!doc) notFound();

  // Detect biomarker entity pages so we can render a trend chart inline.
  const fm = (doc.frontmatter ?? {}) as Record<string, unknown>;
  const isBiomarker = fm.type === "biomarker-entity"
    || doc.tags.includes("biomarker")
    || doc.slug.startsWith("entities-");

  const biomarker = isBiomarker ? await loadBiomarkerHistory(userId, doc.title) : null;

  return <DocumentViewer document={doc} biomarker={biomarker} />;
}
