"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
  Loader2,
  CheckCircle,
  Lock,
  Unlock,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parseOperator,
  parseReferenceRange,
  computeInterpretation,
} from "@/lib/extraction-client";

// ─── Types ──────────────────────────────────────────────────────────────────

type ReportData = {
  id: string;
  sampleCollectedOn: string;
  referredBy: string;
  sampleType: string;
  confidence: number;
  fileId: string;
  fileMimeType: string;
  fileName: string;
  fileStatus: string;
};

type TestRow = {
  id: string;
  rawTestName: string;
  normalizedName: string;
  observedValueRaw: string;
  observedValueNumeric: number | null;
  observedValueOperator: string | null;
  observedValueUnit: string;
  referenceIntervalRaw: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  interpretation: string;
  isOutOfRange: boolean;
  confidence: number;
  plausibilityFlag: string | null;
  warnings: string[];
  sourcePage: number | null;
};

type ReviewPanelProps = {
  report: ReportData;
  tests: TestRow[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const INTERP_VARIANT: Record<
  string,
  "destructive" | "secondary" | "outline"
> = {
  HIGH: "destructive",
  LOW: "destructive",
  NORMAL: "secondary",
  UNKNOWN: "outline",
};

function ConfidenceDot({ value }: { value: number }) {
  const color =
    value >= 0.8
      ? "bg-green-500"
      : value >= 0.5
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${color}`}
      title={`Confidence: ${(value * 100).toFixed(0)}%`}
    />
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ReviewPanel({ report, tests: initialTests }: ReviewPanelProps) {
  const router = useRouter();
  const [sampleCollectedOn, setSampleCollectedOn] = useState(report.sampleCollectedOn);
  const [referredBy, setReferredBy] = useState(report.referredBy);
  const [sampleType, setSampleType] = useState(report.sampleType);
  const [rows, setRows] = useState<TestRow[]>(initialTests);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fileStatus, setFileStatus] = useState(report.fileStatus);
  const [dirty, setDirty] = useState(false);

  const isLocked = fileStatus === "CONFIRMED";

  // ─── Row editing ────────────────────────────────────────────────────

  const updateRow = useCallback(
    (id: string, field: keyof TestRow, value: string) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const updated = { ...row, [field]: value };

          if (field === "interpretation") {
            updated.isOutOfRange = value === "HIGH" || value === "LOW";
          } else if (
            field === "observedValueRaw" ||
            field === "referenceIntervalRaw"
          ) {
            const { operator, numeric } = parseOperator(
              field === "observedValueRaw" ? value : updated.observedValueRaw
            );
            const { low, high } = parseReferenceRange(
              field === "referenceIntervalRaw"
                ? value
                : updated.referenceIntervalRaw
            );
            const { interpretation, isOutOfRange } = computeInterpretation(
              numeric,
              operator,
              low,
              high,
              null
            );
            updated.observedValueNumeric = numeric;
            updated.observedValueOperator = operator;
            updated.referenceLow = low;
            updated.referenceHigh = high;
            updated.interpretation = interpretation;
            updated.isOutOfRange = isOutOfRange;
          }

          return updated;
        })
      );
      setDirty(true);
    },
    []
  );

  // ─── Selection ──────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === rows.length
        ? new Set()
        : new Set(rows.map((r) => r.id))
    );
  }, [rows]);

  // ─── Delete selected ───────────────────────────────────────────────

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/reports/${report.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletedTestIds: ids }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Delete failed");
      }
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      toast.success(`Deleted ${ids.length} test result(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }, [selected, report.id]);

  // ─── Save changes ──────────────────────────────────────────────────

  const saveChanges = useCallback(async () => {
    setSaving(true);
    try {
      const updates = rows.map((row) => {
        const original = initialTests.find((t) => t.id === row.id);
        if (!original) return null;

        const changed: Record<string, unknown> = { id: row.id };
        let hasChanges = false;

        if (row.normalizedName !== original.normalizedName) {
          changed.normalizedName = row.normalizedName;
          hasChanges = true;
        }
        if (row.observedValueRaw !== original.observedValueRaw) {
          changed.observedValueRaw = row.observedValueRaw;
          hasChanges = true;
        }
        if (row.observedValueUnit !== original.observedValueUnit) {
          changed.observedValueUnit = row.observedValueUnit;
          hasChanges = true;
        }
        if (row.referenceIntervalRaw !== original.referenceIntervalRaw) {
          changed.referenceIntervalRaw = row.referenceIntervalRaw;
          hasChanges = true;
        }
        // Only send manual interpretation override when value/range haven't changed
        if (
          row.interpretation !== original.interpretation &&
          row.observedValueRaw === original.observedValueRaw &&
          row.referenceIntervalRaw === original.referenceIntervalRaw
        ) {
          changed.interpretation = row.interpretation;
          hasChanges = true;
        }

        return hasChanges ? changed : null;
      }).filter(Boolean);

      const payload: Record<string, unknown> = {};
      if (sampleCollectedOn !== report.sampleCollectedOn) payload.sampleCollectedOn = sampleCollectedOn;
      if (referredBy !== report.referredBy) payload.referredBy = referredBy;
      if (sampleType !== report.sampleType) payload.sampleType = sampleType;
      if (updates.length > 0) payload.tests = updates;

      if (Object.keys(payload).length === 0) {
        toast.info("No changes to save");
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/reports/${report.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }

      setDirty(false);
      toast.success("Changes saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [rows, initialTests, sampleCollectedOn, referredBy, sampleType, report, router]);

  // ─── Confirm / unlock ─────────────────────────────────────────────

  const confirmReport = useCallback(async () => {
    setConfirming(true);
    try {
      // Save any pending changes first
      if (dirty) await saveChanges();

      const res = await fetch(`/api/reports/${report.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Confirm failed");
      }
      setFileStatus("CONFIRMED");
      toast.success("Report confirmed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setConfirming(false);
    }
  }, [report.id, dirty, saveChanges, router]);

  const unlockReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${report.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Unlock failed");
      }
      setFileStatus("NEEDS_REVIEW");
      toast.success("Report unlocked for editing");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unlock failed");
    }
  }, [report.id, router]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/reports")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Review Report</h1>
          <p className="text-sm text-muted-foreground">{report.fileName}</p>
        </div>
        <Badge
          variant={
            isLocked
              ? "default"
              : ("outline" as "default" | "outline")
          }
        >
          {isLocked ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> Confirmed
            </span>
          ) : (
            "Needs Review"
          )}
        </Badge>
      </div>

      {/* Split panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: File preview */}
        <div className="rounded-lg border bg-muted/30 overflow-hidden">
          <div className="p-3 border-b">
            <p className="text-sm font-medium">Original Document</p>
          </div>
          <div className="h-[600px]">
            {report.fileMimeType === "application/pdf" ? (
              <iframe
                src={`/api/files/${report.fileId}`}
                className="h-full w-full"
                title="Lab report PDF"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${report.fileId}`}
                alt="Lab report"
                className="h-full w-full object-contain p-4"
              />
            )}
          </div>
        </div>

        {/* Right: Editable data */}
        <div className="space-y-4">
          {/* Report-level fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="review-date">
                Sample Collected On
              </label>
              <Input
                id="review-date"
                type="date"
                value={sampleCollectedOn}
                onChange={(e) => {
                  setSampleCollectedOn(e.target.value);
                  setDirty(true);
                }}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="review-referred-by">
                Referred By
              </label>
              <Input
                id="review-referred-by"
                value={referredBy}
                onChange={(e) => {
                  setReferredBy(e.target.value);
                  setDirty(true);
                }}
                placeholder="Referring doctor"
                disabled={isLocked}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="review-sample-type">
                Sample Type
              </label>
              <Input
                id="review-sample-type"
                value={sampleType}
                onChange={(e) => {
                  setSampleType(e.target.value);
                  setDirty(true);
                }}
                placeholder="e.g. Blood, Serum, Urine"
                disabled={isLocked}
              />
            </div>
          </div>

          {/* Test results table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {!isLocked && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          rows.length > 0 && selected.size === rows.length
                        }
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  <TableHead>Test Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Ref Range</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10">Conf</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const lowConf = row.confidence < 0.7;
                  const hasWarnings = row.warnings && row.warnings.length > 0;
                  const isImplausible = row.plausibilityFlag === "out_of_bounds";
                  const rowClasses = [
                    isImplausible && "bg-orange-500/10 border-l-2 border-orange-500",
                    row.isOutOfRange && !isImplausible && "bg-destructive/5",
                    lowConf && !row.isOutOfRange && !isImplausible && "bg-amber-500/5",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <TableRow key={row.id} className={rowClasses}>
                      {!isLocked && (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(row.id)}
                            onCheckedChange={() => toggleSelect(row.id)}
                          />
                        </TableCell>
                      )}
                      <TableCell
                        className={row.isOutOfRange ? "font-bold" : ""}
                      >
                        {hasWarnings && (
                          <span
                            title={row.warnings.join("\n")}
                            className={`mr-1.5 inline-flex align-middle ${isImplausible ? "text-orange-600" : "text-amber-600"}`}
                          >
                            ⚠
                          </span>
                        )}
                        {isLocked ? (
                          row.normalizedName
                        ) : (
                          <Input
                            value={row.normalizedName}
                            onChange={(e) =>
                              updateRow(
                                row.id,
                                "normalizedName",
                                e.target.value
                              )
                            }
                            className="h-7 min-w-[120px] text-sm"
                          />
                        )}
                        {row.sourcePage != null && (
                          <span
                            className="ml-1.5 inline-flex align-middle rounded border border-border/60 bg-muted/50 px-1 py-px text-[9px] uppercase tracking-wider tabular-nums text-muted-foreground"
                            title={`Source: PDF page ${row.sourcePage}`}
                          >
                            p{row.sourcePage}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={row.isOutOfRange ? "font-bold" : ""}
                      >
                        {isLocked ? (
                          row.observedValueRaw
                        ) : (
                          <Input
                            value={row.observedValueRaw}
                            onChange={(e) =>
                              updateRow(
                                row.id,
                                "observedValueRaw",
                                e.target.value
                              )
                            }
                            className="h-7 w-20 text-sm"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {isLocked ? (
                          row.observedValueUnit
                        ) : (
                          <Input
                            value={row.observedValueUnit}
                            onChange={(e) =>
                              updateRow(
                                row.id,
                                "observedValueUnit",
                                e.target.value
                              )
                            }
                            className="h-7 w-16 text-sm"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {isLocked ? (
                          row.referenceIntervalRaw || "—"
                        ) : (
                          <Input
                            value={row.referenceIntervalRaw}
                            onChange={(e) =>
                              updateRow(
                                row.id,
                                "referenceIntervalRaw",
                                e.target.value
                              )
                            }
                            className="h-7 w-24 text-sm"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isLocked && row.interpretation === "UNKNOWN" ? (
                          <Select
                            value={row.interpretation}
                            onValueChange={(val) => {
                              if (val) updateRow(row.id, "interpretation", val);
                            }}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="UNKNOWN">UNKNOWN</SelectItem>
                              <SelectItem value="NORMAL">NORMAL</SelectItem>
                              <SelectItem value="HIGH">HIGH</SelectItem>
                              <SelectItem value="LOW">LOW</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            variant={
                              INTERP_VARIANT[row.interpretation] ?? "outline"
                            }
                          >
                            {row.interpretation}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <ConfidenceDot value={row.confidence} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={isLocked ? 6 : 7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No test results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end flex-wrap">
            {isLocked ? (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
                  <Unlock className="mr-2 h-4 w-4" />
                  Unlock for Editing
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unlock report?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will change the report status back to &quot;Needs
                      Review&quot;. You can edit test results and then re-confirm.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={unlockReport}>
                      Unlock
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <>
                {selected.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="destructive" size="sm" disabled={saving} />}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete {selected.size} Selected
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete test results?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {selected.size} test
                          result(s). This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={deleteSelected}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveChanges}
                  disabled={saving || !dirty}
                >
                  {saving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger render={<Button size="sm" disabled={confirming || rows.length === 0} />}>
                    {confirming ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="mr-2 h-4 w-4" />
                    )}
                    Confirm All
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm report?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will mark the report as confirmed and lock it from
                        further edits. You can unlock it later if needed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={confirmReport}>
                        Confirm
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
