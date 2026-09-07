"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, AlertCircle, AlertTriangle, Info, X, CheckCheck, Inbox } from "lucide-react";
import { toast } from "sonner";

type Alert = {
  id: string;
  normalizedName: string;
  severity: "INFO" | "WARN" | "URGENT";
  status: "NEW" | "SEEN" | "DISMISSED";
  title: string;
  reason: string;
  observedValue: string | null;
  previousValue: string | null;
  createdAt: string;
};

const ICONS = {
  URGENT: AlertCircle,
  WARN: AlertTriangle,
  INFO: Info,
} as const;

const COLORS = {
  URGENT: "text-destructive",
  WARN: "text-amber-600",
  INFO: "text-emerald-600",
} as const;

const POLL_INTERVAL_MS = 60_000; // refetch every minute while mounted

export function NotificationsBell() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts ?? []);
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    const onAlertsChanged = () => load();
    window.addEventListener("alerts-changed", onAlertsChanged);
    return () => {
      clearInterval(id);
      window.removeEventListener("alerts-changed", onAlertsChanged);
    };
  }, [load]);

  // When opening the popover, mark all NEW → SEEN (silent)
  useEffect(() => {
    if (!open) return;
    const newIds = alerts.filter((a) => a.status === "NEW").map((a) => a.id);
    if (newIds.length === 0) return;
    fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newIds, action: "SEEN" }),
    }).then(() => {
      setAlerts((prev) => prev.map((a) => (newIds.includes(a.id) ? { ...a, status: "SEEN" } : a)));
    }).catch(() => {});
  }, [open, alerts]);

  async function dismiss(id: string) {
    setBusyId(id);
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
      setBusyId(null);
    }
  }

  async function dismissAll() {
    const ids = alerts.map((a) => a.id);
    if (ids.length === 0) return;
    setBusyId("__all__");
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "DISMISSED" }),
      });
      if (!res.ok) {
        toast.error("Couldn't dismiss all");
        return;
      }
      setAlerts([]);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const newCount = alerts.filter((a) => a.status === "NEW").length;
  const urgentCount = alerts.filter((a) => a.severity === "URGENT" && a.status !== "DISMISSED").length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications" />
        }
      >
        <Bell className="size-4" />
        {newCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 rounded-full text-[10px] font-semibold flex items-center justify-center px-1 ${
              urgentCount > 0 ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"
            }`}
          >
            {newCount > 9 ? "9+" : newCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-90 p-0 overflow-hidden bg-popover">
        <div className="flex flex-col max-h-[min(60vh,600px)] bg-popover">
          <div className="flex items-center justify-between px-3 py-2.5 border-b bg-popover shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="size-4" />
              <span className="text-sm font-medium">Health alerts</span>
              {alerts.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">{alerts.length}</Badge>
              )}
            </div>
            {alerts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={dismissAll}
                disabled={busyId === "__all__"}
                className="h-7 text-xs"
              >
                <CheckCheck className="mr-1 size-3" />
                Dismiss all
              </Button>
            )}
          </div>

          <div className="overflow-y-auto bg-popover flex-1">
            {!loaded ? (
              <div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>
            ) : alerts.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <Inbox className="size-8 mx-auto opacity-30" />
                <p className="text-sm text-muted-foreground">You're all caught up</p>
                <p className="text-xs text-muted-foreground">We'll ping you here when a biomarker needs attention.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {alerts.map((a) => {
                  const Icon = ICONS[a.severity];
                  return (
                    <li key={a.id} className={`px-3 py-2.5 flex items-start gap-2 ${a.status === "NEW" ? "bg-muted/30" : "bg-popover"}`}>
                      <Icon className={`size-4 shrink-0 mt-0.5 ${COLORS[a.severity]}`} />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{a.title}</p>
                          {a.status === "NEW" && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.reason}</p>
                        {a.previousValue && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            was: {a.previousValue} · now: {a.observedValue ?? "—"}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(a.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => dismiss(a.id)}
                        disabled={busyId === a.id}
                        className="size-6 shrink-0"
                        title="Dismiss"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
