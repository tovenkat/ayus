/**
 * Feedback screen — available to every account kind (patient / lab / doctor /
 * hospital). Submissions are stored and emailed to FEEDBACK_EMAIL.
 */

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Feedback — Ayus" };

export default async function FeedbackPage() {
  const userId = await requireAuth();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const defaultEmail = user?.email && !user.email.endsWith("@phone.local") && !user.email.endsWith("@userid.local") ? user.email : "";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Feedback &amp; support</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Have an idea for a new feature, or hit a problem? Tell us — it goes straight to our team.
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/feedback/log" />}>
          <ListChecks className="size-4" /> Track feedback
        </Button>
      </div>
      <FeedbackForm defaultEmail={defaultEmail} />
    </div>
  );
}
