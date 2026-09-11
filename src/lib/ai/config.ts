/**
 * AI Configuration — parses env vars for provider selection.
 *
 * NB: no `node:*` imports at module scope. This module is reachable from
 * `instrumentation.ts`, which Next.js also compiles for the Edge runtime where
 * Node builtins are rejected. The tiny path helpers below avoid `node:path`.
 */

// Minimal path helpers (only used for local-GGUF model paths). Avoids importing
// node:path so this module stays Edge-compilable.
function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}

export type CloudProvider = "GEMINI" | "OPENAI" | "CLAUDE" | "VLLM" | "LLAMACPP";

/**
 * How long Ollama keeps a model resident after a request. On CPU the model
 * load is expensive (seconds), so we keep it warm between messages. Accepts a
 * duration string ("30m") or an integer number of seconds; "-1" = forever.
 * Configured via OLLAMA_KEEP_ALIVE; defaults to 30m.
 */
export function ollamaKeepAlive(): string | number {
  const v = process.env.OLLAMA_KEEP_ALIVE;
  if (!v) return "30m";
  const n = Number(v);
  return Number.isInteger(n) ? n : v; // -1 / 600 → number; "30m" → string
}

const CLOUD_DEFAULT_MODELS: Record<CloudProvider, string> = {
  GEMINI: "gemini-2.5-flash",
  OPENAI: "gpt-4o-mini",
  CLAUDE: "claude-sonnet-4-20250514",
  VLLM: "vllm-model",           // placeholder; overridden by VLLM_DEFAULT_MODEL env or user.aiModel
  LLAMACPP: "llamacpp-model",   // placeholder; overridden by LLAMACPP_DEFAULT_MODEL env or user.aiModel
};

const CLOUD_API_KEY_ENV: Record<CloudProvider, string> = {
  GEMINI: "GEMINI_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  CLAUDE: "CLAUDE_API_KEY",
  VLLM: "VLLM_API_KEY",       // optional; vLLM typically doesn't require auth
  LLAMACPP: "LLAMACPP_API_KEY", // optional; llama-server usually runs without auth
};

export type ExtractionStrategy = "llm" | "layout" | "auto";

export type AIConfig = {
  internetLlm: CloudProvider | null;
  internetLlmApiKey: string | null;
  internetLlmModel: string | null;
  useOllama: boolean;
  ollamaHost: string;
  chatModel: string;
  extractModel: string;
  ocrModel: string | null;
  embedModel: string;
  chatModelPath: string;
  embedModelDir: string;
  vectorDb: "none" | "lancedb" | "pgvector";
  lancedbPath: string;
  /**
   * Extraction pipeline strategy:
   *   "llm"    (default) — LLM sees full text/image, produces structured JSON
   *   "layout" — PaddleOCR layout-sidecar → deterministic row parser → LLM
   *              fallback for uncertain rows. Requires the sidecar at
   *              LAYOUT_SIDECAR_URL to be running.
   *   "auto"   — layout for scanned/image, llm for text-native PDFs
   */
  extractionStrategy: ExtractionStrategy;
  layoutSidecarUrl: string;

  /**
   * Deployment-wide opt-in: use the configured cloud provider for document
   * EXTRACTION/OCR too (not just chat). Off by default so raw reports stay
   * local (PHI). When true, the operator's INTERNET_LLM / provider choice
   * powers extraction for everyone — matches the per-user cloudExtractionOptIn
   * but at the deployment level. See resolveForRole in user-provider.ts.
   */
  cloudExtraction: boolean;

  // ── Biomedical NER (GLiNER-BioMed) sidecar — narrative clinical text only.
  //    Opt-in (default off); inert until ENABLE_GLINER=true and the sidecar at
  //    GLINER_SIDECAR_URL is running. See scripts/gliner-sidecar/.
  /** Enable the GLiNER-BioMed NER sidecar for unstructured clinical text. */
  enableGliner: boolean;
  glinerSidecarUrl: string;
  glinerModel: string;
  glinerThreshold: number;
  glinerLabels: string[];
  /** Enable native pdf-parse extraction on the text layer. */
  enableNativeExtraction: boolean;
  /** Enable Docling layout + table extraction. */
  enableDocling: boolean;
  /** Enable per-page OCR routing (skip OCR on healthy pages). */
  enablePageLevelOcr: boolean;
  /** Minimum native-text chars per page before that page needs OCR. Default 80. */
  minNativeTextPerPage: number;
  /** Confidence threshold below which extraction is deemed low-quality. Default 0.90. */
  minExtractionConfidence: number;
  /** Confidence threshold below which the report is flagged NEEDS_REVIEW. Default 0.95. */
  requireReviewBelowConfidence: number;
  vllmBaseUrl: string | null;   // e.g. "http://localhost:8001/v1" — OpenAI-compatible endpoint
  vllmApiKey: string | null;    // optional; some vLLM deployments require a bearer token
  vllmDefaultModel: string | null; // fallback model id when the user hasn't picked one
  llamaCppBaseUrl: string | null;   // e.g. "http://localhost:8080/v1" — llama-server default
  llamaCppApiKey: string | null;    // optional
  llamaCppDefaultModel: string | null; // model alias set at llama-server startup
};

let cached: AIConfig | null = null;

export function loadAIConfig(): AIConfig {
  if (cached) return cached;

  const internetLlmRaw = (process.env.INTERNET_LLM ?? "").toUpperCase();
  const internetLlm: CloudProvider | null =
    internetLlmRaw === "GEMINI" || internetLlmRaw === "OPENAI" ||
    internetLlmRaw === "CLAUDE" || internetLlmRaw === "VLLM" ||
    internetLlmRaw === "LLAMACPP"
      ? internetLlmRaw
      : null;

  let internetLlmApiKey: string | null = null;
  if (internetLlm) {
    internetLlmApiKey = process.env[CLOUD_API_KEY_ENV[internetLlm]] ?? null;
    // vLLM and llama.cpp commonly run without auth; the OpenAI SDK still
    // needs a non-empty string, so fill in a placeholder.
    if (!internetLlmApiKey && (internetLlm === "VLLM" || internetLlm === "LLAMACPP")) {
      internetLlmApiKey = "not-required";
    }
    if (!internetLlmApiKey) {
      throw new Error(
        `INTERNET_LLM=${internetLlm} requires ${CLOUD_API_KEY_ENV[internetLlm]} to be set in .env`
      );
    }
  }

  const internetLlmModel = process.env.INTERNET_LLM_MODEL || null;

  const ollamaEnv = (process.env.OLLAMA ?? "YES").toUpperCase();
  const useOllama = ollamaEnv !== "NO";
  const ollamaHost = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const chatModel = process.env.CHAT_MODEL ?? "gemma3";
  const extractModel = process.env.EXTRACT_MODEL ?? chatModel;
  const ocrModel = process.env.OCR_MODEL || null;
  const embedModel = process.env.EMBED_MODEL ?? "nomic-embed-text";

  const chatModelFile = process.env.CHAT_MODEL_FILE ?? "google_gemma-3-4b-it-Q4_K_M.gguf";
  const embedModelDirName = process.env.EMBED_MODEL_DIR ?? "embedding-gemma";

  const cwd = process.cwd();
  const modelsRoot = joinPath(cwd, "models");
  const resolvePath = (name: string) =>
    isAbsolutePath(name) ? name
    : name.includes("/") ? joinPath(cwd, name)
    : joinPath(modelsRoot, name);

  const chatModelPath = resolvePath(chatModelFile);
  const embedModelDir = resolvePath(embedModelDirName);

  const vllmBaseUrl = process.env.VLLM_BASE_URL || null;
  const vllmApiKey = process.env.VLLM_API_KEY || null;
  const vllmDefaultModel = process.env.VLLM_DEFAULT_MODEL || null;

  const llamaCppBaseUrl = process.env.LLAMACPP_BASE_URL || null;
  const llamaCppApiKey = process.env.LLAMACPP_API_KEY || null;
  const llamaCppDefaultModel = process.env.LLAMACPP_DEFAULT_MODEL || null;

  const extractionStrategyEnv = (process.env.EXTRACTION_STRATEGY ?? "llm").toLowerCase();
  const extractionStrategy: ExtractionStrategy =
    extractionStrategyEnv === "layout" ? "layout"
    : extractionStrategyEnv === "auto" ? "auto"
    : "llm";
  const layoutSidecarUrl = process.env.LAYOUT_SIDECAR_URL ?? "http://localhost:8000";

  // ── Page-level routing knobs ──────────────────────────────────────────────
  //   ENABLE_NATIVE_EXTRACTION  — pdf-parse text-layer read (fast, first line)
  //   ENABLE_DOCLING            — Docling layout + table extraction (structured tables)
  //   ENABLE_PAGE_LEVEL_OCR     — only OCR pages that fail the min-chars gate
  //   MIN_NATIVE_TEXT_PER_PAGE  — chars per page below which that page is "weak"
  //                               and gets routed to OCR
  //   MIN_EXTRACTION_CONFIDENCE — used by lab-validators to flag low-quality rows
  //   REQUIRE_REVIEW_BELOW_CONFIDENCE — threshold that flips a Report to NEEDS_REVIEW
  //
  // The three ENABLE_* flags default to true so we get the full pipeline
  // unless a knob is explicitly off. The confidence thresholds match the
  // constants in lab-validators.ts.
  const envBool = (key: string, dflt: boolean): boolean => {
    const v = process.env[key];
    if (v == null) return dflt;
    const s = v.trim().toLowerCase();
    return s !== "false" && s !== "0" && s !== "no" && s !== "";
  };
  const envNum = (key: string, dflt: number): number => {
    const v = process.env[key];
    if (v == null) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  };
  const cloudExtraction            = envBool("CLOUD_EXTRACTION", false);
  const enableNativeExtraction     = envBool("ENABLE_NATIVE_EXTRACTION", true);
  const enableDocling              = envBool("ENABLE_DOCLING", true);
  const enablePageLevelOcr         = envBool("ENABLE_PAGE_LEVEL_OCR", true);
  const minNativeTextPerPage       = Math.max(0, envNum("MIN_NATIVE_TEXT_PER_PAGE", 80));
  const minExtractionConfidence    = Math.min(1, Math.max(0, envNum("MIN_EXTRACTION_CONFIDENCE", 0.90)));
  const requireReviewBelowConfidence = Math.min(1, Math.max(0, envNum("REQUIRE_REVIEW_BELOW_CONFIDENCE", 0.95)));

  // ── GLiNER-BioMed NER sidecar (opt-in) ────────────────────────────────────
  const enableGliner    = envBool("ENABLE_GLINER", false);
  const glinerSidecarUrl = process.env.GLINER_SIDECAR_URL ?? "http://localhost:8001";
  const glinerModel     = process.env.GLINER_MODEL ?? "Ihor/gliner-biomed-base-v1.0";
  const glinerThreshold = Math.min(1, Math.max(0, envNum("GLINER_THRESHOLD", 0.5)));
  const glinerLabels    = (process.env.GLINER_LABELS ?? "lab test,biomarker,disease,medication,anatomical site")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const vectorDbEnv = (process.env.VECTOR_DB ?? "none").toLowerCase();
  const vectorDb: "none" | "lancedb" | "pgvector" =
    vectorDbEnv === "lancedb" ? "lancedb"
    : vectorDbEnv === "pgvector" ? "pgvector"
    : "none";
  const lancedbPath = process.env.LANCEDB_PATH ?? joinPath(process.cwd(), ".lancedb");

  cached = {
    internetLlm, internetLlmApiKey, internetLlmModel,
    useOllama, ollamaHost, chatModel, extractModel, ocrModel, embedModel,
    chatModelPath, embedModelDir, vectorDb, lancedbPath,
    vllmBaseUrl, vllmApiKey, vllmDefaultModel,
    llamaCppBaseUrl, llamaCppApiKey, llamaCppDefaultModel,
    extractionStrategy, layoutSidecarUrl, cloudExtraction,
    enableGliner, glinerSidecarUrl, glinerModel, glinerThreshold, glinerLabels,
    enableNativeExtraction, enableDocling, enablePageLevelOcr,
    minNativeTextPerPage, minExtractionConfidence, requireReviewBelowConfidence,
  };

  const backend = internetLlm ? `Cloud (${internetLlm})` : useOllama ? `Ollama (${ollamaHost})` : "Local (GGUF)";
  const effectiveChat = internetLlm ? (internetLlmModel ?? CLOUD_DEFAULT_MODELS[internetLlm]) : chatModel;
  const effectiveEmbed = useOllama ? embedModel : embedModelDirName;

  console.log(`\n┌─ AI Models ──────────────────────────────────────`);
  console.log(`│  Backend : ${backend}`);
  console.log(`│  Chat    : ${effectiveChat}`);
  console.log(`│  Extract : ${extractModel}`);
  console.log(`│  OCR     : ${ocrModel ?? `${extractModel} (fallback)`}`);
  console.log(`│  Embed   : ${effectiveEmbed}`);
  console.log(`│  VectorDB: ${vectorDb}${vectorDb === "lancedb" ? ` → ${lancedbPath}` : vectorDb === "pgvector" ? " → Postgres" : ""}`);
  if (vllmBaseUrl) console.log(`│  vLLM    : ${vllmBaseUrl}${vllmDefaultModel ? ` (default: ${vllmDefaultModel})` : ""}`);
  if (llamaCppBaseUrl) console.log(`│  llama.cpp: ${llamaCppBaseUrl}${llamaCppDefaultModel ? ` (default: ${llamaCppDefaultModel})` : ""}`);
  console.log(`│  Extract : strategy=${extractionStrategy}${extractionStrategy !== "llm" ? ` · sidecar=${layoutSidecarUrl}` : ""}`);
  if (enableGliner) console.log(`│  NER     : GLiNER on · ${glinerModel} · ${glinerSidecarUrl}`);
  console.log(`└──────────────────────────────────────────────────\n`);

  return cached;
}

export function getDisplayModelName(purpose: "chat" | "extract" | "ocr" | "embed" = "chat"): string {
  const config = loadAIConfig();
  if (config.internetLlm) {
    return config.internetLlmModel ?? CLOUD_DEFAULT_MODELS[config.internetLlm];
  }
  if (config.useOllama) {
    if (purpose === "embed") return config.embedModel;
    if (purpose === "extract") return config.extractModel;
    if (purpose === "ocr") return config.ocrModel ?? config.extractModel;
    return config.chatModel;
  }
  const filename = process.env.CHAT_MODEL_FILE ?? "google_gemma-3-4b-it-Q4_K_M.gguf";
  return filename.replace(/\.gguf$/i, "").replace(/^(?:google|meta|mistral|microsoft)_/i, "").replace(/_Q\d+_K(?:_[A-Z]+)?$/i, "");
}
