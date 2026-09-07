/**
 * Org-scoped reports list for laboratory accounts — the operational master
 * list of everything the lab has processed (uploaded on-behalf-of a patient).
 * Rows drill into the consented patient dashboard.
 */

import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { getLabReports, type LabReportsFilter, type QualityScore } from "@/lib/lab-analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FILTERS: { id: LabReportsFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "NEEDS_REVIEW", label: "Needs review" },
  { id: "ERROR", label: "Failed" },
  { id: "READY", label: "Ready" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function QualityBadge({ q }: { q: QualityScore }) {
  const cls =
    q.band === "good" ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
    : q.band === "fair" ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
    : "text-red-600 border-red-500/30 bg-red-500/10";
  return <Badge variant="outline" className={`tabular-nums ${cls}`} title={`Quality ${q.score}/100`}>{q.score}</Badge>;
}

function StatusBadge({ status, needsReview }: { status: string; needsReview: boolean }) {
  const label = status === "ERROR" ? "Failed"
    : status === "NEEDS_REVIEW" || needsReview ? "Needs review"
    : status === "PROCESSING" || status === "UPLOADED" ? "Processing"
    : "Ready";
  const cls = status === "ERROR" ? "text-red-600 border-red-500/30 bg-red-500/10"
    : label === "Needs review" ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
    : label === "Processing" ? "text-muted-foreground"
    : "text-emerald-600 border-emerald-500/30 bg-emerald-500/10";
  return <Badge variant="outline" className={cls}>{label}</Badge>;
}

export async function LabReports({ orgId, filter }: { orgId: string; filter: LabReportsFilter }) {
  const rows = await getLabReports(orgId, filter, 100);

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/reports" : `/reports?status=${f.id}`}
            className={`rounded-md px-3 py-1 text-sm border transition-colors ${
              filter === f.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <FileText className="size-6 mx-auto mb-2 opacity-50" />
            No reports{filter !== "all" ? " in this view" : " yet"}. Upload on behalf of a patient from their profile.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Ref. doctor</TableHead>
                    <TableHead className="text-right">Tests</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.reportId}>
                      <TableCell className="font-medium">{r.patientName}</TableCell>
                      <TableCell className="max-w-40 truncate text-muted-foreground">{r.uploadName}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{r.referredBy ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.testCount}</TableCell>
                      <TableCell><QualityBadge q={r.quality} /></TableCell>
                      <TableCell><StatusBadge status={r.status} needsReview={r.status === "NEEDS_REVIEW"} /></TableCell>
                      <TableCell>
                        <Link href={`/patients/${r.patientId}`} className="text-primary inline-flex items-center gap-1 text-sm hover:underline">
                          Open <ArrowRight className="size-3.5" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
