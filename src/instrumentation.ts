export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startVaultWatcher } = await import("@/lib/vault-watcher");
  startVaultWatcher();
  // Background queue poller for uploaded documents. Idempotent — internal
  // `started` flag guards against double-start under Turbopack HMR.
  const { startExtractionWorker } = await import("@/lib/jobs/extraction-worker");
  startExtractionWorker();

  // Warm the local chat + embed models so the first chat message doesn't pay
  // the (multi-second, on CPU) model-load cost. Fire-and-forget; never blocks
  // boot, and harmless when the backend is a cloud provider.
  void warmOllamaModels();
}

// Reads only process.env and uses plain fetch — deliberately imports nothing
// from @/lib/ai (which would pull node-only config.ts into the Edge
// instrumentation bundle). Keeps this file Edge-compilable.
async function warmOllamaModels() {
  const useOllama = (process.env.OLLAMA ?? "YES").toUpperCase() !== "NO";
  const usingCloud = !!(process.env.INTERNET_LLM ?? "").trim();
  if (usingCloud || !useOllama) return; // only local Ollama needs warming

  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const chatModel = process.env.CHAT_MODEL ?? "gemma3";
  const embedModel = process.env.EMBED_MODEL ?? "nomic-embed-text";
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE
    ? (Number.isInteger(Number(process.env.OLLAMA_KEEP_ALIVE)) ? Number(process.env.OLLAMA_KEEP_ALIVE) : process.env.OLLAMA_KEEP_ALIVE)
    : -1;

  const warmChat = fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      keep_alive: keepAlive,
      options: { num_predict: 1 },
    }),
  });
  const warmEmbed = fetch(`${host}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: "warmup", keep_alive: keepAlive }),
  });

  const results = await Promise.allSettled([warmChat, warmEmbed]);
  const ok = results.every((r) => r.status === "fulfilled");
  if (ok) console.log(`[warmup] Ollama models resident: chat=${chatModel} embed=${embedModel}`);
  else console.warn("[warmup] model preload incomplete (Ollama may still be starting)");
}
