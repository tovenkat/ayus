/**
 * Referrals section — inbound (received, actionable) + outbound (sent, tracked).
 * Renders nothing when there are none. Shown on doctor + hospital dashboards.
 */

import Link from "next/link";
import { Share2, ArrowRight } from "lucide-react";
import { getInboundReferrals, getOutboundReferrals } from "@/lib/referrals";
import { ReferralRespond } from "@/components/patients/referral-respond";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_STYLE: Record<string, string> = {
  PENDING:   "text-amber-600 border-amber-500/30 bg-amber-500/10",
  ACCEPTED:  "text-blue-600 border-blue-500/30 bg-blue-500/10",
  COMPLETED: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  DECLINED:  "text-muted-foreground border-border",
};
const spec = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export async function Referrals({ orgId }: { orgId: string }) {
  const [inbound, outbound] = await Promise.all([getInboundReferrals(orgId, 8), getOutboundReferrals(orgId, 8)]);
  if (inbound.length === 0 && outbound.length === 0) return null;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Inbound — actionable */}
      {inbound.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Share2 className="size-4 rotate-180" /> Referrals in
              <Badge variant="outline" className="ml-1">{inbound.filter((r) => r.status === "PENDING").length} pending</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {inbound.map((r) => (
                <li key={r.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.patientName} <span className="font-normal text-muted-foreground">· {spec(r.specialty)}</span></p>
                    <p className="text-xs text-muted-foreground truncate">from {r.from} — {r.reason}</p>
                  </div>
                  {r.status === "PENDING" || r.status === "ACCEPTED"
                    ? <ReferralRespond referralId={r.id} status={r.status} />
                    : <Badge variant="outline" className={STATUS_STYLE[r.status]}>{spec(r.status)}</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Outbound — tracked */}
      {outbound.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Share2 className="size-4" /> Referrals out</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {outbound.map((r) => (
                <li key={r.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.patientName} <span className="font-normal text-muted-foreground">· {spec(r.specialty)}</span></p>
                    <p className="text-xs text-muted-foreground truncate">to {r.to} — {r.reason}</p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 ${STATUS_STYLE[r.status]}`}>{spec(r.status)}</Badge>
                  <Link href={`/patients/${r.patientId}`} className="text-primary text-xs hover:underline shrink-0 inline-flex items-center gap-0.5">
                    <ArrowRight className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
