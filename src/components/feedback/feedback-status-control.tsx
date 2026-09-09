"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FEEDBACK_STATUSES, STATUS_META } from "@/lib/feedback-status";
import { toast } from "sonner";

/** Admin control to change a feedback item's triage status. */
export function FeedbackStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(status);

  async function change(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Could not update");
        setValue(prev);
        return;
      }
      toast.success(`Marked ${STATUS_META[next as keyof typeof STATUS_META].label}`);
      router.refresh();
    } catch {
      toast.error("Network error");
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      <Select value={value} onValueChange={(v) => change(v ?? value)}>
        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {FEEDBACK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
