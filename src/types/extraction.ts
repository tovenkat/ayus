export type PreviewTestRow = {
  id: string;
  rawTestName: string;
  normalizedName: string;
  observedValueRaw: string;
  observedValueNumeric: number | null;
  observedValueOperator: "LT" | "GT" | "EQ" | "APPROX" | null;
  observedValueUnit: string;
  referenceIntervalRaw: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  interpretation: "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";
  isOutOfRange: boolean;
  confidence: number;
};

export type ExtractionData = {
  sampleCollectedOn: string;
  referredBy: string;
  sampleType: string;
  confidence: number;
  tests: PreviewTestRow[];
};
