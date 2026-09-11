"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload, FileText, FileArchive, Image, Check, AlertCircle, Loader2, File,
  ClipboardCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type UploadState = "idle" | "uploading" | "done" | "error";

type ReportRef = {
  id: string;
  uploadId: string;
  name: string;
  testCount: number;
  needsReview: boolean;
};

type UploadResult = {
  documents: number;
  filesStored: number;
  totalTags: number;
  totalChunks: number;
  totalWikilinks: number;
  wikilinksResolved: number;
  chunksEmbedded: number;
  reports?: ReportRef[];
  errors?: string[];
};

const ACCEPT = ".pdf,.md,.txt,.csv,.json,.jpg,.jpeg,.png,.zip";

type JobSnapshot = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  progressPct: number | null;
  progressMessage: string | null;
  upload: { id: string; originalName: string; status: string; uploadType: string } | null;
  result: {
    reportIds?: string[];
    documentsIngested?: number;
    warnings?: string[];
    errors?: string[];
  } | null;
};

async function fetchJob(id: string): Promise<JobSnapshot> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error(`Job ${id} status fetch failed (${res.status})`);
  return (await res.json()) as JobSnapshot;
}

const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_MS = 30 * 60 * 1000; // 30 min — realistic ceiling for a Docling+LLM extraction

/**
 * Poll each job until it hits COMPLETED or FAILED. Emit an aggregate
 * status line + pct to the UI as jobs advance. Reports and errors are
 * consolidated into a single UploadResult when every job is done.
 */
async function pollAllJobs(
  jobIds: string[],
  emit: (message: string, pct: number) => void,
): Promise<UploadResult> {
  const start = Date.now();
  const snapshots = new Map<string, JobSnapshot>();
  while (true) {
    for (const id of jobIds) {
      const snap = snapshots.get(id);
      if (snap && (snap.status === "COMPLETED" || snap.status === "FAILED")) continue;
      try {
        snapshots.set(id, await fetchJob(id));
      } catch {
        // Transient — retry next tick.
      }
    }
    // Aggregate for UI.
    const rows = jobIds.map((id) => snapshots.get(id)).filter(Boolean) as JobSnapshot[];
    const done = rows.filter((j) => j.status === "COMPLETED" || j.status === "FAILED").length;
    const running = rows.find((j) => j.status === "RUNNING");
    const summary = jobIds.length === 1
      ? (running?.progressMessage ?? (rows[0]?.progressMessage ?? "waiting"))
      : `${done}/${jobIds.length} done · ${running?.progressMessage ?? "waiting"}`;
    const avgPct = rows.length > 0
      ? rows.reduce((s, j) => s + (j.progressPct ?? (j.status === "COMPLETED" ? 100 : 0)), 0) / jobIds.length
      : 0;
    emit(summary, Math.min(99, Math.max(3, avgPct)));

    if (done === jobIds.length) {
      const reports: ReportRef[] = [];
      const errors: string[] = [];
      let documentsIngested = 0;
      for (const j of rows) {
        if (j.status === "FAILED") {
          errors.push(`${j.upload?.originalName ?? j.id.slice(0, 8)}: ${j.error ?? "failed"}`);
          continue;
        }
        const r = j.result;
        documentsIngested += r?.documentsIngested ?? 0;
        for (const err of r?.errors ?? []) errors.push(err);
        for (const w of r?.warnings ?? []) console.warn(`[upload] warning: ${w}`);
        for (const reportId of r?.reportIds ?? []) {
          reports.push({
            id: reportId,
            uploadId: j.upload?.id ?? "",
            name: j.upload?.originalName ?? "",
            testCount: 0,      // filled by the report view; not tracked in job payload today
            needsReview: j.upload?.status === "NEEDS_REVIEW",
          });
        }
      }
      return {
        documents: documentsIngested,
        filesStored: rows.filter((j) => j.status === "COMPLETED").length,
        totalTags: 0,
        totalChunks: 0,
        totalWikilinks: 0,
        wikilinksResolved: 0,
        chunksEmbedded: 0,
        reports,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error(`Extraction timed out after ${Math.round((Date.now() - start) / 60000)} min`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// Activity hints appended to the server-emitted status line while a single
// verb sits for long enough that the user might wonder if we're stuck.
// Selected by which phase-word appears in the current status message.
// These aren't guesses about internal work — they name plausible sub-steps
// the LLM / OCR is actually running through.
const HINTS: Array<{ match: RegExp; hints: string[] }> = [
  { match: /recover|complete/i,                     hints: ["making sure nothing slipped through", "re-reading the last pages", "catching every value"] },
  { match: /review/i,                               hints: ["getting a second opinion", "sanity-checking the tricky numbers"] },
  { match: /\b(section|analyz|extract|ai|llm|native)\b/i, hints: ["reading your test rows", "matching biomarker names", "checking the units", "spotting out-of-range values", "thinking it over"] },
  { match: /\bwiki\b/i,                             hints: ["linking your biomarkers", "writing up your notes", "connecting the dots"] },
  { match: /\bembed/i,                              hints: ["making it searchable", "indexing your results"] },
  { match: /\bdocling|ocr\b/i,                      hints: ["scanning the pages", "finding the tables", "reading the print"] },
  { match: /\bpdf|extract.*text|quality/i,          hints: ["turning pages", "reading the fine print", "sizing up the report"] },
];
const DEFAULT_HINTS = ["almost there", "hang tight", "on it"];

function hintsFor(message: string): string[] {
  for (const { match, hints } of HINTS) if (match.test(message)) return hints;
  return DEFAULT_HINTS;
}

// Human-friendly headline for the raw server status verb. Keeps the loading
// state warm instead of showing internal phase words like "native extraction".
const FRIENDLY: Array<{ match: RegExp; label: string }> = [
  { match: /queued|waiting for worker/i, label: "Getting in line" },
  { match: /uploading/i,                 label: "Uploading your file" },
  { match: /quality|turning pages/i,     label: "Sizing up your report" },
  { match: /docling|ocr|rasteriz|scan/i, label: "Reading the scanned pages" },
  { match: /recover|complete/i,          label: "Double-checking nothing was missed" },
  { match: /review/i,                    label: "Getting a second opinion" },
  { match: /analyz|extract|ai|llm|native/i, label: "Pulling out your lab values" },
  { match: /validated|classif/i,         label: "Making sense of the results" },
  { match: /wiki/i,                      label: "Organizing your health notes" },
  { match: /embed|vector|index/i,        label: "Making it searchable" },
  { match: /done|✓|complete/i,           label: "Wrapping up" },
  { match: /pdf|text/i,                  label: "Reading your report" },
];
function friendlyStatus(message: string): string {
  for (const { match, label } of FRIENDLY) if (match.test(message)) return label;
  return "Working on it";
}

// Reassurance shown when a single step sits for a while, so a long wait feels
// intentional (accuracy) rather than stuck.
const LONG_WAIT_TIPS = [
  "Long reports take a moment — we read every page so nothing's missed.",
  "Accuracy first — cross-checking the numbers against your report.",
  "Hang tight — a thorough read beats a fast one for your health data.",
];

const FILE_ICONS: Record<string, typeof FileText> = {
  "application/pdf": FileText,
  "text/markdown": FileText,
  "text/plain": FileText,
  "text/csv": File,
  "application/json": File,
  "image/jpeg": Image,
  "image/png": Image,
  "application/zip": FileArchive,
};

export function VaultUpload() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("Uploading files");
  const [pct, setPct] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadType, setUploadType] = useState("LAB_REPORT");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // When the current statusMsg last changed. Drives the "still working (12s)"
  // suffix so the user knows we're not frozen on long steps.
  const statusStartedAt = useRef<number>(Date.now());
  const [nowTick, setNowTick] = useState(0);

  // Reset the "since" clock every time the server sends a new verb.
  useEffect(() => {
    statusStartedAt.current = Date.now();
    setNowTick(0);
  }, [statusMsg]);

  // 1-Hz ticker — only runs during upload; recomputes elapsed for re-render.
  useEffect(() => {
    if (state !== "uploading") return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Elapsed seconds since the current statusMsg arrived.
  const stuckSec = nowTick; // resets to 0 each new statusMsg via effect above
  // Rotate a hint from the pool every ~4s, but only start showing once the
  // step has been stuck ≥ 3s — otherwise short steps get needless noise.
  const activityHint =
    stuckSec >= 3
      ? hintsFor(statusMsg)[Math.floor(stuckSec / 4) % hintsFor(statusMsg).length]
      : null;

  const openFilePicker = useCallback(() => {
    // Clear value first so picking the same file twice still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  const UPLOAD_TYPES = [
    { value: "LAB_REPORT", label: "Lab Report", desc: "Blood work, pathology, diagnostics" },
    { value: "PRESCRIPTION", label: "Prescription", desc: "Doctor prescriptions, medication orders" },
    { value: "DISCHARGE_SUMMARY", label: "Discharge Summary", desc: "Hospital discharge notes" },
    { value: "DOCTOR_NOTE", label: "Doctor Note", desc: "Consultation notes, clinical records" },
    { value: "HEALTH_NOTE", label: "Health Note", desc: "Personal notes, symptom diary, Obsidian vault" },
    { value: "OTHER", label: "Other", desc: "Any other health document" },
  ];

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setState("uploading");
    setErrorMsg("");
    setResult(null);
    setStatusMsg(files.length === 1 ? `Uploading ${files[0].name}` : `Uploading ${files.length} files`);
    setPct(0);

    const formData = new FormData();
    formData.append("uploadType", uploadType);
    for (const file of files) {
      formData.append("files", file);
    }

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Upload failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as {
        queued: number;
        uploads: Array<{ uploadId: string; jobId: string; originalName: string }>;
        jobIds: string[];
        errors?: string[];
      };
      const jobIds = data.jobIds ?? [];
      if (jobIds.length === 0) {
        const reason = data.errors?.[0] ?? "Nothing was queued.";
        setErrorMsg(reason);
        setState("error");
        toast.error(`Upload failed: ${reason}`);
        return;
      }
      setStatusMsg(`Queued ${jobIds.length} file${jobIds.length !== 1 ? "s" : ""} — waiting for worker`);
      setPct(3);

      // Poll every job until each hits COMPLETED or FAILED.
      const finalResult = await pollAllJobs(jobIds, (msg, pct) => {
        setStatusMsg(msg);
        setPct(pct);
      });

      setPct(100);
      setStatusMsg("Done");
      setResult(finalResult);
      setSelectedFiles([]);

      const storedCount = finalResult.filesStored ?? finalResult.documents ?? 0;
      const errorList = finalResult.errors ?? [];
      if (storedCount === 0) {
        const reason = errorList[0] ?? "Server returned 0 files stored (no reason given).";
        setErrorMsg(reason);
        setState("error");
        toast.error(`Upload failed: ${reason}`);
        return;
      }

      setState("done");
      if (errorList.length > 0) {
        toast.warning(`Imported ${storedCount} file${storedCount !== 1 ? "s" : ""}, ${errorList.length} skipped`);
        console.warn("[upload] partial — errors:", errorList);
      } else {
        toast.success(`Imported ${storedCount} file${storedCount !== 1 ? "s" : ""}`);
      }
      router.refresh();
      window.dispatchEvent(new CustomEvent("alerts-changed"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(msg);
      setState("error");
      toast.error(msg);
    }
  }, [uploadType, router]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 1) {
        uploadFiles(files);
      } else if (files.length > 1) {
        setSelectedFiles(files);
      }
    },
    [uploadFiles]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* File type selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">What type of document are you uploading?</Label>
            <Select value={uploadType} onValueChange={(v) => v && setUploadType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPLOAD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {uploadType === "LAB_REPORT" && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Lab reports will be AI-extracted into structured test results and auto-generate wiki pages for each biomarker.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Drop zone */}
      <Card
        className={`border-2 border-dashed transition-colors ${
          state === "idle" ? "cursor-pointer" : ""
        } ${
          dragOver
            ? "border-primary bg-primary/5"
            : state === "done"
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
        onClick={state === "idle" ? openFilePicker : undefined}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          {state === "uploading" ? (
            <div className="w-full max-w-md">
              <div className="flex flex-col items-center">
                <Loader2 className="size-12 text-primary animate-spin mb-4" />
                <p className="text-base font-medium wrap-break-word text-center">
                  {friendlyStatus(statusMsg)}
                  <span className="inline-block w-6 text-left animate-pulse">…</span>
                </p>
                {activityHint && (
                  <p className="text-xs text-muted-foreground mt-1 tabular-nums text-center">
                    {activityHint} · {stuckSec}s
                  </p>
                )}
                {stuckSec >= 12 && (
                  <p className="text-xs text-muted-foreground/80 mt-2 max-w-xs text-center text-balance">
                    {LONG_WAIT_TIPS[Math.floor(stuckSec / 12) % LONG_WAIT_TIPS.length]}
                  </p>
                )}
              </div>
              <div
                className="mt-5 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <div
                  className="h-full bg-primary transition-all duration-200 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2 tabular-nums">
                {Math.round(pct)}%
              </p>
            </div>
          ) : state === "done" ? (
            <>
              <Check className="size-12 text-emerald-500 mb-4" />
              <p className="text-lg font-medium text-emerald-700 dark:text-emerald-400">
                Upload complete!
              </p>
              {result?.reports && result.reports.length > 0 && (
                <div className="mt-5 flex flex-col gap-2 w-full max-w-sm">
                  {result.reports.map((r) => (
                    <Link
                      key={r.id}
                      href={`/reports/${r.id}/review`}
                      className={buttonVariants({ variant: r.needsReview ? "default" : "outline" })}
                    >
                      <ClipboardCheck className="size-4" />
                      Review report ({r.testCount} test{r.testCount !== 1 ? "s" : ""})
                      {r.needsReview && (
                        <Badge variant="secondary" className="ml-1">needs review</Badge>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : state === "error" ? (
            <>
              <AlertCircle className="size-12 text-destructive mb-4" />
              <p className="text-lg font-medium text-destructive">{errorMsg}</p>
              <Button variant="outline" className="mt-3" onClick={() => setState("idle")}>
                Try again
              </Button>
            </>
          ) : (
            <>
              <Upload className="size-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">
                Drop your health documents here
              </p>
              <p className="text-sm text-muted-foreground mt-1 mb-2">
                or click to browse
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mb-4">
                {["PDF", "Markdown", "Text", "CSV", "JSON", "Images", "ZIP"].map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); openFilePicker(); }}
              >
                <Upload className="size-4" />
                Choose files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Selected files preview (multi-select) */}
      {selectedFiles.length > 1 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-3">{selectedFiles.length} files selected</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {selectedFiles.map((f, i) => {
                const Icon = FILE_ICONS[f.type] ?? File;
                return (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="truncate max-w-xs">{f.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
                  </div>
                );
              })}
            </div>
            <Button className="mt-4" onClick={() => uploadFiles(selectedFiles)}>
              Upload {selectedFiles.length} files
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-3">Upload Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Documents</span>
                <p className="text-2xl font-bold">{result.documents}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Files Stored</span>
                <p className="text-2xl font-bold">{result.filesStored}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tags</span>
                <p className="text-2xl font-bold">{result.totalTags}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Links</span>
                <p className="text-2xl font-bold">{result.totalWikilinks}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Chunks</span>
                <p className="text-2xl font-bold">{result.totalChunks}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Embedded</span>
                <p className="text-2xl font-bold">{result.chunksEmbedded}</p>
              </div>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {result.errors.length} file(s) had issues:
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 space-y-0.5">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>...and {result.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            <Button variant="outline" className="mt-4" onClick={() => { setState("idle"); setResult(null); }}>
              Upload more
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Supported formats */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">Supported formats</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><FileText className="size-3.5" /> PDF — lab reports, prescriptions, discharge summaries</div>
            <div className="flex items-center gap-2"><FileText className="size-3.5" /> Markdown — Obsidian health notes with [[links]] and #tags</div>
            <div className="flex items-center gap-2"><File className="size-3.5" /> Text — doctor notes, symptom logs</div>
            <div className="flex items-center gap-2"><File className="size-3.5" /> CSV/JSON — lab data exports, health trackers</div>
            <div className="flex items-center gap-2"><Image className="size-3.5" /> Images — photos of prescriptions or reports</div>
            <div className="flex items-center gap-2"><FileArchive className="size-3.5" /> ZIP — Obsidian vault or batch of documents</div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            All documents are chunked, embedded, and indexed for AI-powered search and chat.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
