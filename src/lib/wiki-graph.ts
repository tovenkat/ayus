import { prisma } from "@/lib/prisma";

export type GraphNodeKind = "biomarker" | "lab-report" | "topic" | "encounter" | "prescription" | "journal" | "index" | "note";

export type GraphNode = {
  id: string;            // Document.id
  slug: string;
  title: string;
  kind: GraphNodeKind;
  degree: number;        // outgoing + incoming links
};

export type GraphEdge = {
  source: string;        // Document.id of source
  target: string;        // Document.id of target
};

export type WikiGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function classify(slug: string, frontmatter: unknown): GraphNodeKind {
  const fm = (frontmatter ?? {}) as Record<string, unknown>;
  const type = typeof fm.type === "string" ? fm.type : "";
  if (type === "biomarker-entity") return "biomarker";
  if (type === "lab-report-summary") return "lab-report";
  if (type === "master-index" || slug === "index" || slug === "health-index") return "index";
  if (slug.startsWith("entities-")) return "biomarker";
  if (slug.startsWith("lab-reports-")) return "lab-report";
  if (slug.startsWith("topics-")) return "topic";
  if (slug.startsWith("encounters-")) return "encounter";
  if (slug.startsWith("prescriptions-")) return "prescription";
  if (slug.startsWith("journal-")) return "journal";
  return "note";
}

export async function buildWikiGraph(userId: string): Promise<WikiGraph> {
  const docs = await prisma.document.findMany({
    where: { userId, docType: "MARKDOWN" },
    select: { id: true, slug: true, title: true, frontmatter: true },
    orderBy: { createdAt: "asc" },
  });

  const idSet = new Set(docs.map((d) => d.id));

  const links = await prisma.wikiLink.findMany({
    where: {
      source: { userId },
      targetId: { not: null },
    },
    select: { sourceId: true, targetId: true },
  });

  const degree = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const l of links) {
    if (!l.targetId) continue;
    if (!idSet.has(l.sourceId) || !idSet.has(l.targetId)) continue;
    if (l.sourceId === l.targetId) continue;
    edges.push({ source: l.sourceId, target: l.targetId });
    degree.set(l.sourceId, (degree.get(l.sourceId) ?? 0) + 1);
    degree.set(l.targetId, (degree.get(l.targetId) ?? 0) + 1);
  }

  const nodes: GraphNode[] = docs.map((d) => ({
    id: d.id,
    slug: d.slug,
    title: d.title,
    kind: classify(d.slug, d.frontmatter),
    degree: degree.get(d.id) ?? 0,
  }));

  return { nodes, edges };
}
