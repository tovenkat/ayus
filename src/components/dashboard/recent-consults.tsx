/**
 * Recent consultations recorded by the org — the visible output of the
 * worklist → consult loop. Renders nothing when there are none yet.
 */

import Link from "next/link";
import { Stethoscope, ArrowRight } from "lucide-react";
import { getRecentConsults } from "@/lib/consults";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function RecentConsults({ orgId }: { orgId: string }) {
  const consults = await getRecentConsults(orgId, 6);
  if (consults.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Stethoscope className="size-4" /> Recent consultations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {consults.map((c) => (
            <li key={c.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {c.diagnosis || "Consultation"} <span className="font-normal text-muted-foreground">· {c.patientName}</span>
                </p>
                {c.notes && <p className="text-xs text-muted-foreground truncate">{c.notes}</p>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(c.visitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
              <Link href={`/patients/${c.patientId}`} className="text-primary text-xs hover:underline shrink-0 inline-flex items-center gap-0.5">
                Open <ArrowRight className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
