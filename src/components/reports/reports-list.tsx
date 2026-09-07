"use client";

import { useRouter } from "next/navigation";
import { FileText, AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReportItem = {
  id: string;
  sampleCollectedOn: string | null;
  referredBy: string | null;
  fileStatus: string;
  fileName: string;
  confidence: number;
  testCount: number;
  outOfRangeCount: number;
  warningCount: number;
  needsReview: boolean;
  createdAt: string;
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  NEEDS_REVIEW: "outline",
  CONFIRMED: "default",
  UPLOADED: "secondary",
  EXTRACTING: "secondary",
  ERROR: "destructive",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type ReportsListProps = {
  reports: ReportItem[];
  currentFilter: string;
};

export function ReportsList({ reports, currentFilter }: ReportsListProps) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={currentFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/reports")}
        >
          All
        </Button>
        <Button
          variant={currentFilter === "NEEDS_REVIEW" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/reports?status=NEEDS_REVIEW")}
        >
          Needs Review
        </Button>
        <Button
          variant={currentFilter === "CONFIRMED" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/reports?status=CONFIRMED")}
        >
          Confirmed
        </Button>
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10">
          <FileText className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No reports found.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Collected On</TableHead>
              <TableHead>Referred By</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right"># Tests</TableHead>
              <TableHead className="text-right"># Out of Range</TableHead>
              <TableHead className="text-right"># Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow
                key={report.id}
                className="cursor-pointer"
                onClick={() =>
                  router.push(`/reports/${report.id}/review`)
                }
              >
                <TableCell>{formatDate(report.sampleCollectedOn)}</TableCell>
                <TableCell>{report.referredBy || "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {report.fileName}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      STATUS_VARIANT[report.fileStatus] ?? "outline"
                    }
                  >
                    {report.fileStatus.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {report.testCount}
                </TableCell>
                <TableCell className="text-right">
                  {report.outOfRangeCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {report.outOfRangeCount}
                    </span>
                  ) : (
                    "0"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {report.warningCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title="Deterministic validation warnings (plausibility / unit / low confidence)">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {report.warningCount}
                    </span>
                  ) : (
                    "0"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
