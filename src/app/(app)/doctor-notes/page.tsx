import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Stethoscope, Calendar, Pill } from "lucide-react";
import { ShareButton } from "@/components/share/share-button";

export const metadata = { title: "Doctor Notes — Ayus" };

export default async function DoctorNotesPage() {
  const userId = await requireAuth();

  const notes = await prisma.doctorNote.findMany({
    where: { userId },
    include: { prescriptions: true },
    orderBy: { visitDate: "desc" },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Doctor Notes</h1>
          <p className="text-sm text-muted-foreground">
            {notes.length} visit{notes.length !== 1 ? "s" : ""} recorded
          </p>
        </div>
        <Link href="/doctor-notes/new">
          <Button>
            <Plus className="mr-2 size-4" />
            New Visit
          </Button>
        </Link>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Stethoscope className="size-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-medium">No doctor visits recorded</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href="/doctor-notes/new" className="text-primary hover:underline">
              Record your first visit
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{note.doctorName}</CardTitle>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {note.specialty.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                      {note.clinic && <span>{note.clinic}</span>}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                    <Calendar className="size-3.5" />
                    {note.visitDate.toLocaleDateString("en-US", {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {note.diagnosis && (
                  <p className="text-sm">
                    <span className="font-medium">Diagnosis:</span> {note.diagnosis}
                  </p>
                )}
                {note.notes && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{note.notes}</p>
                )}
                {note.prescriptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {note.prescriptions.map((rx) => (
                      <Badge key={rx.id} variant="secondary" className="text-xs">
                        <Pill className="size-2.5 mr-1" />
                        {rx.medication} {rx.dosage && `(${rx.dosage})`}
                      </Badge>
                    ))}
                  </div>
                )}
                {note.followUpDate && (
                  <p className="text-xs text-muted-foreground">
                    Follow-up: {note.followUpDate.toLocaleDateString("en-US", {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </p>
                )}
                <div className="flex justify-end pt-2 border-t mt-3">
                  <ShareButton
                    resource="DOCTOR_NOTE"
                    resourceId={note.id}
                    label="visit record"
                    buttonLabel="Share visit"
                    variant="outline"
                    size="sm"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
