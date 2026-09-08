"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthOverview } from "./health-overview";
import { StatusAreaChart } from "./status-area-chart";
import { DashboardFilters } from "./dashboard-filters";
import { TestGrid } from "./test-grid";
import { RecentTimeline } from "./recent-timeline";
import { OrganAnatomy, type RegionPanel } from "@/components/health/organ-anatomy";
import type { DashboardData } from "@/lib/dashboard-queries";

type CategoryFilter = "outOfRange" | "improving" | "worsening" | "stable" | null;

interface DashboardShellProps {
  initialData: DashboardData;
  organRegions?: RegionPanel[];
}

export function DashboardShell({ initialData, organRegions = [] }: DashboardShellProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardData>(initialData);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null);

  const fetchData = useCallback(async (params: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoad) {
      setInitialLoad(false);
      return;
    }
    fetchData(searchParams.toString());
  }, [searchParams, fetchData, initialLoad]);

  const isEmpty =
    data.tests.length === 0 &&
    data.recentReports.length === 0 &&
    data.summary.outOfRange.length === 0 &&
    data.summary.improving.length === 0 &&
    data.summary.worsening.length === 0 &&
    data.summary.stable.length === 0;

  if (isEmpty && !loading) {
    return (
      <div className="space-y-6">
        <DashboardFilters categories={data.categories} />
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-16">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">No health data yet</p>
            <p className="text-sm text-muted-foreground">
              Upload your first lab report to start tracking your health trends.
            </p>
          </div>
          <Link href="/upload">
            <Button>Upload Report</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DashboardFilters categories={data.categories} />

      {loading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
            <Skeleton className="h-55 rounded-xl" />
            <Skeleton className="h-55 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {organRegions.length > 0 ? (
            <>
              {/* Pie (status breakdown) next to the interactive organ anatomy */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <HealthOverview summary={data.summary} selected={categoryFilter} onSelect={setCategoryFilter} />
                <OrganAnatomy regions={organRegions} />
              </div>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
                <StatusAreaChart data={data.statusTimeline} />
                <RecentTimeline reports={data.recentReports} />
              </div>
            </>
          ) : (
            /* No organ-linked data yet — original 3-up layout */
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_300px]">
              <HealthOverview summary={data.summary} selected={categoryFilter} onSelect={setCategoryFilter} />
              <StatusAreaChart data={data.statusTimeline} />
              <RecentTimeline reports={data.recentReports} />
            </div>
          )}

          {/* Test results grid — filtered by selected category */}
          <TestGrid
            tests={data.tests}
            categoryFilter={categoryFilter}
            onClearFilter={() => setCategoryFilter(null)}
          />
        </>
      )}
    </div>
  );
}
