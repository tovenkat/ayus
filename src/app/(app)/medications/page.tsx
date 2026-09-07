import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill, Clock, Sun, Sunset, Moon, CloudSun } from "lucide-react";
import { MedicationForm } from "@/components/health/medication-form";
import { MedicationActions } from "@/components/health/medication-actions";

export const metadata = { title: "Medications — Ayus" };

const TIME_ICONS: Record<string, typeof Sun> = {
  morning: Sun,
  afternoon: CloudSun,
  evening: Sunset,
  night: Moon,
};

const FREQ_LABELS: Record<string, string> = {
  ONCE_DAILY: "Once daily",
  TWICE_DAILY: "Twice daily",
  THRICE_DAILY: "Three times daily",
  FOUR_TIMES_DAILY: "Four times daily",
  AS_NEEDED: "As needed",
  WEEKLY: "Weekly",
  ALTERNATE_DAYS: "Alternate days",
};

export default async function MedicationsPage() {
  const userId = await requireAuth();

  const medications = await prisma.medication.findMany({
    where: { userId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const active = medications.filter((m) => m.active);
  const inactive = medications.filter((m) => !m.active);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Medications</h1>

      {/* Add new medication form */}
      <MedicationForm />

      {/* Active medications */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Active ({active.length})
          </h2>
          {active.map((med) => (
            <Card key={med.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Pill className="size-4 text-primary" />
                      <span className="font-medium">{med.name}</span>
                      {med.dosage && (
                        <Badge variant="outline" className="text-xs">{med.dosage}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {FREQ_LABELS[med.frequency] ?? med.frequency}
                      </span>
                      <div className="flex gap-1">
                        {med.timeSlots.map((slot) => {
                          const Icon = TIME_ICONS[slot] ?? Clock;
                          return (
                            <Badge key={slot} variant="secondary" className="text-[10px] px-1.5">
                              <Icon className="size-2.5 mr-0.5" />
                              {slot}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    {med.notes && (
                      <p className="text-xs text-muted-foreground">{med.notes}</p>
                    )}
                  </div>
                  <MedicationActions id={med.id} active={med.active} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Inactive medications */}
      {inactive.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Inactive ({inactive.length})
          </h2>
          {inactive.map((med) => (
            <Card key={med.id} className="opacity-60">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Pill className="size-4" />
                    <span className="text-sm">{med.name}</span>
                    {med.dosage && (
                      <span className="text-xs text-muted-foreground">({med.dosage})</span>
                    )}
                  </div>
                  <MedicationActions id={med.id} active={med.active} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {medications.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Pill className="size-12 mx-auto mb-4 opacity-30" />
          <p>No medications added yet. Use the form above to add one.</p>
        </div>
      )}
    </div>
  );
}
