"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";

export type DietPrefs = {
  diet: "VEGETARIAN" | "EGGETARIAN" | "NON_VEG" | "JAIN" | "VEGAN";
  region: "SOUTH" | "NORTH" | "EAST" | "WEST" | "ANY";
  avoid: string;
  goalKcal: string;
  // Max minutes the user is willing to spend prepping a meal. String so it
  // round-trips through <input>; empty = no cap.
  maxPrepMinutes: string;
  budget: "LOW" | "MEDIUM" | "HIGH" | "ANY";
};

const DEFAULT_PREFS: DietPrefs = {
  diet: "VEGETARIAN",
  region: "ANY",
  avoid: "",
  goalKcal: "",
  maxPrepMinutes: "",
  budget: "ANY",
};

const KEY = "phr2:diet-prefs";

export function loadPrefs(): DietPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: DietPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
    window.dispatchEvent(new CustomEvent("diet-prefs-changed", { detail: p }));
  } catch {}
}

export function useDietPrefs() {
  const [prefs, setPrefs] = useState<DietPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(loadPrefs());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<DietPrefs>).detail;
      if (next) setPrefs(next);
    };
    window.addEventListener("diet-prefs-changed", onChange);
    return () => window.removeEventListener("diet-prefs-changed", onChange);
  }, []);

  const update = useCallback((next: Partial<DietPrefs>) => {
    setPrefs((prev) => {
      const merged = { ...prev, ...next };
      savePrefs(merged);
      return merged;
    });
  }, []);

  return { prefs, update };
}

export function PreferencesPanel() {
  const { prefs, update } = useDietPrefs();

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" />
          <h2 className="text-base font-semibold">Your preferences</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          These shape every AI suggestion, swap, and weekly plan. Saved to this browser.
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Diet preference</Label>
            <Select value={prefs.diet} onValueChange={(v) => update({ diet: (v ?? "VEGETARIAN") as DietPrefs["diet"] })}>
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
            <Select value={prefs.region} onValueChange={(v) => update({ region: (v ?? "ANY") as DietPrefs["region"] })}>
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
              value={prefs.avoid}
              onChange={(e) => update({ avoid: e.target.value })}
              placeholder="e.g. peanuts, mushroom, gluten"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Daily calorie goal</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={prefs.goalKcal}
              onChange={(e) => update({ goalKcal: e.target.value })}
              placeholder="e.g. 1800"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center justify-between">
              <span>Max prep time (min)</span>
              <span className="text-muted-foreground tabular-nums">
                {prefs.maxPrepMinutes ? `${prefs.maxPrepMinutes} min` : "no cap"}
              </span>
            </Label>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={prefs.maxPrepMinutes ? Number(prefs.maxPrepMinutes) : 0}
              onChange={(e) => update({ maxPrepMinutes: e.target.value === "0" ? "" : e.target.value })}
              className="w-full h-2 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
              aria-label="Maximum prep time in minutes"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Budget preference</Label>
            <Select value={prefs.budget} onValueChange={(v) => update({ budget: (v ?? "ANY") as DietPrefs["budget"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any</SelectItem>
                <SelectItem value="LOW">Budget-friendly</SelectItem>
                <SelectItem value="MEDIUM">Moderate</SelectItem>
                <SelectItem value="HIGH">Premium ingredients OK</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
