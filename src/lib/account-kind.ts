/**
 * Server-side account-kind resolver + route gate.
 *
 * DO NOT import this file from a "use client" component — it pulls in Prisma
 * (which pulls in `pg`, which needs Node's `dns`). Client code needs only
 * types/labels/helpers, all of which live in `./account-kind-shared.ts`.
 *
 *   personal — INDIVIDUAL org
 *   lab      — DIAGNOSTIC_CENTER org
 *   doctor   — CLINIC org
 *   hospital — HOSPITAL org
 *   unknown  — ENTERPRISE org / no membership
 */

import { prisma } from "@/lib/prisma";
import type { AccountKind } from "@/lib/account-kind-shared";

// Re-export the pure surface so existing server-side imports of
// `@/lib/account-kind` (types, labels, helpers) keep working.
export {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABEL,
  kindIncludes,
  hasPatientRoster,
  isPersonal,
} from "@/lib/account-kind-shared";
export type { AccountKind } from "@/lib/account-kind-shared";

const ORG_TYPE_TO_KIND: Record<string, AccountKind> = {
  INDIVIDUAL: "personal",
  DIAGNOSTIC_CENTER: "lab",
  CLINIC: "doctor",
  HOSPITAL: "hospital",
};

export async function getAccountKind(userId: string): Promise<AccountKind> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { type: true } } },
  });
  const orgType = membership?.organization.type;
  if (!orgType) return "unknown";
  return ORG_TYPE_TO_KIND[orgType] ?? "unknown";
}

/**
 * Gate a page to a set of account kinds. Redirects to /dashboard if the
 * current user is signed in but has the wrong kind. Signed-out users are
 * bounced to /login by the auth check.
 */
export async function requireKind(...allowed: AccountKind[]): Promise<AccountKind> {
  const { requireAuth } = await import("@/lib/auth-helpers");
  const { redirect } = await import("next/navigation");
  const userId = await requireAuth();
  const kind = await getAccountKind(userId);
  if (!allowed.includes(kind)) redirect("/dashboard");
  return kind;
}
