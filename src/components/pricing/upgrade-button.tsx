"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SubscriptionTier } from "@prisma/client";

const NEEDS_CONFIG: SubscriptionTier[] = ["PERSONAL", "FAMILY", "CLINIC_STARTER", "DIAGNOSTIC_CENTER"];

type Props = {
  tier: SubscriptionTier;
  label: string;
  variant?: "default" | "outline";
  className?: string;
  currentTier?: SubscriptionTier;
};

export function UpgradeButton({ tier, label, variant = "default", className, currentTier }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isCurrent = currentTier === tier;

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/organization/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.paymentRequired) {
          toast.error("Payments not enabled yet. Razorpay integration coming soon.");
        } else {
          toast.error(data.error ?? "Upgrade failed");
        }
        return;
      }
      toast.success(
        data.devMode
          ? `Switched to ${tier} (dev mode — no payment)`
          : `Upgraded to ${tier}`,
      );
      if (NEEDS_CONFIG.includes(tier)) {
        router.push("/settings?welcome=1#ai");
      } else {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      className={className}
      onClick={handleClick}
      disabled={loading || isCurrent}
    >
      {isCurrent ? "Current plan" : loading ? "Switching…" : label}
    </Button>
  );
}
