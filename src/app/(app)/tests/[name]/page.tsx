import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { checkPatientAccess } from "@/lib/patient-roster";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, FileText, BookOpen } from "lucide-react";
import { TestTrendChart } from "@/components/tests/test-trend-chart";
import { toSlug } from "@/lib/ingestion/parsers/markdown";

type Params = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ patient?: string }>;
};

export async function generateMetadata({ params }: Params) {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} — Ayus` };
}

function iso(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function TestDetailPage({ params, searchParams }: Params) {
  const userId = await requireAuth();
  const { name: rawName } = await params;
  const { patient: patientParam } = await searchParams;
  const name = decodeURIComponent(rawName);

  // Resolve whose results to show. Default: the logged-in user. When a
  // `?patient=<id>` is passed (roster accounts drilling into a patient's
  // dashboard), scope to that patient — but only if access is granted.
  // Otherwise this page would query the lab/doctor's own (empty) results and
  // 404 on every biomarker link from a patient dashboard.
  let targetUserId = userId;
  let patientId: string | null = null;
  if (patientParam && patientParam !== userId) {
    const gate = await checkPatientAccess(userId, patientParam);
    if (!gate.ok) notFound();
    targetUserId = patientParam;
    patientId = patientParam;
  }

  // Case-insensitive lookup so links from anywhere work — match the raw
  // normalized name OR the canonical name (organ-view links pass canonical).
  const rows = await prisma.testResult.findMany({
    where: {
      userId: targetUserId,
      OR: [
        { normalizedName: { equals: name, mode: "insensitive" } },
        { canonical: { name: { equals: name, mode: "insensitive" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      report: { select: { id: true, sampleCollectedOn: true, createdAt: true } },
    },
  });

  if (rows.length === 0) notFound();

  const latest = rows[0];
  const previous = rows[1];
  const displayName = latest.normalizedName;

  // Build trend points (only those with numeric value)
  const points = rows
    .filter((r) => r.observedValueNumeric !== null)
    .map((r) => ({
      date: iso(r.report?.sampleCollectedOn ?? r.report?.createdAt ?? r.createdAt),
      value: r.observedValueNumeric as number,
    }));

  // Status calc
  const outOfRangeCount = rows.filter((r) => r.isOutOfRange).length;
  const trend =
    latest.observedValueNumeric !== null && previous?.observedValueNumeric !== null && previous !== undefined
      ? (latest.observedValueNumeric as number) - (previous.observedValueNumeric as number)
      : 0;
  const trendDirection = Math.abs(trend) < 0.001 ? "flat" : trend > 0 ? "up" : "down";
  const trendWorse =
    (trendDirection === "up" && latest.interpretation === "HIGH") ||
    (trendDirection === "down" && latest.interpretation === "LOW");

  // Reference range (take from latest reading with numeric bounds)
  const refBoundsRow = rows.find((r) => r.referenceLow !== null || r.referenceHigh !== null);
  const referenceLow = refBoundsRow?.referenceLow ?? null;
  const referenceHigh = refBoundsRow?.referenceHigh ?? null;
  const referenceText = refBoundsRow?.referenceIntervalRaw
    ?? (referenceLow !== null && referenceHigh !== null ? `${referenceLow}–${referenceHigh}` : null);

  // Link to the biomarker wiki page if one exists
  const wikiSlug = `entities-${toSlug(displayName)}`;

  const TrendIcon = trendDirection === "up" ? TrendingUp : trendDirection === "down" ? TrendingDown : Minus;
  const trendColor = trendDirection === "flat"
    ? "text-muted-foreground"
    : trendWorse
      ? "text-destructive"
      : "text-emerald-600";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href={patientId ? `/patients/${patientId}` : "/dashboard"}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 size-4" /> {patientId ? "Patient" : "Dashboard"}
          </Button>
        </Link>
      </div>

      {/* Hero */}
      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <h1 className="font-heading text-3xl font-semibold">{displayName}</h1>
              <p className="text-sm text-muted-foreground">
                {rows.length} reading{rows.length === 1 ? "" : "s"} on record
                {outOfRangeCount > 0 && (
                  <> · <span className="text-destructive">{outOfRangeCount} flagged</span></>
                )}
              </p>
            </div>
            <div className="text-right space-y-1">
              <div className="flex items-baseline gap-2 justify-end">
                <span className="font-heading text-4xl font-bold tabular-nums">
                  {latest.observedValueRaw}
                </span>
                {latest.observedValueUnit && (
                  <span className="text-sm text-muted-foreground">{latest.observedValueUnit}</span>
                )}
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Badge
                  variant={latest.isOutOfRange ? "outline" : "secondary"}
                  className={latest.isOutOfRange ? "border-destructive/40 text-destructive" : ""}
                >
                  {latest.interpretation}
                </Badge>
                {previous && (
                  <span className={`inline-flex items-center gap-0.5 text-xs ${trendColor}`}>
                    <TrendIcon className="size-3" />
                    {trendDirection === "flat" ? "no change" : trendDirection === "up" ? "up" : "down"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Latest: {formatDate(iso(latest.report?.sampleCollectedOn ?? latest.report?.createdAt ?? latest.createdAt))}
              </p>
            </div>
          </div>

          {referenceText && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              Reference range: <span className="font-mono">{referenceText}</span>
              {latest.referenceUnit && ` ${latest.referenceUnit}`}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trend chart */}
      {points.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" /> Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TestTrendChart
              points={points}
              unit={latest.observedValueUnit}
              referenceLow={referenceLow}
              referenceHigh={referenceHigh}
            />
            {referenceLow !== null && referenceHigh !== null && (
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                Shaded band = reference range.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* All readings table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="size-4 text-primary" /> All readings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Value</th>
                  <th className="py-2 pr-3 font-medium">Reference</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Report</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const date = r.report?.sampleCollectedOn ?? r.report?.createdAt ?? r.createdAt;
                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 text-muted-foreground tabular-nums">{formatDate(iso(date))}</td>
                      <td className="py-2 pr-3 font-medium tabular-nums">
                        {r.observedValueRaw}
                        {r.observedValueUnit && <span className="text-muted-foreground"> {r.observedValueUnit}</span>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground font-mono text-xs">
                        {r.referenceIntervalRaw ?? (r.referenceLow !== null && r.referenceHigh !== null ? `${r.referenceLow}–${r.referenceHigh}` : "—")}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant={r.isOutOfRange ? "outline" : "secondary"}
                          className={`text-[10px] ${r.isOutOfRange ? "border-destructive/40 text-destructive" : ""}`}
                        >
                          {r.interpretation}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {r.report?.id && (
                          <Link
                            href={`/reports/${r.report.id}/review`}
                            className="text-xs text-primary hover:underline"
                          >
                            view
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Link to wiki entity page — only for the user's own data (the wiki is
          per-user; a roster viewer has no wiki page for the patient). */}
      {!patientId && (
      <Link href={`/wiki/${wikiSlug}`}>
        <Card className="hover:bg-muted/30 transition cursor-pointer">
          <CardContent className="py-3 flex items-center gap-3">
            <BookOpen className="size-4 text-primary" />
            <div className="flex-1 text-sm">
              <span className="font-medium">Open the biomarker wiki page</span>
              <span className="text-muted-foreground"> — narrative history, notes, links</span>
            </div>
            <span className="text-xs text-muted-foreground">→</span>
          </CardContent>
        </Card>
      </Link>
      )}
    </div>
  );
}
