"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportRadialChart } from "./report-radial-chart";
import type { RecentReport } from "@/lib/dashboard-queries";

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface RecentTimelineProps {
  reports: RecentReport[];
}

export function RecentTimeline({ reports }: RecentTimelineProps) {
  if (reports.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Recent Reports
          </p>
        </div>
        <div className="divide-y">
          {reports.map((report) => (
            <Link
              key={report.id}
              href={`/reports/${report.id}/review`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40 group"
            >
              <ReportRadialChart
                outOfRange={report.outOfRangeCount}
                improving={report.improvingCount}
                worsening={report.worseningCount}
                stable={report.stableCount}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">
                  {formatDate(report.sampleCollectedOn)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {report.testCount} test{report.testCount !== 1 ? "s" : ""}
                  {report.outOfRangeCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-red-500 ml-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      {report.outOfRangeCount}
                    </span>
                  )}
                  {report.referredBy && (
                    <span className="ml-1.5 text-muted-foreground">
                      &middot; {report.referredBy}
                    </span>
                  )}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
