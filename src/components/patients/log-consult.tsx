"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Stethoscope } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Records a consultation note against a patient — closes the worklist loop
 * from "flagged" to "acted on". Pre-fills the diagnosis/plan from the care flag.
 */
export function LogConsult({
  patientId, patientName, defaultDiagnosis = "", defaultNotes = "", size = "sm",
}: {
  patientId: string; patientName: string; defaultDiagnosis?: string; defaultNotes?: string;
  size?: "sm" | "xs";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState(defaultDiagnosis);
  const [notes, setNotes] = useState(defaultNotes);
  const [followUp, setFollowUp] = useState("");

  async function submit() {
    if (!notes.trim()) { toast.error("Add a note"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/consult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, diagnosis, followUpDate: followUp || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not save"); return; }
      toast.success(`Consult logged for ${patientName}`);
      setOpen(false);
      setNotes(defaultNotes); setDiagnosis(defaultDiagnosis); setFollowUp("");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size={size} variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
        <Stethoscope className="size-3.5" /> Log consult
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log consultation · {patientName}</DialogTitle>
            <DialogDescription>Recorded to the patient&apos;s record, attributed to your clinic.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dx">Assessment / diagnosis</Label>
              <Input id="dx" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Diabetic nephropathy risk" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes &amp; plan</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Findings, plan, medications advised…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu">Follow-up date (optional)</Label>
              <Input id="fu" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="w-44" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Save consult"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
