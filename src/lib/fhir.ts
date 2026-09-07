/**
 * FHIR R4 export — turns a stored Report + its TestResults into a FHIR
 * `Bundle` (type: collection) of Patient + DiagnosticReport + Observation
 * resources, using LOINC codes (Observation.code) and UCUM units
 * (valueQuantity). This is the standards-based interchange format discussed
 * for ABDM/hospital/insurer exchange.
 *
 * Data exchange only — codes and values are copied from the extraction; this
 * is not a clinical interpretation. Server-only (Prisma).
 */

import { prisma } from "@/lib/prisma";

const LOINC_SYSTEM = "http://loinc.org";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const INTERP_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";
const OBS_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

// Minimal FHIR shapes — enough for a valid, consumable R4 bundle.
type FhirResource = Record<string, unknown>;
type BundleEntry = { fullUrl: string; resource: FhirResource };
export type FhirBundle = {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  entry: BundleEntry[];
};

function interpCoding(interp: string): FhirResource[] | undefined {
  const map: Record<string, { code: string; display: string }> = {
    HIGH: { code: "H", display: "High" },
    LOW: { code: "L", display: "Low" },
    NORMAL: { code: "N", display: "Normal" },
  };
  const m = map[interp];
  if (!m) return undefined;
  return [{ coding: [{ system: INTERP_SYSTEM, code: m.code, display: m.display }] }];
}

/** Build the FHIR R4 collection bundle for one report. Throws if not found. */
export async function buildReportFhirBundle(reportId: string): Promise<FhirBundle> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true, sampleCollectedOn: true, createdAt: true, referredBy: true, sampleType: true,
      user: { select: { id: true, name: true } },
      testResults: {
        select: {
          id: true, normalizedName: true, loincNum: true,
          observedValueRaw: true, observedValueNumeric: true, observedValueUnit: true,
          referenceLow: true, referenceHigh: true, referenceUnit: true,
          interpretation: true,
        },
      },
    },
  });
  if (!report) throw new Error(`Report ${reportId} not found`);

  const effective = (report.sampleCollectedOn ?? report.createdAt).toISOString();
  const patientRef = `Patient/${report.user.id}`;

  const patient: BundleEntry = {
    fullUrl: patientRef,
    resource: {
      resourceType: "Patient",
      id: report.user.id,
      name: report.user.name ? [{ text: report.user.name }] : undefined,
    },
  };

  const observations: BundleEntry[] = report.testResults.map((t) => {
    const resource: FhirResource = {
      resourceType: "Observation",
      id: t.id,
      status: "final",
      category: [{ coding: [{ system: OBS_CATEGORY_SYSTEM, code: "laboratory", display: "Laboratory" }] }],
      code: {
        // LOINC coding when available; always keep the human text as fallback.
        coding: t.loincNum ? [{ system: LOINC_SYSTEM, code: t.loincNum, display: t.normalizedName }] : undefined,
        text: t.normalizedName,
      },
      subject: { reference: patientRef },
      effectiveDateTime: effective,
    };

    // Value: quantity (numeric + UCUM unit) when we have a number, else string.
    if (t.observedValueNumeric !== null) {
      resource.valueQuantity = {
        value: t.observedValueNumeric,
        unit: t.observedValueUnit ?? undefined,
        system: t.observedValueUnit ? UCUM_SYSTEM : undefined,
        code: t.observedValueUnit ?? undefined,
      };
    } else {
      resource.valueString = t.observedValueRaw;
    }

    const interp = interpCoding(t.interpretation);
    if (interp) resource.interpretation = interp;

    if (t.referenceLow !== null || t.referenceHigh !== null) {
      const unit = t.referenceUnit ?? t.observedValueUnit ?? undefined;
      resource.referenceRange = [{
        low: t.referenceLow !== null ? { value: t.referenceLow, unit, system: unit ? UCUM_SYSTEM : undefined, code: unit } : undefined,
        high: t.referenceHigh !== null ? { value: t.referenceHigh, unit, system: unit ? UCUM_SYSTEM : undefined, code: unit } : undefined,
      }];
    }
    return { fullUrl: `Observation/${t.id}`, resource };
  });

  const diagnosticReport: BundleEntry = {
    fullUrl: `DiagnosticReport/${report.id}`,
    resource: {
      resourceType: "DiagnosticReport",
      id: report.id,
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB", display: "Laboratory" }] }],
      code: { coding: [{ system: LOINC_SYSTEM, code: "11502-2", display: "Laboratory report" }], text: report.sampleType ? `Laboratory report (${report.sampleType})` : "Laboratory report" },
      subject: { reference: patientRef },
      effectiveDateTime: effective,
      issued: report.createdAt.toISOString(),
      performer: report.referredBy ? [{ display: report.referredBy }] : undefined,
      result: observations.map((o) => ({ reference: o.fullUrl })),
    },
  };

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: [patient, diagnosticReport, ...observations],
  };
}
