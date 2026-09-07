// Stub — validation engine (simplified for phr2)

export type ValidationStatus = "valid" | "suspicious" | "invalid" | "needs_review";

export type ValidationIssue = { code: string; message: string; severity: "warning" | "error" };

export type ValidationResult = {
  status: ValidationStatus;
  issues: ValidationIssue[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateTestResult(_test: any): ValidationResult {
  return { status: "valid", issues: [] };
}
