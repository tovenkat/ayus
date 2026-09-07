// Stub — test name standardization (simplified for phr2)

const synonymMap = new Map<string, string>();

export function loadSynonymMap(): Map<string, string> {
  return synonymMap;
}

export async function standardizeTestName(
  rawName: string,
  llmNormalized?: string
): Promise<{ canonicalName: string; confidence: number; matchType: string }> {
  const name = llmNormalized ?? rawName;
  const canonical = synonymMap.get(name.toLowerCase());
  if (canonical) {
    return { canonicalName: canonical, confidence: 1.0, matchType: "exact" };
  }
  return { canonicalName: name, confidence: 0.5, matchType: "passthrough" };
}

export async function registerSynonym(alias: string, canonical: string): Promise<void> {
  synonymMap.set(alias.toLowerCase(), canonical);
}

export async function aiStandardizeUnmatched(_names: unknown, _provider?: unknown): Promise<void> {
  // no-op in phr2
}
