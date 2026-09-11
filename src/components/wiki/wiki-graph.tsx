"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { WikiGraph, GraphNodeKind } from "@/lib/wiki-graph";

type Props = { graph: WikiGraph };

type SimNode = {
  id: string;
  slug: string;
  title: string;
  kind: GraphNodeKind;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type SimEdge = { source: SimNode; target: SimNode };

const KIND_COLOR: Record<GraphNodeKind, string> = {
  biomarker:    "#f59e0b", // amber
  "lab-report": "#3b82f6", // blue
  topic:        "#10b981", // emerald
  encounter:    "#8b5cf6", // violet
  prescription: "#ec4899", // pink
  journal:      "#06b6d4", // cyan
  index:        "#6b7280", // slate
  note:         "#9ca3af", // gray
};

const KIND_LABEL: Record<GraphNodeKind, string> = {
  biomarker: "Biomarkers",
  "lab-report": "Lab reports",
  topic: "Topics",
  encounter: "Encounters",
  prescription: "Prescriptions",
  journal: "Journal",
  index: "Index",
  note: "Notes",
};

// Force simulation parameters
const CHARGE_STRENGTH = -180;
const LINK_DISTANCE = 70;
const LINK_STRENGTH = 0.08;
const CENTER_STRENGTH = 0.02;
const FRICTION = 0.85;
const MAX_VELOCITY = 8;

export function WikiGraph({ graph }: Props) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [visibleKinds, setVisibleKinds] = useState<Set<GraphNodeKind>>(
    new Set(Object.keys(KIND_COLOR) as GraphNodeKind[]),
  );
  const draggingRef = useRef<{ id: string | null; offsetX: number; offsetY: number }>({ id: null, offsetX: 0, offsetY: 0 });
  const movedRef = useRef(false); // distinguishes a drag from a click
  const panRef = useRef<{ active: boolean; startX: number; startY: number; tx: number; ty: number }>({
    active: false, startX: 0, startY: 0, tx: 0, ty: 0,
  });
  const [, forceRender] = useState(0);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const alphaRef = useRef(1);        // simulation "heat" — cools to 0 and settles
  const rafRef = useRef(0);          // 0 = loop stopped
  const tickRef = useRef<() => void>(() => {});

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      setDimensions({ width: Math.max(300, rect.width), height: Math.max(400, rect.height) });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seed nodes + edges
  useEffect(() => {
    const { width, height } = dimensions;
    const cx = width / 2;
    const cy = height / 2;
    const nodesMap = new Map<string, SimNode>();
    graph.nodes.forEach((n, i) => {
      // Start nodes on a rough circle for a nicer initial layout
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.3;
      nodesMap.set(n.id, {
        ...n,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      });
    });
    simNodesRef.current = Array.from(nodesMap.values());
    simEdgesRef.current = graph.edges
      .map((e) => {
        const s = nodesMap.get(e.source);
        const t = nodesMap.get(e.target);
        return s && t ? { source: s, target: t } : null;
      })
      .filter((x): x is SimEdge => x !== null);
    forceRender((v) => v + 1);
  }, [graph, dimensions]);

  // Force simulation loop. Cools to a stop (alpha → 0) so the graph SETTLES
  // instead of jittering forever; reheat() restarts it on interaction.
  const MIN_ALPHA = 0.02;
  useEffect(() => {
    const tick = () => {
      const nodes = simNodesRef.current;
      const edges = simEdgesRef.current;
      const alpha = alphaRef.current;
      const dragging = draggingRef.current.id;

      if (nodes.length > 0) {
        const { width, height } = dimensions;
        const cx = width / 2;
        const cy = height / 2;

        // Repulsion between every pair (O(n^2) — fine up to ~300 nodes)
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist2 = dx * dx + dy * dy + 0.01;
            const force = (CHARGE_STRENGTH * alpha) / dist2;
            const dist = Math.sqrt(dist2);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
          }
        }
        // Link attraction
        for (const edge of edges) {
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const delta = (dist - LINK_DISTANCE) * LINK_STRENGTH * alpha;
          const fx = (dx / dist) * delta;
          const fy = (dy / dist) * delta;
          edge.source.vx += fx; edge.source.vy += fy;
          edge.target.vx -= fx; edge.target.vy -= fy;
        }
        // Center gravity
        for (const n of nodes) {
          n.vx += (cx - n.x) * CENTER_STRENGTH * alpha;
          n.vy += (cy - n.y) * CENTER_STRENGTH * alpha;
        }
        // Integrate
        for (const n of nodes) {
          if (dragging === n.id) { n.vx = 0; n.vy = 0; continue; }
          n.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vx * FRICTION));
          n.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vy * FRICTION));
          n.x += n.vx; n.y += n.vy;
        }
      }

      alphaRef.current = alpha * 0.97; // cool faster so it settles quickly
      forceRender((v) => (v + 1) % 1_000_000);

      // Keep running while hot or while the user is dragging; otherwise freeze.
      if (alphaRef.current > MIN_ALPHA || dragging) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        for (const n of nodes) { n.vx = 0; n.vy = 0; } // stop residual drift
        rafRef.current = 0; // settled — no more frames
      }
    };
    tickRef.current = tick;
    alphaRef.current = 1;                       // heat up on (re)seed / resize
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [dimensions, graph]);

  // Re-energize the (possibly settled) simulation after an interaction.
  const reheat = useCallback(() => {
    alphaRef.current = Math.max(alphaRef.current, 0.5);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tickRef.current);
  }, []);

  // Pan / zoom handlers
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.2, Math.min(3, t.scale * (1 + delta))),
    }));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).tagName === "circle" || (e.target as Element).tagName === "text") return;
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform.x, transform.y]);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current.id) {
      movedRef.current = true; // it's a drag, not a click
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const simX = (screenX - transform.x) / transform.scale;
      const simY = (screenY - transform.y) / transform.scale;
      const node = simNodesRef.current.find((n) => n.id === draggingRef.current.id);
      if (node) {
        node.x = simX;
        node.y = simY;
      }
      return;
    }
    if (panRef.current.active) {
      setTransform((t) => ({
        ...t,
        x: panRef.current.tx + (e.clientX - panRef.current.startX),
        y: panRef.current.ty + (e.clientY - panRef.current.startY),
      }));
    }
  }, [transform]);

  const onMouseUp = useCallback(() => {
    panRef.current.active = false;
    draggingRef.current.id = null;
  }, []);

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });
  const zoomIn = () => setTransform((t) => ({ ...t, scale: Math.min(3, t.scale * 1.2) }));
  const zoomOut = () => setTransform((t) => ({ ...t, scale: Math.max(0.2, t.scale / 1.2) }));

  const toggleKind = (kind: GraphNodeKind) => {
    setVisibleKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    reheat(); // let the layout re-settle after the set changes
  };

  const visibleNodeIds = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const ids = new Set<string>();
    for (const n of simNodesRef.current) {
      if (!visibleKinds.has(n.kind)) continue;
      if (lower && !n.title.toLowerCase().includes(lower)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [query, visibleKinds, graph.nodes.length]); // re-runs when query/kinds change

  const kindCounts = useMemo(() => {
    const counts = new Map<GraphNodeKind, number>();
    for (const n of graph.nodes) {
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes]);

  // Adjacency for hover-focus: which nodes are directly linked to each node.
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return adj;
  }, [graph.edges]);

  // When hovering a node, the "focus set" = that node + its direct neighbors.
  // Everything else dims so a single biomarker's connections are legible in a
  // dense graph. Null when nothing is hovered (everything at full strength).
  const focusSet = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    for (const id of adjacency.get(hovered) ?? []) s.add(id);
    return s;
  }, [hovered, adjacency]);

  // Labels are noisy when every node shows one. Default to labeling only the
  // navigational hubs (lab reports + index); reveal the rest on hover/search.
  const isHubKind = (k: GraphNodeKind) => k === "lab-report" || k === "index" || k === "encounter";

  return (
    <Card className="overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-3 py-2 flex-wrap bg-muted/20">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="pl-7 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={zoomOut} className="size-7" title="Zoom out">
            <ZoomOut className="size-4" />
          </Button>
          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-center">
            {Math.round(transform.scale * 100)}%
          </span>
          <Button variant="ghost" size="icon" onClick={zoomIn} className="size-7" title="Zoom in">
            <ZoomIn className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={resetView} className="size-7" title="Reset view">
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1.5 border-b px-3 py-2 bg-muted/10">
        {(Object.keys(KIND_COLOR) as GraphNodeKind[]).map((k) => {
          const count = kindCounts.get(k) ?? 0;
          if (count === 0) return null;
          const active = visibleKinds.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition ${
                active ? "bg-background" : "opacity-40 bg-muted"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
              <span>{KIND_LABEL[k]}</span>
              <Badge variant="secondary" className="text-[9px] tabular-nums h-4 px-1">{count}</Badge>
            </button>
          );
        })}
      </div>

      <CardContent className="p-0">
        <div
          ref={containerRef}
          className="relative h-[560px] bg-linear-to-br from-muted/20 to-background"
        >
          <svg
            ref={svgRef}
            width={dimensions.width}
            height={dimensions.height}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {/* Edges */}
              {simEdgesRef.current.map((e, i) => {
                const srcVisible = visibleNodeIds.has(e.source.id);
                const tgtVisible = visibleNodeIds.has(e.target.id);
                if (!srcVisible || !tgtVisible) return null;
                const touchesHover = hovered === e.source.id || hovered === e.target.id;
                // In focus mode, only edges touching the hovered node show;
                // the rest fade right back so the neighborhood stands out.
                const dimmed = focusSet && !touchesHover;
                return (
                  <line
                    key={i}
                    x1={e.source.x}
                    y1={e.source.y}
                    x2={e.target.x}
                    y2={e.target.y}
                    stroke={touchesHover ? "var(--primary)" : "currentColor"}
                    strokeWidth={touchesHover ? 1.5 : 0.8}
                    opacity={touchesHover ? 0.85 : dimmed ? 0.04 : 0.22}
                    className="text-muted-foreground"
                  />
                );
              })}
              {/* Nodes */}
              {simNodesRef.current.map((n) => {
                if (!visibleNodeIds.has(n.id)) return null;
                const r = 5 + Math.min(8, Math.sqrt(n.degree) * 2);
                const isHovered = hovered === n.id;
                const inFocus = !focusSet || focusSet.has(n.id);
                const isNeighbor = !!focusSet && focusSet.has(n.id) && !isHovered;
                // Label: hubs always; the hovered node + its neighbors; and any
                // search match. Keeps a dense graph readable instead of a wall
                // of overlapping text.
                const showLabel =
                  isHovered || isNeighbor || !!query || (isHubKind(n.kind) && !focusSet);
                return (
                  <g key={n.id} opacity={inFocus ? 1 : 0.2}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={isHovered ? r + 2 : r}
                      fill={KIND_COLOR[n.kind]}
                      stroke="var(--background)"
                      strokeWidth={isHovered ? 2.5 : 1.5}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        movedRef.current = false;
                        draggingRef.current = { id: n.id, offsetX: 0, offsetY: 0 };
                        reheat(); // wake the sim so neighbors follow the drag
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const wasDrag = movedRef.current;
                        draggingRef.current.id = null;
                        movedRef.current = false;
                        if (!wasDrag) router.push(`/wiki/${n.slug}`); // click opens; drag doesn't
                      }}
                    />
                    {showLabel && (
                      <text
                        x={n.x}
                        y={n.y - r - 6}
                        textAnchor="middle"
                        className="pointer-events-none select-none fill-foreground"
                        style={{
                          fontSize: isHovered ? "12px" : "10px",
                          fontWeight: isHovered ? 600 : 500,
                          paintOrder: "stroke",
                          stroke: "var(--background)",
                          strokeWidth: 3,
                        }}
                      >
                        {n.title.length > 28 ? `${n.title.slice(0, 25)}…` : n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
              No wiki pages yet. Upload a lab report to get started.
            </div>
          )}
        </div>

        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between flex-wrap gap-2">
          <span>
            {graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length} link{graph.edges.length === 1 ? "" : "s"}
          </span>
          <span>Hover to focus connections · drag to reposition · click to open · scroll to zoom</span>
        </div>
      </CardContent>
    </Card>
  );
}
