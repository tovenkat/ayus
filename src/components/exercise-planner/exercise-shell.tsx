"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { H1, Muted } from "@/components/ui/typography";
import {
  Dumbbell, Footprints, HeartPulse, Flower2, Activity, StretchHorizontal,
  Trophy, Moon, Sparkles, Star, Trash2, Plus, Loader2, AlertTriangle, Info,
} from "lucide-react";

export type ExerciseRow = {
  id: string;
  exerciseType: string;
  name: string;
  time: string;
  durationMin: number | null;
  intensity: string | null;
  targetAreas: string[];
  daysOfWeek: number[];
  active: boolean;
  isFavorite: boolean;
  notes: string | null;
};

const TYPE_META: Record<string, { icon: typeof Activity; label: string; color: string }> = {
  CARDIO:      { icon: HeartPulse,        label: "Cardio",      color: "text-rose-500" },
  STRENGTH:    { icon: Dumbbell,          label: "Strength",    color: "text-indigo-500" },
  FLEXIBILITY: { icon: StretchHorizontal, label: "Flexibility", color: "text-cyan-500" },
  BALANCE:     { icon: Activity,          label: "Balance",     color: "text-amber-500" },
  YOGA:        { icon: Flower2,           label: "Yoga",        color: "text-violet-500" },
  WALK:        { icon: Footprints,        label: "Walk",        color: "text-emerald-500" },
  SPORT:       { icon: Trophy,            label: "Sport",       color: "text-orange-500" },
  REST:        { icon: Moon,              label: "Rest",        color: "text-slate-400" },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INTENSITY_STYLE: Record<string, string> = {
  low: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  moderate: "text-amber-600 border-amber-500/30 bg-amber-500/10",
  vigorous: "text-rose-600 border-rose-500/30 bg-rose-500/10",
};

type Prefs = {
  level: string; goal: string; daysPerWeek: number; equipment: string;
  minutesPerSession: number; limitations: string;
};

type PlanMeta = { summary: string; redFlags: string[]; watchOuts: string[] } | null;

export function ExerciseShell({ schedules }: { schedules: ExerciseRow[] }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [showPrefs, setShowPrefs] = useState(schedules.length === 0);
  const [plan, setPlan] = useState<PlanMeta>(null);
  const [prefs, setPrefs] = useState<Prefs>({
    level: "BEGINNER", goal: "GENERAL", daysPerWeek: 4, equipment: "HOME",
    minutesPerSession: 30, limitations: "",
  });
  const [adding, setAdding] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/exercise/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...prefs, save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate a plan");
      setPlan({ summary: data.plan.summary, redFlags: data.plan.redFlags ?? [], watchOuts: data.plan.watchOuts ?? [] });
      setShowPrefs(false);
      toast.success(`Built a ${data.saved}-session week from your health data`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function removeSession(id: string) {
    const res = await fetch(`/api/exercise-schedules/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); router.refresh(); }
    else toast.error("Couldn't remove");
  }

  async function toggleFavorite(row: ExerciseRow) {
    const res = await fetch(`/api/exercise-schedules/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: !row.isFavorite }),
    });
    if (res.ok) router.refresh();
  }

  // Group sessions by day of week (empty daysOfWeek = every day).
  const byDay: ExerciseRow[][] = DAYS.map((_, d) =>
    schedules.filter((s) => s.active && (s.daysOfWeek.length === 0 || s.daysOfWeek.includes(d))),
  );
  const todayIdx = new Date().getDay();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <H1 className="text-3xl">Exercise Planner</H1>
          <Muted>A weekly workout plan tailored to your labs, medications, and goals.</Muted>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPrefs((v) => !v)}>Preferences</Button>
          <Button size="sm" className="gap-1.5" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Building…" : "Generate my week"}
          </Button>
        </div>
      </div>

      {/* Preferences */}
      {showPrefs && (
        <Card>
          <CardContent className="py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Fitness level">
              <NativeSelect value={prefs.level} onChange={(v) => setPrefs({ ...prefs, level: v })}
                options={[["BEGINNER", "Beginner"], ["INTERMEDIATE", "Intermediate"], ["ADVANCED", "Advanced"]]} />
            </Field>
            <Field label="Primary goal">
              <NativeSelect value={prefs.goal} onChange={(v) => setPrefs({ ...prefs, goal: v })}
                options={[["GENERAL", "General fitness"], ["WEIGHT_LOSS", "Weight loss"], ["STRENGTH", "Strength"], ["ENDURANCE", "Endurance"], ["MOBILITY", "Mobility / flexibility"]]} />
            </Field>
            <Field label="Equipment">
              <NativeSelect value={prefs.equipment} onChange={(v) => setPrefs({ ...prefs, equipment: v })}
                options={[["NONE", "None (bodyweight)"], ["HOME", "Home (bands/dumbbells)"], ["GYM", "Full gym"]]} />
            </Field>
            <Field label="Days / week">
              <Input type="number" min={2} max={7} value={prefs.daysPerWeek}
                onChange={(e) => setPrefs({ ...prefs, daysPerWeek: Math.min(7, Math.max(2, Number(e.target.value) || 4)) })} className="h-9" />
            </Field>
            <Field label="Minutes / session">
              <Input type="number" min={10} max={120} value={prefs.minutesPerSession}
                onChange={(e) => setPrefs({ ...prefs, minutesPerSession: Number(e.target.value) || 30 })} className="h-9" />
            </Field>
            <Field label="Injuries / limitations">
              <Input placeholder="e.g. bad knee, avoid jumping" value={prefs.limitations}
                onChange={(e) => setPrefs({ ...prefs, limitations: e.target.value })} className="h-9" />
            </Field>
          </CardContent>
        </Card>
      )}

      {/* Plan summary from the last generation */}
      {plan && (plan.summary || plan.redFlags.length > 0 || plan.watchOuts.length > 0) && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 space-y-2 text-sm">
            {plan.summary && <p>{plan.summary}</p>}
            {plan.redFlags.map((f) => (
              <p key={f} className="flex items-start gap-2 text-rose-600"><AlertTriangle className="size-4 mt-0.5 shrink-0" /> {f}</p>
            ))}
            {plan.watchOuts.map((w) => (
              <p key={w} className="flex items-start gap-2 text-muted-foreground"><Info className="size-4 mt-0.5 shrink-0" /> {w}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {schedules.filter((s) => s.active).length === 0 && !generating ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Dumbbell className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No workout plan yet</p>
              <Muted className="text-sm">Set your preferences above and hit “Generate my week” — the AI reads your latest labs to tailor it.</Muted>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Weekly grid */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DAYS.map((day, d) => {
            const items = byDay[d];
            const isToday = d === todayIdx;
            return (
              <Card key={day} className={isToday ? "border-primary/40 ring-1 ring-primary/10" : ""}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{day}{isToday ? " · Today" : ""}</span>
                    <span className="text-[10px] text-muted-foreground">{items.length || "rest"}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">Rest / recovery</p>
                  ) : (
                    items.map((s) => {
                      const meta = TYPE_META[s.exerciseType] ?? TYPE_META.CARDIO;
                      const Icon = meta.icon;
                      return (
                        <div key={s.id} className="group rounded-md border p-2 text-xs space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Icon className={`size-3.5 shrink-0 ${meta.color}`} />
                            <span className="font-medium truncate flex-1">{s.name}</span>
                            <button onClick={() => toggleFavorite(s)} title="Pin (kept when you regenerate)" className="opacity-60 hover:opacity-100">
                              <Star className={`size-3.5 ${s.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                            </button>
                            <button onClick={() => removeSession(s.id)} title="Remove" className="opacity-0 group-hover:opacity-70 hover:opacity-100 text-destructive">
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap text-muted-foreground">
                            <span>{s.time}</span>
                            {s.durationMin ? <span>· {s.durationMin}m</span> : null}
                            {s.intensity ? (
                              <Badge variant="outline" className={`text-[9px] ${INTENSITY_STYLE[s.intensity] ?? ""}`}>{s.intensity}</Badge>
                            ) : null}
                          </div>
                          {s.targetAreas.length > 0 && (
                            <div className="text-[10px] text-muted-foreground/80 truncate">{s.targetAreas.join(" · ")}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Quick add */}
      <QuickAdd adding={adding} setAdding={setAdding} onAdded={() => router.refresh()} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function NativeSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function QuickAdd({ adding, setAdding, onAdded }: { adding: boolean; setAdding: (v: boolean) => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("WALK");
  const [time, setTime] = useState("07:00");
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/exercise-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseType: type, name: name.trim(), time, durationMin: duration, daysOfWeek: [] }),
      });
      if (!res.ok) throw new Error();
      setName(""); setAdding(false); onAdded();
    } catch { toast.error("Couldn't add"); }
    finally { setSaving(false); }
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
        <Plus className="size-4" /> Add a session manually
      </button>
    );
  }
  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-end gap-2">
        <Field label="What"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Evening walk" className="h-9 w-48" /></Field>
        <Field label="Type"><NativeSelect value={type} onChange={setType} options={Object.entries(TYPE_META).map(([k, m]) => [k, m.label])} /></Field>
        <Field label="Time"><Input value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-24" /></Field>
        <Field label="Min"><Input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} className="h-9 w-20" /></Field>
        <Button size="sm" onClick={save} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
      </CardContent>
    </Card>
  );
}
