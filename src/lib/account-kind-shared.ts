/**
 * Pure account-kind types + labels + helpers — safe to import from client
 * components. Nothing here touches Prisma / pg / dns.
 *
 * The DB-side resolver (`getAccountKind`, `requireKind`) lives in
 * `account-kind.ts`, which is server-only.
 */

export type AccountKind = "personal" | "lab" | "doctor" | "hospital" | "unknown";

export const ACCOUNT_KINDS: readonly AccountKind[] = ["personal", "lab", "doctor", "hospital", "unknown"] as const;

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  personal: "Individual",
  lab: "Laboratory",
  doctor: "Doctor",
  hospital: "Hospital",
  unknown: "—",
};

/**
 * Kind hierarchy. Hospital gets everything doctor gets. Everything else
 * is its own track.
 */
export function kindIncludes(kind: AccountKind, target: AccountKind): boolean {
  if (kind === target) return true;
  if (kind === "hospital" && target === "doctor") return true;
  return false;
}

/** True when the kind manages other people's records (a patient roster). */
export function hasPatientRoster(kind: AccountKind): boolean {
  return kind === "lab" || kind === "doctor" || kind === "hospital";
}

/** True when the kind sees only its own records. */
export function isPersonal(kind: AccountKind): boolean {
  return kind === "personal";
}
