// Pure trend analysis functions — no server dependencies.
// Safe to import from both client and server code.

export type TrendStatus =
  | "improving"
  | "worsening"
  | "stable"
  | "insufficient_data";

export interface TrendDataPoint {
  observedValueNumeric: number | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  isOutOfRange: boolean;
}

export interface TrendResult {
  status: TrendStatus;
  reason: string;
  latestValue: number;
  previousValue: number | null;
  isOutOfRange: boolean;
  distanceDelta: number | null;
}

/**
 * Computes the distance from a value to the normal reference range.
 * Returns 0 if in range, positive distance if out, null if no range available.
 */
export function distanceToNormal(
  value: number,
  low: number | null,
  high: number | null
): number | null {
  if (low === null && high === null) return null;

  if (low !== null && high !== null) {
    if (value < low) return low - value;
    if (value > high) return value - high;
    return 0;
  }

  if (low !== null) {
    return value < low ? low - value : 0;
  }

  // high !== null
  return value > high! ? value - high! : 0;
}

/**
 * Computes the trend status from a chronologically-ordered array of data points.
 * Points should be ordered oldest-first. The last two numeric points are compared.
 *
 * @param points - Array of data points in chronological order (oldest first)
 * @param threshold - Relative change threshold below which delta is considered stable (default 0.05 = 5%)
 */
export function computeTrend(
  points: TrendDataPoint[],
  threshold: number = 0.05
): TrendResult | null {
  // Filter to numeric-only points
  const numeric = points.filter(
    (p): p is TrendDataPoint & { observedValueNumeric: number } =>
      p.observedValueNumeric !== null
  );

  if (numeric.length === 0) return null;

  if (numeric.length < 2) {
    return {
      status: "insufficient_data",
      reason: "Only one data point available",
      latestValue: numeric[0].observedValueNumeric,
      previousValue: null,
      isOutOfRange: numeric[0].isOutOfRange,
      distanceDelta: null,
    };
  }

  const latest = numeric[numeric.length - 1];
  const previous = numeric[numeric.length - 2];

  const latestDist = distanceToNormal(
    latest.observedValueNumeric,
    latest.referenceLow,
    latest.referenceHigh
  );
  const previousDist = distanceToNormal(
    previous.observedValueNumeric,
    previous.referenceLow,
    previous.referenceHigh
  );

  // If either distance is null (no reference range), we can't assess trend direction
  if (latestDist === null || previousDist === null) {
    return {
      status: "stable",
      reason: "No reference range available",
      latestValue: latest.observedValueNumeric,
      previousValue: previous.observedValueNumeric,
      isOutOfRange: latest.isOutOfRange,
      distanceDelta: null,
    };
  }

  // Boundary crossings
  const wasOut = previousDist > 0;
  const isOut = latestDist > 0;

  if (wasOut && !isOut) {
    return {
      status: "improving",
      reason: "Moved into normal range",
      latestValue: latest.observedValueNumeric,
      previousValue: previous.observedValueNumeric,
      isOutOfRange: false,
      distanceDelta: latestDist - previousDist,
    };
  }

  if (!wasOut && isOut) {
    return {
      status: "worsening",
      reason: "Moved out of normal range",
      latestValue: latest.observedValueNumeric,
      previousValue: previous.observedValueNumeric,
      isOutOfRange: true,
      distanceDelta: latestDist - previousDist,
    };
  }

  // Both in range or both out of range — check delta
  const delta = latestDist - previousDist;
  const maxDist = Math.max(previousDist, latestDist, 1); // avoid div-by-zero
  const relativeChange = Math.abs(delta) / maxDist;

  if (relativeChange < threshold) {
    return {
      status: "stable",
      reason: "Change within threshold",
      latestValue: latest.observedValueNumeric,
      previousValue: previous.observedValueNumeric,
      isOutOfRange: latest.isOutOfRange,
      distanceDelta: delta,
    };
  }

  if (delta < 0) {
    return {
      status: "improving",
      reason: "Moving closer to normal range",
      latestValue: latest.observedValueNumeric,
      previousValue: previous.observedValueNumeric,
      isOutOfRange: latest.isOutOfRange,
      distanceDelta: delta,
    };
  }

  return {
    status: "worsening",
    reason: "Moving further from normal range",
    latestValue: latest.observedValueNumeric,
    previousValue: previous.observedValueNumeric,
    isOutOfRange: latest.isOutOfRange,
    distanceDelta: delta,
  };
}
