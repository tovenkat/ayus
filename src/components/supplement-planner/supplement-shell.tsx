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
  Pill, Sun, Fish, Sprout, Beef, Leaf, Atom, Droplet, Tablets,
  Sparkles, Star, Trash2, Plus, Loader2, AlertTriangle, Info, Clock,
} from "lucide-react";

export type SupplementRow = {
  id: string;
  supplementType: string;
  name: string;
  dose: string | null;
  form: string | null;
  timing: string | null;
  time: string;
  daysOfWeek: number[];
  active: boolean;
  isFavorite: boolean;
  notes: string | null;
};

const TYPE_META: Record<string, { icon: typeof Pill; label: string; color: string }> = {
  VITAMIN:     { icon: Sun,     label: "Vitamin",     color: "text-amber-500" },
  MINERAL:     { icon: Atom,    label: "Mineral",     color: "text-slate-500" },
  OMEGA:       { icon: Fish,    label: "Omega",       color: "text-sky-500" },
  PROBIOTIC:   { icon: Sprout,  label: "Probiotic",   color: "text-emerald-500" },
  PROTEIN:     { icon: Beef,    label: "Protein",     color: "text-rose-500" },
  HERBAL:      { icon: Leaf,    label: "Herbal",      color: "text-green-600" },
  AMINO:       { icon: Droplet, label: "Amino",       color: "text-indigo-500" },
  ANTIOXIDANT: { icon: Atom,    label: "Antioxidant", color: "text-fuchsia-500" },
  OTHER:       { icon: Tablets, label: "Other",       color: "text-muted-foreground" },
};

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TIMING_LABEL: Record<string, string> = {
  "with food": "with food",
  "empty stomach": "empty stomach",
  bedtime: "at bedtime",
};

type Prefs = { goal: string; diet: string; budget: string; avoid: string };
type PlanMeta = { summary: string; redFlags: string[]; watchOuts: string[] } | null;

export function SupplementShell({ schedules }: { schedules: SupplementRow[] }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [showPrefs, setShowPrefs] = useState(schedules.length === 0);
  const [plan, setPlan] = useState<PlanMeta>(null);
  const [prefs, setPrefs] = useState<Prefs>({ goal: "GENERAL", diet: "OMNIVORE", budget: "BALANCED", avoid: "" });
  const [adding, setAdding] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/supplement/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...prefs, save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate a plan");
      setPlan({ summary: data.plan.summary, redFlags: data.plan.redFlags ?? [], watchOuts: data.plan.watchOuts ?? [] });
      setShowPrefs(false);
      toast.success(`Built a ${data.saved}-item stack from your health data`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function removeItem(id: string) {
    const res = await fetch(`/api/supplement-schedules/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); router.refresh(); }
    else toast.error("Couldn't remove");
  }

  async function toggleFavorite(row: SupplementRow) {
    const res = await fetch(`/api/supplement-schedules/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: !row.isFavorite }),
    });
    if (res.ok) router.refresh();
  }

  const active = schedules.filter((s) => s.active);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <H1 className="text-3xl">Supplement Planner</H1>
          <Muted>A supplement stack tailored to your labs, medications, and goals. Approve it and it goes into your schedule.</Muted>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPrefs((v) => !v)}>Preferences</Button>
          <Button size="sm" className="gap-1.5" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Building…" : "Generate my stack"}
          </Button>
        </div>
      </div>

      {showPrefs && (
        <Card>
          <CardContent className="py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Primary goal">
              <NativeSelect value={prefs.goal} onChange={(v) => setPrefs({ ...prefs, goal: v })}
                options={[["GENERAL", "General health"], ["ENERGY", "Energy"], ["IMMUNITY", "Immunity"], ["BONE_JOINT", "Bone & joint"], ["HEART", "Heart"], ["SLEEP_STRESS", "Sleep & stress"], ["GUT", "Gut health"]]} />
            </Field>
            <Field label="Diet">
              <NativeSelect value={prefs.diet} onChange={(v) => setPrefs({ ...prefs, diet: v })}
                options={[["OMNIVORE", "Omnivore"], ["VEGETARIAN", "Vegetarian"], ["VEGAN", "Vegan"]]} />
            </Field>
            <Field label="Depth">
              <NativeSelect value={prefs.budget} onChange={(v) => setPrefs({ ...prefs, budget: v })}
                options={[["LEAN", "Lean (essentials)"], ["BALANCED", "Balanced"], ["COMPREHENSIVE", "Comprehensive"]]} />
            </Field>
            <Field label="Avoid / allergies">
              <Input placeholder="e.g. shellfish, soy" value={prefs.avoid}
                onChange={(e) => setPrefs({ ...prefs, avoid: e.target.value })} className="h-9" />
            </Field>
          </CardContent>
        </Card>
      )}

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

      {active.length === 0 && !generating ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Pill className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No supplement plan yet</p>
              <Muted className="text-sm">Set your preferences and hit “Generate my stack” — the AI reads your latest labs to tailor it.</Muted>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((s) => {
            const meta = TYPE_META[s.supplementType] ?? TYPE_META.OTHER;
            const Icon = meta.icon;
            const daily = s.daysOfWeek.length === 0;
            return (
              <Card key={s.id} className="group">
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Icon className={`size-4 shrink-0 mt-0.5 ${meta.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">{s.name}</span>
                        {s.dose && <span className="text-xs text-muted-foreground shrink-0">{s.dose}</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {meta.label}{s.form ? ` · ${s.form}` : ""}
                      </div>
                    </div>
                    <button onClick={() => toggleFavorite(s)} title="Pin (kept when you regenerate)" className="opacity-60 hover:opacity-100">
                      <Star className={`size-3.5 ${s.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                    <button onClick={() => removeItem(s.id)} title="Remove" className="opacity-0 group-hover:opacity-70 hover:opacity-100 text-destructive">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    <span>{s.time}</span>
                    {s.timing && <Badge variant="outline" className="text-[9px]">{TIMING_LABEL[s.timing] ?? s.timing}</Badge>}
                  </div>
                  {!daily && (
                    <div className="flex gap-0.5">
                      {DAYS.map((d, i) => (
                        <span key={d} className={`text-[9px] rounded px-1 py-0.5 ${s.daysOfWeek.includes(i) ? "bg-primary/15 text-primary" : "text-muted-foreground/40"}`}>{d}</span>
                      ))}
                    </div>
                  )}
                  {s.notes && <p className="text-[11px] text-muted-foreground/80 line-clamp-2">{s.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground italic">
        Educational only — supplements aren’t a substitute for prescribed treatment. Check with your doctor, especially alongside medications.
      </p>

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
  const [type, setType] = useState("VITAMIN");
  const [dose, setDose] = useState("");
  const [time, setTime] = useState("08:00");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/supplement-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplementType: type, name: name.trim(), dose: dose || null, time, daysOfWeek: [] }),
      });
      if (!res.ok) throw new Error();
      setName(""); setDose(""); setAdding(false); onAdded();
    } catch { toast.error("Couldn't add"); }
    finally { setSaving(false); }
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
        <Plus className="size-4" /> Add a supplement manually
      </button>
    );
  }
  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-end gap-2">
        <Field label="What"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vitamin D3" className="h-9 w-44" /></Field>
        <Field label="Type"><NativeSelect value={type} onChange={setType} options={Object.entries(TYPE_META).map(([k, m]) => [k, m.label])} /></Field>
        <Field label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="1000 IU" className="h-9 w-24" /></Field>
        <Field label="Time"><Input value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-24" /></Field>
        <Button size="sm" onClick={save} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
      </CardContent>
    </Card>
  );
}
