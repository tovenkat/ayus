"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldQuestion, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type AccessRequest = {
  id: string;
  orgName: string;
  orgKind: string; // human label, e.g. "Laboratory"
  createdAt: string;
};

export function AccessRequests({ initial }: { initial: AccessRequest[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  if (requests.length === 0) return null;

  async function respond(id: string, action: "grant" | "revoke") {
    setBusy((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/patients/links/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not respond");
        return;
      }
      setRequests((rs) => rs.filter((r) => r.id !== id));
      toast.success(action === "grant" ? "Access granted" : "Request declined");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldQuestion className="size-4 text-amber-600" />
          Access requests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          These providers have requested access to your health records. They can only see your data
          after you approve.
        </p>
        <ul className="divide-y">
          {requests.map((r) => {
            const pending = busy.has(r.id);
            return (
              <li key={r.id} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.orgName}</p>
                  <p className="text-xs text-muted-foreground">{r.orgKind}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => respond(r.id, "grant")}>
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <><Check className="size-3.5" /> Approve</>}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => respond(r.id, "revoke")}>
                  <X className="size-3.5" /> Decline
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
