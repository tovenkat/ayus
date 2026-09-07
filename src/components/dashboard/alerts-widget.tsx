"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { toast } from "sonner";
import type { BiomarkerAlert } from "@prisma/client";

type Props = { initial: BiomarkerAlert[] };

const SEVERITY_STYLE = {
  URGENT: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-destructive/5 border-destructive/30",
    label: "Urgent",
  },
  WARN: {
    icon: AlertTriangle,
    color: "text-amber-600",
    bg: "bg-amber-500/5 border-amber-500/30",
    label: "Worth discussing",
  },
  INFO: {
    icon: Info,
    color: "text-emerald-600",
    bg: "bg-emerald-500/5 border-emerald-500/30",
    label: "Good news",
  },
};

export function AlertsWidget({ initial }: Props) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  if (alerts.length === 0) return null;

  async function dismiss(id: string) {
    setDismissing((s) => new Set(s).add(id));
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "DISMISSED" }),
      });
      if (!res.ok) {
        toast.error("Couldn't dismiss");
        return;
      }
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } finally {
      setDismissing((s) => {
        const copy = new Set(s);
        copy.delete(id);
        return copy;
      });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600" />
          Biomarker alerts
          <Badge variant="secondary" className="ml-auto text-[10px]">{alerts.length} open</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map((a) => {
          const style = SEVERITY_STYLE[a.severity];
          const Icon = style.icon;
          return (
            <div key={a.id} className={`rounded-md border p-3 ${style.bg}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-3.5 ${style.color}`} />
                    <Badge variant="outline" className="text-[9px]">{style.label}</Badge>
                    <span className="text-xs text-muted-foreground">{a.normalizedName}</span>
                  </div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.reason}</p>
                  {a.previousValue && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      was: {a.previousValue} · now: {a.observedValue ?? "—"}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dismiss(a.id)}
                  disabled={dismissing.has(a.id)}
                  title="Dismiss"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
