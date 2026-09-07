"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X, Plus } from "lucide-react";

type Props = {
  initial: {
    dateOfBirth: string | null;
    bloodType: string | null;
    allergies: string[];
    chronicConditions: string[];
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
  };
};

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

function ChipInput({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  }

  function remove(v: string) {
    onChange(values.filter((x) => x !== v));
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button type="button" onClick={() => remove(v)} className="hover:text-destructive">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmergencyForm({ initial }: Props) {
  const [dob, setDob] = useState(initial.dateOfBirth ?? "");
  const [bloodType, setBloodType] = useState(initial.bloodType ?? "");
  const [allergies, setAllergies] = useState<string[]>(initial.allergies);
  const [conditions, setConditions] = useState<string[]>(initial.chronicConditions);
  const [contactName, setContactName] = useState(initial.emergencyContactName ?? "");
  const [contactPhone, setContactPhone] = useState(initial.emergencyContactPhone ?? "");
  const [contactRelation, setContactRelation] = useState(initial.emergencyContactRelation ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/user/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateOfBirth: dob || null,
          bloodType: bloodType || null,
          allergies,
          chronicConditions: conditions,
          emergencyContactName: contactName,
          emergencyContactPhone: contactPhone,
          emergencyContactRelation: contactRelation,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed to save" }));
        toast.error(error);
        return;
      }
      toast.success("Emergency info saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="emergency" className="space-y-4 scroll-mt-20">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="dob" className="text-xs">Date of birth</Label>
          <Input
            id="dob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Blood type</Label>
          <Select value={bloodType || "none"} onValueChange={(v) => setBloodType(!v || v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {BLOOD_TYPES.map((bt) => <SelectItem key={bt} value={bt}>{bt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ChipInput
        label="Allergies"
        placeholder="e.g. penicillin, peanuts"
        values={allergies}
        onChange={setAllergies}
      />
      <ChipInput
        label="Chronic conditions"
        placeholder="e.g. Type 2 diabetes, hypertension"
        values={conditions}
        onChange={setConditions}
      />

      <div className="rounded-md border p-3 space-y-3 bg-muted/30">
        <p className="text-sm font-medium">Emergency contact</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ename" className="text-xs">Name</Label>
            <Input id="ename" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="e.g. Priya Krishnan" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="erel" className="text-xs">Relation</Label>
            <Input id="erel" value={contactRelation} onChange={(e) => setContactRelation(e.target.value)} placeholder="e.g. Spouse, Daughter" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ephone" className="text-xs">Phone</Label>
            <Input id="ephone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91 98765 43210" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          Visible on your printable emergency card — carry it in your wallet.
        </p>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save emergency info"}
        </Button>
      </div>
    </div>
  );
}
