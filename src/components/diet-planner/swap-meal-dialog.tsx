"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, Check } from "lucide-react";
import type { MealType } from "@prisma/client";
import { MEAL_LABEL } from "@/lib/diet-planner";

type Alternative = {
  items: string;
  calories?: number | null;
  restrictions?: string[];
  reasoning: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mealType: MealType;
  currentItems: string;
  prefs: { diet: string; region: string; avoid: string };
  onApply: (alt: Alternative) => Promise<void>;
};

export function SwapMealDialog({ open, onOpenChange, mealType, currentItems, prefs, onApply }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);

  async function fetchAlternatives() {
    setLoading(true);
    setAlternatives([]);
    try {
      const res = await fetch("/api/diet/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealType,
          currentItems,
          diet: prefs.diet,
          region: prefs.region,
          avoid: prefs.avoid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't generate alternatives");
        return;
      }
      setAlternatives(data.alternatives ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function apply(idx: number, alt: Alternative) {
    setApplying(idx);
    try {
      await onApply(alt);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply");
    } finally {
      setApplying(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      onOpenChange(v);
      if (v && alternatives.length === 0 && !loading) fetchAlternatives();
      if (!v) { setAlternatives([]); setApplying(null); }
    }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Swap {MEAL_LABEL[mealType]}</DialogTitle>
          <DialogDescription>
            Break the boredom — pick a fresh alternative. Each option is personalized to your labs + preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Currently</p>
          <p className="text-sm">{currentItems}</p>
        </div>

        <div className="space-y-2">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" />
              Brainstorming 4 alternatives…
            </div>
          )}

          {!loading && alternatives.map((alt, i) => (
            <div key={i} className="rounded-md border p-3 hover:bg-muted/30 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {alt.calories != null && (
                      <Badge variant="secondary" className="text-[10px]">{alt.calories} kcal</Badge>
                    )}
                    {(alt.restrictions ?? []).map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                    ))}
                  </div>
                  <p className="text-sm">{alt.items}</p>
                  <p className="text-xs text-muted-foreground italic">{alt.reasoning}</p>
                </div>
                <Button size="sm" onClick={() => apply(i, alt)} disabled={applying !== null}>
                  {applying === i ? <Loader2 className="size-3.5 animate-spin" /> : <><Check className="mr-1 size-3.5" />Use</>}
                </Button>
              </div>
            </div>
          ))}

          {!loading && alternatives.length > 0 && (
            <Button variant="ghost" size="sm" onClick={fetchAlternatives} className="w-full">
              <RefreshCw className="mr-2 size-3.5" />Regenerate
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
