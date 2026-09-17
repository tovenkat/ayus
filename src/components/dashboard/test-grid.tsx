"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendChart } from "./trend-chart";
import type { TestSummary } from "@/lib/dashboard-queries";
import type { TrendStatus } from "@/lib/trends";

const TREND_BADGE: Record<
  TrendStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  improving: { label: "Improving", variant: "default" },
  worsening: { label: "Worsening", variant: "destructive" },
  stable: { label: "Stable", variant: "secondary" },
  insufficient_data: { label: "1 result", variant: "outline" },
};

const FILTER_LABELS: Record<string, string> = {
  outOfRange: "Out of Range",
  improving: "Improving",
  worsening: "Worsening",
  stable: "Stable",
};

type CategoryFilter = "outOfRange" | "improving" | "worsening" | "stable" | null;

interface TestGridProps {
  tests: TestSummary[];
  categoryFilter?: CategoryFilter;
  onClearFilter?: () => void;
  /** When set (roster patient view), biomarker links scope to this patient. */
  patientId?: string;
}

function applyFilter(tests: TestSummary[], filter: CategoryFilter): TestSummary[] {
  if (!filter) return tests;
  return tests.filter((t) => {
    if (filter === "outOfRange") return t.isOutOfRange;
    return t.trend.status === filter;
  });
}

export function TestGrid({ tests, categoryFilter, onClearFilter, patientId }: TestGridProps) {
  const filtered = applyFilter(tests, categoryFilter ?? null);
  const patientQuery = patientId ? `?patient=${encodeURIComponent(patientId)}` : "";

  return (
    <div className="space-y-3">
      {/* Filter pill */}
      {categoryFilter && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing:</span>
          <button
            onClick={onClearFilter}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors hover:bg-muted/60"
          >
            {FILTER_LABELS[categoryFilter]}
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10">
          <p className="text-muted-foreground">No tests match the current filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((test) => {
            const badge = TREND_BADGE[test.trend.status];
            return (
              <Link
                key={test.normalizedName}
                href={`/tests/${encodeURIComponent(test.normalizedName)}${patientQuery}`}
              >
                <Card className="transition-shadow hover:shadow-md cursor-pointer">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate text-sm">
                        {test.normalizedName}
                      </CardTitle>
                      <Badge variant={badge.variant} className="shrink-0">
                        {badge.label}
                      </Badge>
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <div className="flex items-baseline gap-1">
                        <span className="font-semibold">{test.latestValue}</span>
                        {test.unit && (
                          <span className="text-muted-foreground text-xs">
                            {test.unit}
                          </span>
                        )}
                        {test.isOutOfRange && (
                          <span className="text-destructive text-xs font-medium ml-1">
                            Out of range
                          </span>
                        )}
                      </div>
                      {(test.referenceLow !== null || test.referenceHigh !== null) && (
                        <span className="text-muted-foreground text-xs">
                          Ref:{" "}
                          {test.referenceLow !== null && test.referenceHigh !== null
                            ? `${test.referenceLow} – ${test.referenceHigh}`
                            : test.referenceHigh !== null
                              ? `< ${test.referenceHigh}`
                              : `> ${test.referenceLow}`}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <TrendChart
                      data={test.chartData}
                      referenceLow={test.referenceLow}
                      referenceHigh={test.referenceHigh}
                      unit={test.unit}
                      height={140}
                      showYAxis
                      interactive
                      compact
                    />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
