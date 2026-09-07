import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { generateVisitPrep } from "@/lib/visit-prep";

export async function POST() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  try {
    const prep = await generateVisitPrep(userId);
    return NextResponse.json(prep);
  } catch (err) {
    console.error("[visit-prep]", err);
    const message = err instanceof Error ? err.message : "Failed to generate visit prep";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
