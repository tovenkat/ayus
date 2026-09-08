"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export type ReferralTarget = { id: string; name: string };

const SPECIALTIES: [string, string][] = [
  ["GENERAL", "General Medicine"], ["CARDIOLOGY", "Cardiology"], ["ENDOCRINOLOGY", "Endocrinology"],
  ["GASTROENTEROLOGY", "Gastroenterology"], ["NEPHROLOGY", "Nephrology"], ["NEUROLOGY", "Neurology"],
  ["ONCOLOGY", "Oncology"], ["PULMONOLOGY", "Pulmonology"], ["UROLOGY", "Urology"],
  ["GYNECOLOGY", "Gynecology"], ["ENT", "ENT"], ["OTHER", "Other"],
];

export function ReferPatient({
  patientId, patientName, defaultSpecialty = "GENERAL", defaultReason = "", targets = [],
}: {
  patientId: string; patientName: string; defaultSpecialty?: string; defaultReason?: string;
  targets?: ReferralTarget[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [specialty, setSpecialty] = useState(defaultSpecialty);
  const [target, setTarget] = useState(targets[0]?.id ?? "external");
  const [external, setExternal] = useState("");
  const [reason, setReason] = useState(defaultReason);

  async function submit() {
    if (!reason.trim()) { toast.error("Add a reason"); return; }
    const isExternal = target === "external";
    if (isExternal && !external.trim()) { toast.error("Name the provider you're referring to"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/refer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialty, reason, toOrgId: isExternal ? undefined : target, toOrgName: isExternal ? external : undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not refer"); return; }
      toast.success(`${patientName} referred`);
      setOpen(false); setReason(defaultReason); setExternal("");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setOpen(true)}>
        <Share2 className="size-3.5" /> Refer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Refer · {patientName}</DialogTitle>
            <DialogDescription>Send this patient to another provider or specialty.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Specialty</Label>
                <Select value={specialty} onValueChange={(v) => setSpecialty(v ?? "GENERAL")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Refer to</Label>
                <Select value={target} onValueChange={(v) => setTarget(v ?? "external")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    <SelectItem value="external">External / other…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {target === "external" && (
              <div className="space-y-1.5">
                <Label htmlFor="ext">Provider name</Label>
                <Input id="ext" value={external} onChange={(e) => setExternal(e.target.value)} placeholder="e.g. Apollo Hospitals — Nephrology" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason for referral</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Clinical context and question…" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Send referral"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
