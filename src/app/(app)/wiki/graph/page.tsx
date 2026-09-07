import { requireAuth } from "@/lib/auth-helpers";
import { buildWikiGraph } from "@/lib/wiki-graph";
import { WikiGraph } from "@/components/wiki/wiki-graph";
import { H1, Muted } from "@/components/ui/typography";

export const metadata = { title: "Graph — Ayus" };

export default async function WikiGraphPage() {
  const userId = await requireAuth();
  const graph = await buildWikiGraph(userId);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <H1 className="text-3xl lg:text-4xl">Wiki Graph</H1>
        <Muted>
          Every biomarker, lab report, and note — visually connected. Drag to rearrange, click a node to open it.
        </Muted>
      </div>
      <WikiGraph graph={graph} />
    </div>
  );
}
