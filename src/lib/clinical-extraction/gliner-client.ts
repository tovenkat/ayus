/**
 * Node client for the GLiNER-BioMed NER sidecar (scripts/gliner-sidecar/).
 *
 * Opt-in and graceful: when ENABLE_GLINER is false or the sidecar is
 * unreachable, every call returns an empty result rather than throwing — so
 * wiring this into a pipeline never breaks the flow when the sidecar is off.
 *
 * For lab-test / biomarker spans it also runs the existing LOINC resolver, so
 * the caller gets coded entities (span → canonical → LOINC) in one step.
 *
 * Server-only. Narrative clinical text only — not the tabular lab flow.
 */

import { loadAIConfig } from "@/lib/ai/config";
import { findLoincForTestName } from "@/lib/loinc";
import { resolveBiomarker } from "@/lib/biomarker-resolver";

export type BioEntity = {
  text: string;
  label: string;
  score: number;
  start: number;
  end: number;
};

export type CodedBioEntity = BioEntity & {
  loincNum: string | null;
  canonicalName: string | null;
};

const HEALTH_TIMEOUT_MS = 1500;
const NER_TIMEOUT_MS = 30_000;

export function isGlinerEnabled(): boolean {
  return loadAIConfig().enableGliner;
}

async function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null; // network error / abort — treated as "unavailable"
  } finally {
    clearTimeout(timer);
  }
}

/** True when the sidecar is enabled AND its /health reports the model ready. */
export async function isGlinerReachable(): Promise<boolean> {
  const cfg = loadAIConfig();
  if (!cfg.enableGliner) return false;
  const res = await timedFetch(`${cfg.glinerSidecarUrl}/health`, { method: "GET" }, HEALTH_TIMEOUT_MS);
  if (!res || !res.ok) return false;
  try {
    const body = (await res.json()) as { ready?: boolean };
    return body.ready === true;
  } catch {
    return false;
  }
}

/**
 * Extract biomedical entity spans from unstructured text. Returns [] when the
 * sidecar is disabled or unreachable (never throws for those cases).
 */
export async function extractBioEntities(
  text: string,
  opts: { labels?: string[]; threshold?: number } = {},
): Promise<BioEntity[]> {
  const cfg = loadAIConfig();
  if (!cfg.enableGliner || !text.trim()) return [];

  const res = await timedFetch(
    `${cfg.glinerSidecarUrl}/ner`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        labels: opts.labels ?? cfg.glinerLabels,
        threshold: opts.threshold ?? cfg.glinerThreshold,
      }),
    },
    NER_TIMEOUT_MS,
  );
  if (!res || !res.ok) {
    console.warn(`[gliner] sidecar unavailable at ${cfg.glinerSidecarUrl} — skipping NER`);
    return [];
  }
  try {
    const body = (await res.json()) as { entities?: BioEntity[] };
    return body.entities ?? [];
  } catch {
    return [];
  }
}

const CODEABLE_LABELS = /lab test|biomarker|measurement/i;

const QUALIFIER_RE = /[\s,]+(?:very\s+)?(?:high|low|normal|elevated|raised|reduced|decreased|increased|positive|negative|non[- ]?reactive|reactive|borderline|abnormal|deranged|significantly?)\.?$/i;
// A trailing measurement: optional operator + number + optional unit token
// (e.g. "95 U/L", "9.2%", "180 mg/dL", "6.8", "1.5 mg/dL").
const MEASUREMENT_RE = /[\s:=]+[<>≈~]?\s*\d[\d.,]*\s*(?:%|[a-zA-Zµμ][a-zA-Zµμ0-9/^.·-]*)?\s*$/;

/**
 * Strip a trailing value/unit/qualifier that GLiNER often includes in a span,
 * so "SGPT 95 U/L" and "fasting blood sugar high" resolve to a test name.
 * Exported for testing.
 */
export function cleanLabSpan(s: string): string {
  let t = s.trim();
  t = t.replace(QUALIFIER_RE, "").trim();
  t = t.replace(MEASUREMENT_RE, "").trim();
  return t;
}

/** Resolve a span to LOINC + canonical, trying the cleaned name then the raw. */
async function codeName(raw: string): Promise<{ loincNum: string | null; canonicalName: string | null }> {
  const cleaned = cleanLabSpan(raw);
  let [loinc, canonical] = await Promise.all([findLoincForTestName(cleaned), resolveBiomarker(cleaned)]);
  if (!loinc && !canonical && cleaned !== raw) {
    [loinc, canonical] = await Promise.all([findLoincForTestName(raw), resolveBiomarker(raw)]);
  }
  return { loincNum: loinc?.loincNum ?? null, canonicalName: canonical?.canonicalName ?? null };
}

/**
 * Extract entities and, for the lab-test/biomarker ones, resolve them to a
 * canonical test + LOINC via the existing resolver (after span cleanup).
 * Non-lab entities (disease, medication, …) pass through with null codes.
 */
export async function extractCodedBioEntities(
  text: string,
  opts: { labels?: string[]; threshold?: number } = {},
): Promise<CodedBioEntity[]> {
  const entities = await extractBioEntities(text, opts);
  return Promise.all(
    entities.map(async (e): Promise<CodedBioEntity> => {
      if (!CODEABLE_LABELS.test(e.label)) {
        return { ...e, loincNum: null, canonicalName: null };
      }
      const coded = await codeName(e.text);
      return { ...e, ...coded };
    }),
  );
}
