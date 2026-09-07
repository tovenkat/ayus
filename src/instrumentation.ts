export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startVaultWatcher } = await import("@/lib/vault-watcher");
  startVaultWatcher();
  // Background queue poller for uploaded documents. Idempotent — internal
  // `started` flag guards against double-start under Turbopack HMR.
  const { startExtractionWorker } = await import("@/lib/jobs/extraction-worker");
  startExtractionWorker();
}
