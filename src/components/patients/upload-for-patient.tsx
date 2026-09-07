"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Upload-on-behalf-of: a lab uploads a report for a consented patient. Posts
 * to /api/upload with the patientId, which the server gates on a GRANTED link.
 * The report lands in the patient's records, attributed to the lab's org.
 */
export function UploadForPatient({ patientId }: { patientId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      fd.append("patientId", patientId);
      fd.append("uploadType", "LAB_REPORT");

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      const n = data.uploads?.length ?? 0;
      const errs: string[] = data.errors ?? [];
      if (n > 0) {
        toast.success(`${n} file${n !== 1 ? "s" : ""} uploaded — extraction queued`);
        router.refresh();
      }
      if (errs.length > 0) toast.warning(errs[0]);
      if (n === 0 && errs.length === 0) toast.info("Nothing to upload");
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Upload report
      </Button>
    </>
  );
}
