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
  Leaf, FlaskConical, HandHeart, Sunrise, Salad, Wind, Flower2,
  Sparkles, Star, Trash2, Plus, Loader2, AlertTriangle, Info, Clock,
} from "lucide-react";

export type AyurvedicRow = {
  id: string;
  ayurvedicType: string;
  name: string;
  dosha: string | null;
  dose: string | null;
  anupana: string | null;
  timing: string | null;
  time: string;
  daysOfWeek: number[];
  active: boolean;
  isFavorite: boolean;
  notes: string | null;
};

const TYPE_META: Record<string, { icon: typeof Leaf; label: string; color: string }> = {
  HERB:           { icon: Leaf,        label: "Herb",        color: "text-green-600" },
  FORMULATION:    { icon: FlaskConical,label: "Formulation", color: "text-amber-600" },
  THERAPY:        { icon: HandHeart,   label: "Therapy",     color: "text-rose-500" },
  ROUTINE:        { icon: Sunrise,     label: "Routine",     color: "text-orange-500" },
  DIET:           { icon: Salad,       label: "Diet",        color: "text-emerald-500" },
  YOGA_PRANAYAMA: { icon: Wind,        label: "Yoga / Pranayama", color: "text-sky-500" },
  OTHER:          { icon: Flower2,     label: "Other",       color: "text-violet-500" },
};

const DOSHA_STYLE: Record<string, string> = {
  VATA: "text-sky-600 border-sky-500/30 bg-sky-500/10",
  PITTA: "text-rose-600 border-rose-500/30 bg-rose-500/10",
  KAPHA: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  TRIDOSHA: "text-violet-600 border-violet-500/30 bg-violet-500/10",
};

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type Prefs = { doshaLean: string; goal: string; intensity: string; avoid: string };
type PlanMeta = { summary: string; doshaAssessment: string; redFlags: string[]; watchOuts: string[] } | null;

export function AyurvedaShell({ schedules }: { schedules: AyurvedicRow[] }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [showPrefs, setShowPrefs] = useState(schedules.length === 0);
  const [plan, setPlan] = useState<PlanMeta>(null);
  const [prefs, setPrefs] = useState<Prefs>({ doshaLean: "UNSURE", goal: "BALANCE", intensity: "GENTLE", avoid: "" });
  const [adding, setAdding] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/ayurveda/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...prefs, save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate a plan");
      setPlan({
        summary: data.plan.summary,
        doshaAssessment: data.plan.doshaAssessment ?? "",
        redFlags: data.plan.redFlags ?? [],
        watchOuts: data.plan.watchOuts ?? [],
      });
      setShowPrefs(false);
      toast.success(`Built a ${data.saved}-item Ayurvedic plan from your health data`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function removeItem(id: string) {
    const res = await fetch(`/api/ayurveda-schedules/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); router.refresh(); }
    else toast.error("Couldn't remove");
  }

  async function toggleFavorite(row: AyurvedicRow) {
    const res = await fetch(`/api/ayurveda-schedules/${row.id}`, {
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
          <H1 className="text-3xl">Ayurveda Planner</H1>
          <Muted>Dosha- and biomarker-aware herbs, therapies, and routines. Approve the plan and it goes into your schedule.</Muted>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPrefs((v) => !v)}>Preferences</Button>
          <Button size="sm" className="gap-1.5" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Consulting…" : "Generate my plan"}
          </Button>
        </div>
      </div>

      {showPrefs && (
        <Card>
          <CardContent className="py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Your dosha (if known)">
              <NativeSelect value={prefs.doshaLean} onChange={(v) => setPrefs({ ...prefs, doshaLean: v })}
                options={[["UNSURE", "Not sure — assess for me"], ["VATA", "Vata"], ["PITTA", "Pitta"], ["KAPHA", "Kapha"]]} />
            </Field>
            <Field label="Primary goal">
              <NativeSelect value={prefs.goal} onChange={(v) => setPrefs({ ...prefs, goal: v })}
                options={[["BALANCE", "Overall balance"], ["DIGESTION", "Digestion (Agni)"], ["ENERGY", "Energy & vitality"], ["SLEEP_STRESS", "Sleep & stress"], ["IMMUNITY", "Immunity (Ojas)"], ["DETOX", "Gentle detox"]]} />
            </Field>
            <Field label="Intensity">
              <NativeSelect value={prefs.intensity} onChange={(v) => setPrefs({ ...prefs, intensity: v })}
                options={[["GENTLE", "Gentle (few items)"], ["MODERATE", "Moderate"]]} />
            </Field>
            <Field label="Avoid / allergies">
              <Input placeholder="e.g. dairy, strong herbs" value={prefs.avoid}
                onChange={(e) => setPrefs({ ...prefs, avoid: e.target.value })} className="h-9" />
            </Field>
          </CardContent>
        </Card>
      )}

      {plan && (plan.summary || plan.doshaAssessment || plan.redFlags.length > 0 || plan.watchOuts.length > 0) && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 space-y-2 text-sm">
            {plan.doshaAssessment && (
              <p className="flex items-start gap-2"><Flower2 className="size-4 mt-0.5 shrink-0 text-violet-500" /> <span><span className="font-medium">Dosha read: </span>{plan.doshaAssessment}</span></p>
            )}
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
            <Leaf className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No Ayurvedic plan yet</p>
              <Muted className="text-sm">Set your preferences and hit “Generate my plan” — it reads your latest labs and dosha lean to tailor herbs, therapies and routine.</Muted>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((s) => {
            const meta = TYPE_META[s.ayurvedicType] ?? TYPE_META.OTHER;
            const Icon = meta.icon;
            const daily = s.daysOfWeek.length === 0;
            return (
              <Card key={s.id} className="group">
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Icon className={`size-4 shrink-0 mt-0.5 ${meta.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm truncate">{s.name}</span>
                        {s.dose && <span className="text-xs text-muted-foreground shrink-0">{s.dose}</span>}
                        {s.dosha && <Badge variant="outline" className={`text-[9px] ${DOSHA_STYLE[s.dosha] ?? ""}`}>{s.dosha.toLowerCase()}</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {meta.label}{s.anupana ? ` · with ${s.anupana}` : ""}
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
                    {s.timing && <Badge variant="outline" className="text-[9px]">{s.timing}</Badge>}
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
        Educational only — Ayurvedic herbs and therapies are complementary, not a replacement for medical care. Coordinate with a qualified Ayurvedic physician and your doctor, especially alongside medications.
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
  const [type, setType] = useState("HERB");
  const [dose, setDose] = useState("");
  const [time, setTime] = useState("07:00");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ayurveda-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ayurvedicType: type, name: name.trim(), dose: dose || null, time, daysOfWeek: [] }),
      });
      if (!res.ok) throw new Error();
      setName(""); setDose(""); setAdding(false); onAdded();
    } catch { toast.error("Couldn't add"); }
    finally { setSaving(false); }
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
        <Plus className="size-4" /> Add an item manually
      </button>
    );
  }
  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-end gap-2">
        <Field label="What"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ashwagandha" className="h-9 w-44" /></Field>
        <Field label="Type"><NativeSelect value={type} onChange={setType} options={Object.entries(TYPE_META).map(([k, m]) => [k, m.label])} /></Field>
        <Field label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="500 mg" className="h-9 w-24" /></Field>
        <Field label="Time"><Input value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-24" /></Field>
        <Button size="sm" onClick={save} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
      </CardContent>
    </Card>
  );
}
