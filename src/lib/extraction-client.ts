/**
 * Client-safe extraction utilities.
 * Pure functions only — no server dependencies (prisma, pdf-parse, etc.).
 */

// ─── Operator parsing ────────────────────────────────────────────────────────

export function parseOperator(valueStr: string): {
  operator: "LT" | "GT" | "EQ" | "APPROX" | null;
  numeric: number | null;
} {
  const trimmed = valueStr.trim();

  if (trimmed.startsWith("<")) {
    const num = parseFloat(trimmed.slice(1).trim());
    return { operator: "LT", numeric: isNaN(num) ? null : num };
  }
  if (trimmed.startsWith(">")) {
    const num = parseFloat(trimmed.slice(1).trim());
    return { operator: "GT", numeric: isNaN(num) ? null : num };
  }
  if (trimmed.startsWith("~") || trimmed.startsWith("≈")) {
    const num = parseFloat(trimmed.slice(1).trim());
    return { operator: "APPROX", numeric: isNaN(num) ? null : num };
  }

  const num = parseFloat(trimmed);
  if (!isNaN(num)) {
    return { operator: "EQ", numeric: num };
  }

  return { operator: null, numeric: null };
}

// ─── Reference range parsing ─────────────────────────────────────────────────

/**
 * Try to parse a simple reference range from a single line/string.
 * Handles: "4.0-6.0", "< 200", "> 1.5", ">=126", "<=0.2",
 * and ranges with trailing units like "60-180 μg/dL".
 */
function parseSimpleRange(s: string): { low: number | null; high: number | null } | null {
  const t = s.trim();
  if (!t) return null;

  // Match "<= 0.2" or "<=0.2"
  const leMatch = t.match(/^<=?\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (leMatch && t.match(/^<=/)) {
    return { low: null, high: parseFloat(leMatch[1]) };
  }

  // Match ">= 126" or ">=126"
  const geMatch = t.match(/^>=?\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (geMatch && t.match(/^>=/)) {
    return { low: parseFloat(geMatch[1]), high: null };
  }

  // Match "< 5.0" or "<5.0" (upper bound only) — no '=' after '<'
  const ltMatch = t.match(/^<\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (ltMatch) {
    return { low: null, high: parseFloat(ltMatch[1]) };
  }

  // Match "> 2.0" or ">2.0" (lower bound only) — no '=' after '>'
  const gtMatch = t.match(/^>\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (gtMatch) {
    return { low: parseFloat(gtMatch[1]), high: null };
  }

  // Match "4.0 - 6.0", "4.0–6.0", "4.0 to 6.0", with optional trailing units
  const rangeMatch = t.match(
    /^(\d+(?:\.\d+)?)\s*[-–—]+\s*(\d+(?:\.\d+)?)/
  );
  if (rangeMatch) {
    return { low: parseFloat(rangeMatch[1]), high: parseFloat(rangeMatch[2]) };
  }

  // Match "4.0 to 6.0" with optional trailing units
  const toMatch = t.match(
    /^(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i
  );
  if (toMatch) {
    return { low: parseFloat(toMatch[1]), high: parseFloat(toMatch[2]) };
  }

  return null;
}

/**
 * From a multiline category string, find the "normal" / "desirable" /
 * "optimal" / "sufficiency" labeled line and parse its range.
 * If not found, returns the widest range across all lines.
 */
function parseCategoryRange(lines: string[]): { low: number | null; high: number | null } | null {
  // Priority labels indicating the "normal" range — order matters
  const normalLabels = /\b(normal|sufficiency|sufficient|desirable|optimal|acceptable|recommended)\b/i;

  // Try to find the normal/preferred line
  for (const line of lines) {
    if (normalLabels.test(line)) {
      // Strip the label prefix (e.g. "Normal:" or "Normal :")
      const afterLabel = line.replace(/^[^:<>]*[:\s]\s*/, "");
      const parsed = parseSimpleRange(afterLabel);
      if (parsed && (parsed.low !== null || parsed.high !== null)) return parsed;
    }
  }

  // No "normal" label found — collect all parseable ranges and return the widest
  const ranges: { low: number | null; high: number | null }[] = [];
  for (const line of lines) {
    const afterLabel = line.replace(/^[^:<>]*[:\s]\s*/, "");
    const parsed = parseSimpleRange(afterLabel);
    if (parsed && (parsed.low !== null || parsed.high !== null)) {
      ranges.push(parsed);
    }
  }

  if (ranges.length === 0) return null;

  // Return widest: lowest low, highest high
  let widestLow: number | null = null;
  let widestHigh: number | null = null;
  for (const r of ranges) {
    if (r.low !== null && (widestLow === null || r.low < widestLow)) widestLow = r.low;
    if (r.high !== null && (widestHigh === null || r.high > widestHigh)) widestHigh = r.high;
  }
  return { low: widestLow, high: widestHigh };
}

export function parseReferenceRange(rangeStr: string): {
  low: number | null;
  high: number | null;
} {
  if (!rangeStr || !rangeStr.trim()) {
    return { low: null, high: null };
  }

  const trimmed = rangeStr.trim();

  // Check for multiline/category ranges (contains newlines or multiple label:value pairs)
  let lines = trimmed.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  // Also split single-line category ranges separated by ; or |
  if (lines.length === 1 && /[;|]/.test(lines[0])) {
    lines = lines[0].split(/[;|]/).map((l) => l.trim()).filter(Boolean);
  }

  // Also detect single-line with multiple "Label:value" pairs (e.g. "Normal:<5.7 Prediabetes:5.7-6.4")
  if (lines.length === 1) {
    const labelPairs = lines[0].match(/[A-Za-z][\w\s]*:\s*[<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?/g);
    if (labelPairs && labelPairs.length > 1) {
      lines = labelPairs.map((l) => l.trim());
    }
  }

  if (lines.length > 1) {
    const catResult = parseCategoryRange(lines);
    if (catResult) return catResult;
  }

  // Single-line: strip text prefix like "Desirable:" or "Normal:"
  const stripped = trimmed.replace(/^[A-Za-z][A-Za-z\s]*:\s*/, "");

  // Try simple range parse
  const simple = parseSimpleRange(stripped);
  if (simple) return simple;

  // Fallback: try on the raw trimmed input (in case prefix strip was wrong)
  const fallback = parseSimpleRange(trimmed);
  if (fallback) return fallback;

  return { low: null, high: null };
}

// ─── Interpretation logic ────────────────────────────────────────────────────

export function computeInterpretation(
  numeric: number | null,
  operator: "LT" | "GT" | "EQ" | "APPROX" | null,
  low: number | null,
  high: number | null,
  labFlag: string | null,
  /** Raw observed value string (for qualitative matching) */
  rawValue?: string | null,
  /** Raw reference interval string (for qualitative matching) */
  rawReference?: string | null
): { interpretation: "LOW" | "NORMAL" | "HIGH" | "UNKNOWN"; isOutOfRange: boolean } {
  // Priority 0: Qualitative value matching (Negative/Negative, Non-Reactive/Non-Reactive, etc.)
  if (numeric === null && rawValue && rawReference) {
    // Strip dots, extra spaces, and hyphens to normalize variants like "Non. Reactive", "Non-Reactive", "Non Reactive"
    const normalize = (s: string) => s.trim().toUpperCase().replace(/[.\-]/g, " ").replace(/\s+/g, " ").trim();
    const val = normalize(rawValue);
    const ref = normalize(rawReference);

    const NEGATIVE_TERMS = ["NEGATIVE", "NON REACTIVE", "NONREACTIVE", "NOT DETECTED", "NIL", "ABSENT"];
    const POSITIVE_TERMS = ["POSITIVE", "REACTIVE", "DETECTED", "PRESENT"];

    const valIsNegative = NEGATIVE_TERMS.some((t) => val === t);
    const refIsNegative = NEGATIVE_TERMS.some((t) => ref === t || ref.includes(t));
    const valIsPositive = POSITIVE_TERMS.some((t) => val === t);
    const refIsPositive = POSITIVE_TERMS.some((t) => ref === t || ref.includes(t));

    if (valIsNegative && refIsNegative) {
      return { interpretation: "NORMAL", isOutOfRange: false };
    }
    if (valIsPositive && refIsPositive) {
      return { interpretation: "NORMAL", isOutOfRange: false };
    }
    if (valIsPositive && refIsNegative) {
      return { interpretation: "HIGH", isOutOfRange: true };
    }
    if (valIsNegative && refIsPositive) {
      return { interpretation: "LOW", isOutOfRange: true };
    }
  }

  // Priority 1: Lab's own flag
  const flag = labFlag?.trim().toUpperCase();
  if (flag === "H" || flag === "HIGH") {
    return { interpretation: "HIGH", isOutOfRange: true };
  }
  if (flag === "L" || flag === "LOW") {
    return { interpretation: "LOW", isOutOfRange: true };
  }
  if (flag === "N" || flag === "NORMAL") {
    return { interpretation: "NORMAL", isOutOfRange: false };
  }

  // Priority 2: Numeric comparison against reference range
  if (numeric !== null && (low !== null || high !== null)) {
    if (operator === "LT") {
      if (low !== null && numeric <= low) {
        return { interpretation: "LOW", isOutOfRange: true };
      }
      return { interpretation: "UNKNOWN", isOutOfRange: false };
    }

    if (operator === "GT") {
      if (high !== null && numeric >= high) {
        return { interpretation: "HIGH", isOutOfRange: true };
      }
      return { interpretation: "UNKNOWN", isOutOfRange: false };
    }

    // EQ or APPROX — direct comparison
    if (low !== null && numeric < low) {
      return { interpretation: "LOW", isOutOfRange: true };
    }
    if (high !== null && numeric > high) {
      return { interpretation: "HIGH", isOutOfRange: true };
    }
    if (low !== null || high !== null) {
      return { interpretation: "NORMAL", isOutOfRange: false };
    }
  }

  return { interpretation: "UNKNOWN", isOutOfRange: false };
}
