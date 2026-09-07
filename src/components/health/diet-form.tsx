"use client";

import { useActionState, useState, useEffect } from "react";
import { createDietSchedule, type DietState } from "@/lib/actions/health";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { toast } from "sonner";

const MEAL_TYPES = [
  { value: "BREAKFAST", label: "Breakfast" },
  { value: "MORNING_SNACK", label: "Morning Snack" },
  { value: "LUNCH", label: "Lunch" },
  { value: "AFTERNOON_SNACK", label: "Afternoon Snack" },
  { value: "DINNER", label: "Dinner" },
  { value: "EVENING_SNACK", label: "Evening Snack" },
];

const RESTRICTIONS = [
  "diabetic", "low-sodium", "low-fat", "high-protein",
  "vegetarian", "vegan", "gluten-free", "lactose-free",
];

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const initial: DietState = {};

export function DietForm() {
  const [state, formAction, pending] = useActionState(createDietSchedule, initial);
  const [mealType, setMealType] = useState("BREAKFAST");
  const [selectedRestrictions, setSelectedRestrictions] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  useEffect(() => {
    if (state.success) toast.success("Diet schedule added");
  }, [state.success]);

  const toggleRestriction = (r: string) => {
    setSelectedRestrictions((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  };

  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Meal Plan</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Meal Type</Label>
              <input type="hidden" name="mealType" value={mealType} />
              <Select value={mealType} onValueChange={(v) => v && setMealType(v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Time</Label>
              <Input name="time" type="time" defaultValue="08:00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Calories</Label>
              <Input name="calories" type="number" placeholder="300" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Items *</Label>
            <Textarea name="items" placeholder="Oats with fruits, green tea, 2 boiled eggs..." rows={2} required />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Days (leave empty for daily)</Label>
            <div className="flex gap-2">
              {DAYS.map((day) => (
                <label key={day.value} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={selectedDays.includes(day.value)}
                    onCheckedChange={() => toggleDay(day.value)}
                  />
                  {day.label}
                  {selectedDays.includes(day.value) && (
                    <input type="hidden" name="daysOfWeek" value={day.value} />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Dietary Restrictions</Label>
            <div className="flex flex-wrap gap-2">
              {RESTRICTIONS.map((r) => (
                <label key={r} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={selectedRestrictions.includes(r)}
                    onCheckedChange={() => toggleRestriction(r)}
                  />
                  {r}
                  {selectedRestrictions.includes(r) && (
                    <input type="hidden" name="restrictions" value={r} />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Input name="notes" placeholder="Avoid sugar, take supplements..." />
          </div>

          {state.errors && (
            <p className="text-sm text-destructive">
              {Object.values(state.errors).flat().join(", ")}
            </p>
          )}

          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="mr-1 size-3.5" />
            {pending ? "Adding..." : "Add Meal Plan"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
