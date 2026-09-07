"use client";

import { useActionState, useState } from "react";
import { createMedication, type MedicationState } from "@/lib/actions/health";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";

const FREQUENCIES = [
  { value: "ONCE_DAILY", label: "Once daily" },
  { value: "TWICE_DAILY", label: "Twice daily" },
  { value: "THRICE_DAILY", label: "Three times daily" },
  { value: "FOUR_TIMES_DAILY", label: "Four times daily" },
  { value: "AS_NEEDED", label: "As needed" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "ALTERNATE_DAYS", label: "Alternate days" },
];

const TIME_SLOTS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
];

const initial: MedicationState = {};

export function MedicationForm() {
  const [state, formAction, pending] = useActionState(createMedication, initial);
  const [frequency, setFrequency] = useState("ONCE_DAILY");
  const [selectedSlots, setSelectedSlots] = useState<string[]>(["morning"]);

  useEffect(() => {
    if (state.success) toast.success("Medication added");
  }, [state.success]);

  const toggleSlot = (slot: string) => {
    setSelectedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Medication</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input name="name" placeholder="Metformin" required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dosage</Label>
              <Input name="dosage" placeholder="500mg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Frequency</Label>
              <input type="hidden" name="frequency" value={frequency} />
              <Select value={frequency} onValueChange={(v) => v && setFrequency(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Time Slots</Label>
            <div className="flex gap-3">
              {TIME_SLOTS.map((slot) => (
                <label key={slot.value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={selectedSlots.includes(slot.value)}
                    onCheckedChange={() => toggleSlot(slot.value)}
                  />
                  {slot.label}
                  {selectedSlots.includes(slot.value) && (
                    <input type="hidden" name="timeSlots" value={slot.value} />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start Date</Label>
              <Input name="startDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End Date</Label>
              <Input name="endDate" type="date" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Input name="notes" placeholder="After meals" />
            </div>
          </div>

          {state.errors && (
            <p className="text-sm text-destructive">
              {Object.values(state.errors).flat().join(", ")}
            </p>
          )}

          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="mr-1 size-3.5" />
            {pending ? "Adding..." : "Add Medication"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
