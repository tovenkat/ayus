"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Trash2, RefreshCw, Eye } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type FileItem = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  uploadType: string;
  createdAt: string;
  reportId: string | null;
  documentSlug: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  UPLOADED: "secondary",
  PROCESSING: "secondary",
  READY: "default",
  NEEDS_REVIEW: "outline",
  CONFIRMED: "default",
  ERROR: "destructive",
};

const STATUS_COLORS: Record<string, string> = {
  NEEDS_REVIEW: "border-amber-500 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20",
  CONFIRMED: "border-emerald-500 bg-emerald-500/10 text-emerald-700",
};

const TYPE_LABELS: Record<string, string> = {
  LAB_REPORT: "Lab Report",
  PRESCRIPTION: "Prescription",
  DISCHARGE_SUMMARY: "Discharge",
  DOCTOR_NOTE: "Doctor Note",
  HEALTH_NOTE: "Health Note",
  OTHER: "Document",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function FileList({ files }: { files: FileItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reExtractingId, setReExtractingId] = useState<string | null>(null);

  if (files.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No files uploaded yet. Use the drop zone above to get started.
      </p>
    );
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Delete failed");
      }
      toast.success("File and all related data deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleReExtract(uploadId: string) {
    setReExtractingId(uploadId);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed");
      }
      const data = await res.json();
      toast.success(`Extracted ${data.testCount} tests`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setReExtractingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div key={file.id} className="flex items-center gap-3 rounded-lg border p-3">
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.originalName}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatBytes(file.sizeBytes)}</span>
              <span>·</span>
              <span>{formatDate(file.createdAt)}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {TYPE_LABELS[file.uploadType] ?? file.uploadType}
              </Badge>
            </div>
          </div>

          {/* Status + actions */}
          <div className="flex items-center gap-2">
            {/* Review link for reports with NEEDS_REVIEW */}
            {file.status === "NEEDS_REVIEW" && file.reportId && (
              <Link href={`/reports/${file.reportId}/review`}>
                <Badge className={`cursor-pointer transition-colors ${STATUS_COLORS.NEEDS_REVIEW}`}>
                  REVIEW
                </Badge>
              </Link>
            )}

            {/* Re-extract button for lab reports without a report */}
            {file.uploadType === "LAB_REPORT" && !file.reportId && file.status !== "ERROR" && (
              <Button
                variant="outline" size="sm" className="h-7 gap-1.5"
                disabled={reExtractingId === file.id}
                onClick={() => handleReExtract(file.id)}
              >
                <RefreshCw className={`h-3 w-3 ${reExtractingId === file.id ? "animate-spin" : ""}`} />
                {reExtractingId === file.id ? "Extracting..." : "Extract"}
              </Button>
            )}

            {/* View link — prefer the report preview for extracted reports,
                fall back to the wiki page for non-report documents. */}
            {(file.reportId || file.documentSlug) && (
              <Link href={file.reportId ? `/reports/${file.reportId}/review` : `/wiki/${file.documentSlug}`}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title={file.reportId ? "View report" : "View document"}>
                  <Eye className="h-4 w-4" />
                </Button>
              </Link>
            )}

            {/* Status badge (when not NEEDS_REVIEW) */}
            {file.status !== "NEEDS_REVIEW" && (
              <Badge
                variant={STATUS_VARIANT[file.status] ?? "outline"}
                className={STATUS_COLORS[file.status] ?? ""}
              >
                {file.status.replace(/_/g, " ")}
              </Badge>
            )}

            {/* Delete button */}
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === file.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete <strong>{file.originalName}</strong> and
                    all associated reports, test results, and wiki pages. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDelete(file.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ))}
    </div>
  );
}
