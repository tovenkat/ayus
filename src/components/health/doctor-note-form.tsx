"use client";

import { useActionState, useState } from "react";
import { createDoctorNote, type DoctorNoteState } from "@/lib/actions/health";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

const SPECIALTIES = [
  { value: "GENERAL", label: "General / Family Medicine" },
  { value: "CARDIOLOGY", label: "Cardiology" },
  { value: "ENDOCRINOLOGY", label: "Endocrinology" },
  { value: "GASTROENTEROLOGY", label: "Gastroenterology" },
  { value: "NEPHROLOGY", label: "Nephrology" },
  { value: "NEUROLOGY", label: "Neurology" },
  { value: "ONCOLOGY", label: "Oncology" },
  { value: "OPHTHALMOLOGY", label: "Ophthalmology" },
  { value: "ORTHOPEDICS", label: "Orthopedics" },
  { value: "PULMONOLOGY", label: "Pulmonology" },
  { value: "DERMATOLOGY", label: "Dermatology" },
  { value: "UROLOGY", label: "Urology" },
  { value: "GYNECOLOGY", label: "Gynecology" },
  { value: "PSYCHIATRY", label: "Psychiatry" },
  { value: "ENT", label: "ENT" },
  { value: "DENTAL", label: "Dental" },
  { value: "OTHER", label: "Other" },
];

type Prescription = { id: number };

const initial: DoctorNoteState = {};

export function DoctorNoteForm() {
  const [state, formAction, pending] = useActionState(createDoctorNote, initial);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [specialty, setSpecialty] = useState("GENERAL");

  const addPrescription = () => {
    setPrescriptions((prev) => [...prev, { id: Date.now() }]);
  };

  const removePrescription = (id: number) => {
    setPrescriptions((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* Visit details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visit Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="visitDate">Visit Date *</Label>
              <Input id="visitDate" name="visitDate" type="date" required
                defaultValue={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followUpDate">Follow-up Date</Label>
              <Input id="followUpDate" name="followUpDate" type="date" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doctorName">Doctor Name *</Label>
              <Input id="doctorName" name="doctorName" placeholder="Dr. Smith" required />
            </div>
            <div className="space-y-2">
              <Label>Specialty</Label>
              <input type="hidden" name="specialty" value={specialty} />
              <Select value={specialty} onValueChange={(v) => v && setSpecialty(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPECIALTIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clinic">Clinic / Hospital</Label>
            <Input id="clinic" name="clinic" placeholder="City Hospital" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="diagnosis">Diagnosis</Label>
            <Input id="diagnosis" name="diagnosis" placeholder="Primary diagnosis" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" placeholder="Visit notes, observations, recommendations..."
              rows={3} />
          </div>
        </CardContent>
      </Card>

      {/* Prescriptions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Prescriptions</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addPrescription}>
              <Plus className="mr-1 size-3.5" />
              Add Medication
            </Button>
          </div>
        </CardHeader>
        {prescriptions.length > 0 && (
          <CardContent className="space-y-4">
            {prescriptions.map((rx, i) => (
              <div key={rx.id} className="grid grid-cols-12 gap-2 items-end border-b pb-3 last:border-0">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Medication *</Label>
                  <Input name="medName" placeholder="Name" required />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Dosage</Label>
                  <Input name="medDosage" placeholder="500mg" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Input name="medFrequency" placeholder="Twice daily" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Duration</Label>
                  <Input name="medDuration" placeholder="30 days" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Instructions</Label>
                  <Input name="medInstructions" placeholder="After meals" />
                </div>
                <div className="col-span-1">
                  <Button type="button" variant="ghost" size="icon"
                    onClick={() => removePrescription(rx.id)} className="size-8">
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {state.errors && (
        <p className="text-sm text-destructive">
          {Object.values(state.errors).flat().join(", ")}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save Doctor Visit"}
        </Button>
        <Button type="button" variant="outline" onClick={() => history.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
