"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Printer, Phone, AlertTriangle, Pill, Activity, Droplet, Calendar, User } from "lucide-react";
import Link from "next/link";
import { ShareButton } from "@/components/share/share-button";

export type EmergencyData = {
  patient: {
    name: string;
    dateOfBirth: string | null; // "1972-04-18" or null
    ageYears: number | null;
    bloodType: string | null;
    phone: string | null;
  };
  allergies: string[];
  chronicConditions: string[];
  medications: { name: string; dosage: string | null; frequency: string; notes: string | null }[];
  emergencyContact: { name: string | null; phone: string | null; relation: string | null };
  criticalBiomarkers: { name: string; value: string; unit: string | null; interpretation: string; date: string }[];
  generatedAt: string;
};

function formatDate(d: string | null): string | null {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

export function EmergencyCardView({ data }: { data: EmergencyData }) {
  const incomplete = !data.patient.bloodType && data.allergies.length === 0 && !data.emergencyContact.phone;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Action bar (hidden on print) */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Emergency Card</h1>
          <p className="text-sm text-muted-foreground">
            Print this single page and carry it in your wallet. Accurate as of {formatDate(data.generatedAt)}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/settings#emergency">
            <Button variant="outline" size="sm">Edit info</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 size-4" />Print
          </Button>
          <ShareButton
            resource="EMERGENCY_CARD"
            label="Emergency Card"
            buttonLabel="Share via WhatsApp"
          />
        </div>
      </div>

      {incomplete && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-sm print:hidden">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Your card is incomplete.</p>
            <p className="text-xs text-muted-foreground">
              Add blood type, allergies, and an emergency contact in{" "}
              <Link href="/settings#emergency" className="underline">Settings</Link> so first responders have what they need.
            </p>
          </div>
        </div>
      )}

      {/* The card itself */}
      <Card className="border-2 border-primary/30 print:border-destructive print:border-2 print:shadow-none">
        <CardContent className="p-6 space-y-5 print:p-4 print:space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between border-b pb-3 print:border-destructive">
            <div>
              <p className="font-heading text-2xl font-bold text-destructive print:text-destructive">
                🚨 EMERGENCY MEDICAL CARD
              </p>
              <p className="text-xs text-muted-foreground">In case of emergency — call the contact below and show this card to responders.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Blood type</p>
              <p className="font-heading text-3xl font-bold text-destructive">
                {data.patient.bloodType ?? "?"}
              </p>
            </div>
          </div>

          {/* Patient identity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <User className="size-3" /> Name
              </p>
              <p className="font-semibold text-lg">{data.patient.name}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Calendar className="size-3" /> DOB / Age
              </p>
              <p className="font-medium">
                {formatDate(data.patient.dateOfBirth) ?? "—"}
                {data.patient.ageYears !== null && <span className="text-muted-foreground"> ({data.patient.ageYears} years)</span>}
              </p>
            </div>
            {data.patient.phone && (
              <div className="space-y-1 col-span-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Phone className="size-3" /> Patient phone
                </p>
                <p className="font-medium font-mono">{data.patient.phone}</p>
              </div>
            )}
          </div>

          {/* Emergency contact */}
          <div className="rounded-md border-2 border-destructive/40 bg-destructive/5 p-3 print:border-destructive">
            <p className="text-[10px] text-destructive font-semibold uppercase tracking-wider flex items-center gap-1 mb-2">
              <Phone className="size-3" /> Emergency contact — call first
            </p>
            {data.emergencyContact.name || data.emergencyContact.phone ? (
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="font-semibold">{data.emergencyContact.name ?? "—"}</p>
                  {data.emergencyContact.relation && (
                    <p className="text-xs text-muted-foreground">{data.emergencyContact.relation}</p>
                  )}
                </div>
                {data.emergencyContact.phone && (
                  <p className="font-mono text-lg font-bold">{data.emergencyContact.phone}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">(not set)</p>
            )}
          </div>

          {/* Allergies */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> Allergies {data.allergies.length > 0 && `(${data.allergies.length})`}
            </p>
            {data.allergies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.allergies.map((a) => (
                  <Badge key={a} className="bg-destructive text-destructive-foreground font-semibold">
                    {a}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            )}
          </div>

          {/* Chronic conditions */}
          {data.chronicConditions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="size-3.5" /> Chronic conditions ({data.chronicConditions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.chronicConditions.map((c) => (
                  <Badge key={c} variant="outline">{c}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Active medications */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Pill className="size-3.5" /> Active medications {data.medications.length > 0 && `(${data.medications.length})`}
            </p>
            {data.medications.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {data.medications.map((m, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-medium">{m.name}</span>
                    {m.dosage && <span className="text-muted-foreground">{m.dosage}</span>}
                    <span className="text-muted-foreground text-xs">· {m.frequency.toLowerCase().replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            )}
          </div>

          {/* Critical biomarkers */}
          {data.criticalBiomarkers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Droplet className="size-3.5" /> Recent flagged labs
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {data.criticalBiomarkers.slice(0, 8).map((b) => (
                  <div key={b.name} className="truncate">
                    <span className="font-medium">{b.name}:</span>{" "}
                    <span className="tabular-nums">{b.value} {b.unit ?? ""}</span>{" "}
                    <span className="text-destructive">[{b.interpretation}]</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[9px] text-muted-foreground pt-2 border-t">
            Generated from Ayus personal health record on {formatDate(data.generatedAt)}. Verify
            information with the patient or their caregiver before clinical action.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
