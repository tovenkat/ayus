import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { reconcileVault } from "@/lib/vault-reconcile";
import { embedPendingChunks } from "@/lib/ingestion/pipeline";

export async function POST() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const result = await reconcileVault(userId);

  let embedded = 0;
  try {
    let batch = await embedPendingChunks(userId);
    embedded = batch;
    while (batch > 0) {
      batch = await embedPendingChunks(userId);
      embedded += batch;
    }
  } catch {
    // embedding failure is non-fatal
  }

  return NextResponse.json({ ...result, embedded });
}
