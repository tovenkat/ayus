"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Clock, FileText, Link2, ArrowLeft, TrendingUp, ExternalLink } from "lucide-react";
import type { DocumentDetail } from "@/lib/wiki-queries";
import { processWikilinks } from "@/lib/markdown-render";
import type { Components } from "react-markdown";
import { TestTrendChart } from "@/components/tests/test-trend-chart";

export type BiomarkerHistory = {
  name: string;
  unit: string | null;
  latestValue: string;
  latestInterpretation: string;
  latestDate: string;
  readingsCount: number;
  outOfRangeCount: number;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceText: string | null;
  points: { date: string; value: number }[];
};

interface DocumentViewerProps {
  document: DocumentDetail;
  biomarker?: BiomarkerHistory | null;
}

export function DocumentViewer({ document: doc, biomarker }: DocumentViewerProps) {
  // Build set of resolved slugs for wikilink processing
  const resolvedSlugs = new Set(
    doc.outgoingLinks.filter((l) => l.resolved).map((l) => l.slug)
  );

  // Pre-process wikilinks in content
  const processedContent = processWikilinks(doc.rawContent, { resolvedSlugs });

  const dateStr = doc.updatedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Custom link component: internal links use Next.js Link
  const components: Components = {
    a: ({ href, children, ...props }) => {
      if (href?.startsWith("/wiki/")) {
        return (
          <Link
            href={href}
            className="text-primary underline underline-offset-4 decoration-primary/50 hover:decoration-primary"
            {...props}
          >
            {children}
          </Link>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-4"
          {...props}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/wiki"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        All documents
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {dateStr}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {doc.wordCount.toLocaleString()} words
          </span>
          <span className="flex items-center gap-1">
            <FileText className="size-3.5" />
            {doc.docType.toLowerCase()}
          </span>
          {doc.outgoingLinks.length > 0 && (
            <span className="flex items-center gap-1">
              <Link2 className="size-3.5" />
              {doc.outgoingLinks.length} links
            </span>
          )}
        </div>

        {/* Tags */}
        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {doc.tags.map((tag) => (
              <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}>
                <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-secondary/80">
                  #{tag}
                </Badge>
              </Link>
            ))}
          </div>
        )}

        {/* Aliases */}
        {doc.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Also known as: {doc.aliases.join(", ")}
          </p>
        )}
      </div>

      {/* Biomarker trend chart (when this is a biomarker entity page) */}
      {biomarker && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" /> Trend
              </CardTitle>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl font-bold tabular-nums">
                  {biomarker.latestValue}
                </span>
                {biomarker.unit && (
                  <span className="text-xs text-muted-foreground">{biomarker.unit}</span>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] ml-1 ${
                    biomarker.latestInterpretation === "HIGH" || biomarker.latestInterpretation === "LOW"
                      ? "border-destructive/40 text-destructive"
                      : ""
                  }`}
                >
                  {biomarker.latestInterpretation}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
              <span>Latest: {new Date(biomarker.latestDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>·</span>
              <span>
                {biomarker.readingsCount} reading{biomarker.readingsCount === 1 ? "" : "s"}
                {biomarker.outOfRangeCount > 0 && (
                  <> · <span className="text-destructive">{biomarker.outOfRangeCount} flagged</span></>
                )}
              </span>
              {biomarker.referenceText && (
                <>
                  <span>·</span>
                  <span>
                    Ref: <span className="font-mono">{biomarker.referenceText}</span>
                  </span>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {biomarker.points.length >= 2 ? (
              <>
                <TestTrendChart
                  points={biomarker.points}
                  unit={biomarker.unit}
                  referenceLow={biomarker.referenceLow}
                  referenceHigh={biomarker.referenceHigh}
                />
                <p className="text-[10px] text-muted-foreground mt-2 text-center">
                  Shaded band = reference range. Hover a point for the exact value.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">
                Only one numeric reading so far — upload another lab report to see a trend line.
              </p>
            )}
            <div className="flex justify-end pt-3 border-t mt-3">
              <Link
                href={`/tests/${encodeURIComponent(biomarker.name)}`}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Full history & table <ExternalLink className="size-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {processedContent}
        </ReactMarkdown>
      </article>

      {/* Outgoing links */}
      {doc.outgoingLinks.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Link2 className="size-4" />
              Outgoing Links ({doc.outgoingLinks.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {doc.outgoingLinks.map((link) => (
                <Link
                  key={link.slug}
                  href={`/wiki/${link.slug}`}
                  className={`text-sm px-2.5 py-1 rounded-md border transition-colors ${
                    link.resolved
                      ? "border-border hover:bg-muted"
                      : "border-dashed border-destructive/40 text-destructive/70"
                  }`}
                  title={link.resolved ? link.title ?? link.slug : `Unresolved: ${link.slug}`}
                >
                  {link.title ?? link.slug}
                  {!link.resolved && " ?"}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backlinks */}
      {doc.backlinks.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold mb-3">
              Backlinks ({doc.backlinks.length})
            </h3>
            <div className="space-y-3">
              {doc.backlinks.map((bl) => (
                <div key={bl.slug} className="group">
                  <Link
                    href={`/wiki/${bl.slug}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {bl.title}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {bl.snippet}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Frontmatter (collapsed) */}
      {doc.frontmatter && Object.keys(doc.frontmatter).length > 0 && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
            Frontmatter
          </summary>
          <pre className="mt-2 p-3 bg-muted rounded-md overflow-x-auto">
            {JSON.stringify(doc.frontmatter, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
