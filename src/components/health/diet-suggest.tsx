"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, AlertTriangle, Check, Loader2, Info, RefreshCw, Replace as ReplaceIcon, Plus } from "lucide-react";
import { acceptDietSuggestion } from "@/lib/actions/health";
import type { MealType } from "@prisma/client";

type Suggestion = {
  mealType: MealType;
  time: string;
  items: string;
  calories: number | null;
  restrictions: string[];
  notes: string | null;
  reasoning: string;
};

type Plan = {
  summary: string;
  redFlags: string[];
  suggestions: Suggestion[];
  watchOuts: string[];
};

type Diet = "VEGETARIAN" | "EGGETARIAN" | "NON_VEG" | "JAIN" | "VEGAN";
type Region = "SOUTH" | "NORTH" | "EAST" | "WEST" | "ANY";

const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  MORNING_SNACK: "Morning snack",
  LUNCH: "Lunch",
  AFTERNOON_SNACK: "Afternoon snack",
  DINNER: "Dinner",
  EVENING_SNACK: "Evening snack",
};

const PREFS_KEY = "phr2:diet-prefs";

function loadPrefs(): { diet: Diet; region: Region; avoid: string; goalKcal: string } {
  if (typeof window === "undefined") return { diet: "VEGETARIAN", region: "ANY", avoid: "", goalKcal: "" };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { diet: "VEGETARIAN", region: "ANY", avoid: "", goalKcal: "" };
    return { diet: "VEGETARIAN", region: "ANY", avoid: "", goalKcal: "", ...JSON.parse(raw) };
  } catch {
    return { diet: "VEGETARIAN", region: "ANY", avoid: "", goalKcal: "" };
  }
}

function savePrefs(p: { diet: Diet; region: Region; avoid: string; goalKcal: string }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    // Notify any other component using the same store (PreferencesPanel hook)
    window.dispatchEvent(new CustomEvent("diet-prefs-changed", { detail: p }));
  } catch {}
}

/** Pull simple biomarker references out of the reasoning string. */
function extractBiomarkers(reasoning: string): string[] {
  // Match patterns like "HbA1c 6.8", "LDL 165", "Vitamin D 18", "TSH 4.2"
  const pattern = /\b(HbA1c|LDL|HDL|Total Cholesterol|Triglycerides|Creatinine|eGFR|Uric acid|Vitamin D|Vitamin B12|B12|TSH|T3|T4|Hemoglobin|Hb|Iron|Ferritin|ALT|AST|Glucose|Fasting glucose|Bilirubin)\s*[:]?\s*(\d+(?:\.\d+)?)/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(reasoning)) !== null) {
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, 3);
}

export function DietSuggest({ existingMealTypes = [] }: { existingMealTypes?: MealType[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const existingTypes = new Set(existingMealTypes);

  const [diet, setDiet] = useState<Diet>("VEGETARIAN");
  const [region, setRegion] = useState<Region>("ANY");
  const [avoid, setAvoid] = useState("");
  const [goalKcal, setGoalKcal] = useState("");

  // Hydrate from localStorage on mount, and stay in sync if another component
  // (PreferencesPanel) updates the same key.
  useEffect(() => {
    const apply = (p: ReturnType<typeof loadPrefs>) => {
      setDiet((prev) => (prev === p.diet ? prev : p.diet));
      setRegion((prev) => (prev === p.region ? prev : p.region));
      setAvoid((prev) => (prev === p.avoid ? prev : p.avoid));
      setGoalKcal((prev) => (prev === p.goalKcal ? prev : p.goalKcal));
    };
    apply(loadPrefs());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ReturnType<typeof loadPrefs>>).detail;
      if (detail) apply(detail);
    };
    window.addEventListener("diet-prefs-changed", onChange);
    return () => window.removeEventListener("diet-prefs-changed", onChange);
  }, []);

  useEffect(() => {
    savePrefs({ diet, region, avoid, goalKcal });
  }, [diet, region, avoid, goalKcal]);

  const allAccepted = plan !== null && accepted.size === plan.suggestions.length;

  async function generate() {
    setLoading(true);
    setPlan(null);
    setAccepted(new Set());
    try {
      const res = await fetch("/api/diet/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diet,
          region,
          avoid: avoid || undefined,
          goalKcal: goalKcal ? Number(goalKcal) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't generate plan");
        return;
      }
      setPlan(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function accept(idx: number, s: Suggestion, mode: "ADD" | "REPLACE" = "ADD") {
    try {
      const result = await acceptDietSuggestion({
        mealType: s.mealType,
        time: s.time,
        items: s.items,
        calories: s.calories,
        restrictions: s.restrictions,
        notes: s.notes,
        mode,
      });
      setAccepted((prev) => new Set(prev).add(idx));
      if (mode === "REPLACE" && result.replacedIds.length > 0) {
        toast.success(`Replaced ${MEAL_LABELS[s.mealType]} (archived ${result.replacedIds.length} previous)`);
      } else {
        toast.success(`Added ${MEAL_LABELS[s.mealType]} to your schedule`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  }

  async function acceptAll() {
    if (!plan) return;
    for (let i = 0; i < plan.suggestions.length; i++) {
      if (accepted.has(i)) continue;
      const s = plan.suggestions[i];
      const mode = existingTypes.has(s.mealType) ? "REPLACE" : "ADD";
      await accept(i, s, mode);
    }
  }

  // Compact idle state
  if (!open) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">AI Dietician</p>
              <p className="text-xs text-muted-foreground">
                Personalised Indian meal plan from your latest labs + meds.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>Get a plan</Button>
        </CardContent>
      </Card>
    );
  }

  // Success state after all suggestions accepted
  if (allAccepted && plan) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Check className="size-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">All {plan.suggestions.length} meals added to your day</p>
              <p className="text-xs text-muted-foreground">Scroll down to see your timeline.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setOpen(false); setPlan(null); setAccepted(new Set()); }}>
              Done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPlan(null); setAccepted(new Set()); }}>
              <RefreshCw className="mr-1 size-3.5" /> New plan
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          AI Dietician — Indian meal plan from your labs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Diet preference</Label>
            <Select value={diet} onValueChange={(v) => setDiet((v ?? "VEGETARIAN") as Diet)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="VEGETARIAN">Vegetarian</SelectItem>
                <SelectItem value="EGGETARIAN">Eggetarian</SelectItem>
                <SelectItem value="NON_VEG">Non-veg</SelectItem>
                <SelectItem value="JAIN">Jain</SelectItem>
                <SelectItem value="VEGAN">Vegan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Regional cuisine</Label>
            <Select value={region} onValueChange={(v) => setRegion((v ?? "ANY") as Region)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Mix / any</SelectItem>
                <SelectItem value="SOUTH">South Indian</SelectItem>
                <SelectItem value="NORTH">North Indian</SelectItem>
                <SelectItem value="EAST">East Indian (Bengali)</SelectItem>
                <SelectItem value="WEST">West Indian (Gujarati/Maharashtrian)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Allergies / dislikes</Label>
            <Input
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              placeholder="e.g. peanuts, mushroom, gluten"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Daily calorie goal (optional)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={goalKcal}
              onChange={(e) => setGoalKcal(e.target.value)}
              placeholder="e.g. 1800"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={generate} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 size-4 animate-spin" />Analyzing labs…</> : plan ? "Regenerate" : "Generate plan"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setPlan(null); setAccepted(new Set()); }}>
            Cancel
          </Button>
          {plan && !allAccepted && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={acceptAll}>
              Accept all {existingTypes.size > 0 && `(replaces ${Array.from(existingTypes).length})`}
            </Button>
          )}
        </div>

        {plan && (
          <div className="space-y-4 pt-2 border-t">
            {plan.summary && (
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Strategy for today</p>
                <p className="text-sm">{plan.summary}</p>
              </div>
            )}

            {plan.redFlags.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                <p className="text-xs font-semibold flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="size-3.5" /> Priority flags
                </p>
                <ul className="text-xs space-y-0.5 text-muted-foreground">
                  {plan.redFlags.map((f) => <li key={f}>• {f}</li>)}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              {plan.suggestions.map((s, i) => {
                const biomarkers = extractBiomarkers(s.reasoning);
                const conflicts = existingTypes.has(s.mealType);
                const isAccepted = accepted.has(i);
                return (
                  <div
                    key={i}
                    className={`rounded-md border p-3 ${isAccepted ? "bg-primary/5 border-primary/30" : "bg-card"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{MEAL_LABELS[s.mealType]}</Badge>
                          <span className="text-xs text-muted-foreground">{s.time}</span>
                          {s.calories !== null && (
                            <Badge variant="secondary" className="text-[10px]">{s.calories} kcal</Badge>
                          )}
                          {biomarkers.map((b) => (
                            <Badge key={b} variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400">
                              {b}
                            </Badge>
                          ))}
                          {s.restrictions.map((r) => (
                            <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                          ))}
                          {conflicts && !isAccepted && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700">
                              existing {MEAL_LABELS[s.mealType].toLowerCase()}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{s.items}</p>
                        {s.reasoning && <p className="text-xs text-muted-foreground italic">{s.reasoning}</p>}
                        {s.notes && <p className="text-xs text-muted-foreground">📝 {s.notes}</p>}
                      </div>
                      {isAccepted ? (
                        <Button size="sm" variant="outline" disabled>
                          <Check className="mr-1 size-3.5" />Added
                        </Button>
                      ) : conflicts ? (
                        <div className="flex flex-col gap-1">
                          <Button size="sm" variant="default" onClick={() => accept(i, s, "REPLACE")}>
                            <ReplaceIcon className="mr-1 size-3.5" />Replace
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => accept(i, s, "ADD")}>
                            <Plus className="mr-1 size-3.5" />Add anyway
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => accept(i, s, "ADD")}>
                          <Plus className="mr-1 size-3.5" />Accept
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {plan.watchOuts.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                <p className="text-xs font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <Info className="size-3.5" /> Watch-outs
                </p>
                <ul className="text-xs space-y-0.5 text-muted-foreground">
                  {plan.watchOuts.map((w) => <li key={w}>• {w}</li>)}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground pt-2 border-t">
              AI-generated based on your uploaded lab reports. Not a substitute for professional medical
              or dietary advice — discuss with your doctor before major dietary changes.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
