"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Accept / decline / complete an inbound referral (receiving org only). */
export function ReferralRespond({ referralId, status }: { referralId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function respond(action: "accept" | "decline" | "complete") {
    setBusy(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not update"); return; }
      toast.success(`Referral ${action}ed`);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (status === "PENDING") {
    return (
      <div className="flex gap-1.5 shrink-0">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => respond("accept")}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <><Check className="size-3.5" /> Accept</>}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => respond("decline")}><X className="size-3.5" /></Button>
      </div>
    );
  }
  if (status === "ACCEPTED") {
    return (
      <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={() => respond("complete")}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Mark complete"}
      </Button>
    );
  }
  return null;
}
