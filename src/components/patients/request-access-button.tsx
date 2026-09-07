"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function RequestAccessButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function request() {
    setPending(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not request access");
        return;
      }
      toast.success(
        data.status === "GRANTED"
          ? "Access already granted"
          : "Access requested — the patient will be asked to approve",
      );
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button onClick={request} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : "Request access"}
    </Button>
  );
}
