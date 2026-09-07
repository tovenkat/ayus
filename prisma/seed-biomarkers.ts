/**
 * Seed the canonical biomarker + organ-system tables.
 *
 * Idempotent — safe to re-run. Upserts by natural keys (canonical name,
 * organ key, synonym rawName). Doesn't touch TestResult rows.
 *
 * Run: npm run biomarkers:seed
 *
 * Coverage: ~55 canonical tests covering the biomarkers on a typical Indian
 * lab panel (CBC, LFT, KFT, lipid, thyroid, glucose, urinalysis, cardiac).
 * Not exhaustive — add more as your extraction pipeline surfaces gaps.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// ─── Organs ────────────────────────────────────────────────────────────────
const ORGANS: Array<{ key: string; name: string; icon: string; svgRegionId: string }> = [
  { key: "kidney",       name: "Kidney",                icon: "Droplets", svgRegionId: "kidney" },
  { key: "liver",        name: "Liver",                 icon: "Leaf",     svgRegionId: "liver" },
  { key: "thyroid",      name: "Thyroid",               icon: "Zap",      svgRegionId: "thyroid" },
  { key: "heart",        name: "Heart",                 icon: "Heart",    svgRegionId: "heart" },
  { key: "pancreas",     name: "Pancreas",              icon: "Activity", svgRegionId: "pancreas" },
  { key: "metabolic",    name: "Metabolic / Pancreas",  icon: "Activity", svgRegionId: "pancreas" }, // legacy — pre-existing biomarker maps point here
  { key: "lipid",        name: "Lipids",                icon: "Droplet",  svgRegionId: "vessels" },
  { key: "blood",        name: "Blood (Hematology)",    icon: "TestTube", svgRegionId: "marrow" },
  { key: "bone",         name: "Bone",                  icon: "Bone",     svgRegionId: "skeleton" },
  { key: "immune",       name: "Immune System",         icon: "Shield",   svgRegionId: "lymph" },
  { key: "urinary",      name: "Urinary",               icon: "Cup",      svgRegionId: "bladder" },
  { key: "electro",      name: "Electrolytes",          icon: "Waves",    svgRegionId: "vessels" },
  { key: "vitamins",     name: "Vitamins & Nutrition",  icon: "Apple",    svgRegionId: "digestive" },
  { key: "hormones",     name: "Hormones",              icon: "Atom",     svgRegionId: "endocrine" },
  { key: "inflammation", name: "Inflammation",          icon: "Flame",    svgRegionId: "systemic" },
  { key: "coagulation",  name: "Coagulation",           icon: "Blend",    svgRegionId: "vessels" },
];

// ─── Canonical tests + synonyms + organ mapping ────────────────────────────
type Canon = {
  name: string;
  category: string;
  synonyms: string[];
  organs: string[];    // organ.key values
  loinc?: string;      // LOINC code (from Regenstrief) — nullable per canonical
  specimen?: string;   // LOINC SYSTEM shorthand: "Ser/Plas" | "Bld" | "Ur" | ...
  min?: number;        // plausibility lower bound (permissive)
  max?: number;        // plausibility upper bound (permissive)
  unit?: string;       // canonical unit in Indian labs
};

// LOINC codes: canonical Ser/Plas variant for chemistry, urine dipstick codes
// for urinalysis, blood (CBC) for hematology. Where multiple LOINCs exist for
// the same test (e.g. LDL calc vs direct), the most common in Indian labs is
// chosen. All codes verified against LOINC v2.82 (March 2026 release).
// specimen values mirror LOINC's SYSTEM shorthand:
//   "Ser/Plas" — Serum or Plasma        "Bld"   — Whole Blood (CBC)
//   "Ur"       — Urine                   "Bld.a" — Arterial blood
// Calculated ratios (e.g. eGFR, A/G Ratio) get null.
const CANONICALS: Canon[] = [
  // Kidney
  { name: "Creatinine",           category: "chemistry",  synonyms: ["Creat", "Cr", "Serum Creatinine", "S. Creatinine"],       organs: ["kidney"],            loinc: "2160-0",    specimen: "Ser/Plas" },
  { name: "Urea",                 category: "chemistry",  synonyms: ["BUN", "Blood Urea Nitrogen", "Blood Urea"],                organs: ["kidney"],            loinc: "3094-0",    specimen: "Ser/Plas" },
  { name: "Uric Acid",            category: "chemistry",  synonyms: ["S. Uric Acid", "Serum Uric Acid"],                        organs: ["kidney"],            loinc: "3084-1",    specimen: "Ser/Plas" },
  { name: "eGFR",                 category: "chemistry",  synonyms: ["Estimated GFR", "Glomerular Filtration Rate"],             organs: ["kidney"],            loinc: "33914-3"    /* calculated */ },
  { name: "Urine Albumin",        category: "urinalysis", synonyms: ["Microalbumin", "Albumin (Urine)"],                        organs: ["kidney", "urinary"], loinc: "14957-5",   specimen: "Ur" },

  // Liver
  { name: "ALT",                  category: "chemistry",  synonyms: ["SGPT", "Alanine Aminotransferase"],                        organs: ["liver"],             loinc: "1742-6",    specimen: "Ser/Plas" },
  { name: "AST",                  category: "chemistry",  synonyms: ["SGOT", "Aspartate Aminotransferase"],                      organs: ["liver"],             loinc: "1920-8",    specimen: "Ser/Plas" },
  { name: "ALP",                  category: "chemistry",  synonyms: ["Alkaline Phosphatase", "Alk Phos"],                        organs: ["liver", "bone"],     loinc: "6768-6",    specimen: "Ser/Plas" },
  { name: "GGT",                  category: "chemistry",  synonyms: ["Gamma GT", "Gamma Glutamyl Transferase"],                  organs: ["liver"],             loinc: "2324-2",    specimen: "Ser/Plas" },
  { name: "Total Bilirubin",      category: "chemistry",  synonyms: ["Bilirubin Total", "T. Bilirubin"],                         organs: ["liver"],             loinc: "1975-2",    specimen: "Ser/Plas" },
  { name: "Direct Bilirubin",     category: "chemistry",  synonyms: ["Bilirubin Direct", "Conjugated Bilirubin"],                organs: ["liver"],             loinc: "1968-7",    specimen: "Ser/Plas" },
  { name: "Indirect Bilirubin",   category: "chemistry",  synonyms: ["Bilirubin Indirect", "Unconjugated Bilirubin"],            organs: ["liver"],             loinc: "1971-1",    specimen: "Ser/Plas" },
  { name: "Albumin",              category: "chemistry",  synonyms: ["S. Albumin", "Serum Albumin"],                             organs: ["liver"],             loinc: "1751-7",    specimen: "Ser/Plas" },
  { name: "Total Protein",        category: "chemistry",  synonyms: ["Protein Total", "T. Protein"],                             organs: ["liver"],             loinc: "2885-2",    specimen: "Ser/Plas" },
  { name: "Globulin",             category: "chemistry",  synonyms: ["S. Globulin"],                                             organs: ["liver"],             loinc: "2336-6",    specimen: "Ser/Plas" },
  { name: "A/G Ratio",            category: "chemistry",  synonyms: ["Albumin Globulin Ratio"],                                  organs: ["liver"],             loinc: "1759-0"     /* calculated */ },

  // Thyroid (thyroid hormones are also hormones — dual mapping)
  { name: "TSH",                  category: "endocrine",  synonyms: ["Thyroid Stimulating Hormone"],                             organs: ["thyroid", "hormones"], loinc: "3016-3",    specimen: "Ser/Plas" },
  { name: "Free T3",              category: "endocrine",  synonyms: ["FT3", "Free Triiodothyronine"],                            organs: ["thyroid", "hormones"], loinc: "3051-0",    specimen: "Ser/Plas" },
  { name: "Free T4",              category: "endocrine",  synonyms: ["FT4", "Free Thyroxine"],                                   organs: ["thyroid", "hormones"], loinc: "3024-7",    specimen: "Ser/Plas" },
  { name: "Total T3",             category: "endocrine",  synonyms: ["T3", "Triiodothyronine"],                                  organs: ["thyroid", "hormones"], loinc: "3053-6",    specimen: "Ser/Plas" },
  { name: "Total T4",             category: "endocrine",  synonyms: ["T4", "Thyroxine"],                                         organs: ["thyroid", "hormones"], loinc: "3026-2",    specimen: "Ser/Plas" },

  // Metabolic / Pancreas (glucose panel also maps to pancreas)
  { name: "Fasting Glucose",      category: "chemistry",  synonyms: ["FBS", "Fasting Blood Sugar", "Glucose Fasting"],           organs: ["metabolic", "pancreas"], loinc: "1558-6",    specimen: "Ser/Plas" },
  { name: "Postprandial Glucose", category: "chemistry",  synonyms: ["PPBS", "Postprandial Blood Sugar", "PP Glucose"],          organs: ["metabolic", "pancreas"], loinc: "6749-6",    specimen: "Ser/Plas" },
  { name: "Random Glucose",       category: "chemistry",  synonyms: ["RBS", "Random Blood Sugar"],                               organs: ["metabolic", "pancreas"], loinc: "2345-7",    specimen: "Ser/Plas" },
  { name: "HbA1c",                category: "chemistry",  synonyms: ["Glycated Haemoglobin", "Glycated Hemoglobin", "A1c"],      organs: ["metabolic", "pancreas"], loinc: "4548-4",    specimen: "Bld" },
  { name: "Insulin",              category: "endocrine",  synonyms: ["Fasting Insulin", "S. Insulin"],                           organs: ["metabolic", "pancreas", "hormones"], loinc: "20448-7",   specimen: "Ser/Plas" },
  { name: "C-Peptide",            category: "endocrine",  synonyms: ["C Peptide"],                                               organs: ["metabolic", "pancreas", "hormones"], loinc: "1986-9",    specimen: "Ser/Plas" },

  // Lipid
  { name: "Total Cholesterol",    category: "lipid",      synonyms: ["Cholesterol Total", "T. Cholesterol"],                     organs: ["lipid", "heart"],    loinc: "2093-3",    specimen: "Ser/Plas" },
  { name: "HDL Cholesterol",      category: "lipid",      synonyms: ["HDL", "HDL-C"],                                            organs: ["lipid", "heart"],    loinc: "2085-9",    specimen: "Ser/Plas" },
  { name: "LDL Cholesterol",      category: "lipid",      synonyms: ["LDL", "LDL-C"],                                            organs: ["lipid", "heart"],    loinc: "13457-7",   specimen: "Ser/Plas" },
  { name: "VLDL",                 category: "lipid",      synonyms: ["VLDL Cholesterol"],                                        organs: ["lipid", "heart"],    loinc: "13458-5",   specimen: "Ser/Plas" },
  { name: "Triglycerides",        category: "lipid",      synonyms: ["TG", "Trig"],                                              organs: ["lipid", "heart"],    loinc: "2571-8",    specimen: "Ser/Plas" },
  { name: "Non-HDL Cholesterol",  category: "lipid",      synonyms: ["Non HDL", "Non-HDL"],                                      organs: ["lipid", "heart"],    loinc: "43396-1",   specimen: "Ser/Plas" },

  // Cardiac
  { name: "Troponin I",           category: "cardiac",    synonyms: ["cTnI", "Trop I"],                                          organs: ["heart"],             loinc: "42757-5",   specimen: "Ser/Plas" },
  { name: "Troponin T",           category: "cardiac",    synonyms: ["cTnT", "Trop T"],                                          organs: ["heart"],             loinc: "6598-7",    specimen: "Ser/Plas" },
  { name: "CK-MB",                category: "cardiac",    synonyms: ["Creatine Kinase MB"],                                      organs: ["heart"],             loinc: "13969-1",   specimen: "Ser/Plas" },
  { name: "BNP",                  category: "cardiac",    synonyms: ["B-type Natriuretic Peptide", "NT-proBNP"],                 organs: ["heart"],             loinc: "30934-4",   specimen: "Ser/Plas" },

  // CBC / Blood (WBC + differentials are also immune-system markers)
  { name: "Hemoglobin",           category: "hematology", synonyms: ["Hb", "Haemoglobin", "HGB"],                                organs: ["blood"],             loinc: "718-7",     specimen: "Bld" },
  { name: "Hematocrit",           category: "hematology", synonyms: ["HCT", "PCV", "Packed Cell Volume"],                        organs: ["blood"],             loinc: "4544-3",    specimen: "Bld" },
  { name: "RBC Count",            category: "hematology", synonyms: ["Red Blood Cell Count", "Red Cell Count"],                  organs: ["blood"],             loinc: "789-8",     specimen: "Bld" },
  { name: "WBC Count",            category: "hematology", synonyms: ["White Blood Cell Count", "TLC", "Total Leukocyte Count"],  organs: ["blood", "immune"],   loinc: "6690-2",    specimen: "Bld" },
  { name: "Platelet Count",       category: "hematology", synonyms: ["Platelets", "PLT"],                                        organs: ["blood", "coagulation"], loinc: "777-3",  specimen: "Bld" },
  { name: "MCV",                  category: "hematology", synonyms: ["Mean Corpuscular Volume"],                                 organs: ["blood"],             loinc: "787-2",     specimen: "Bld" },
  { name: "MCH",                  category: "hematology", synonyms: ["Mean Corpuscular Hemoglobin"],                             organs: ["blood"],             loinc: "785-6",     specimen: "Bld" },
  { name: "MCHC",                 category: "hematology", synonyms: ["Mean Corpuscular Hemoglobin Concentration"],               organs: ["blood"],             loinc: "786-4",     specimen: "Bld" },
  { name: "RDW",                  category: "hematology", synonyms: ["Red cell Distribution Width"],                             organs: ["blood"],             loinc: "788-0",     specimen: "Bld" },
  { name: "Neutrophils",          category: "hematology", synonyms: ["Neut", "Neutrophil %"],                                    organs: ["blood", "immune"],   loinc: "26499-4",   specimen: "Bld" },
  { name: "Lymphocytes",          category: "hematology", synonyms: ["Lymph", "Lymphocyte %"],                                   organs: ["blood", "immune"],   loinc: "26474-7",   specimen: "Bld" },
  { name: "Eosinophils",          category: "hematology", synonyms: ["Eos", "Eosinophil %"],                                     organs: ["blood", "immune"],   loinc: "26449-9",   specimen: "Bld" },
  { name: "Monocytes",            category: "hematology", synonyms: ["Mono", "Monocyte %"],                                      organs: ["blood", "immune"],   loinc: "26484-6",   specimen: "Bld" },
  { name: "Basophils",            category: "hematology", synonyms: ["Baso", "Basophil %"],                                      organs: ["blood", "immune"],   loinc: "26444-0",   specimen: "Bld" },

  // Urinalysis (dipstick)
  { name: "Urine Protein",        category: "urinalysis", synonyms: ["Protein (Urine)", "Proteinuria"],                          organs: ["urinary", "kidney"],    loinc: "5804-0",  specimen: "Ur" },
  { name: "Urine Glucose",        category: "urinalysis", synonyms: ["Glucose (Urine)"],                                         organs: ["urinary", "metabolic"], loinc: "5792-7",  specimen: "Ur" },
  { name: "Urine Ketones",        category: "urinalysis", synonyms: ["Ketones (Urine)"],                                         organs: ["urinary", "metabolic"], loinc: "5797-6",  specimen: "Ur" },
  { name: "Urine Blood",          category: "urinalysis", synonyms: ["Blood (Urine)", "Hematuria"],                              organs: ["urinary"],              loinc: "5794-3",  specimen: "Ur" },
  { name: "Urine Leukocytes",     category: "urinalysis", synonyms: ["Leukocytes (Urine)", "WBC (Urine)"],                       organs: ["urinary"],              loinc: "5799-2",  specimen: "Ur" },
  { name: "Urine Nitrite",        category: "urinalysis", synonyms: ["Nitrite (Urine)"],                                         organs: ["urinary"],              loinc: "5802-4",  specimen: "Ur" },
  { name: "Urine pH",             category: "urinalysis", synonyms: ["pH (Urine)"],                                              organs: ["urinary"],              loinc: "5803-2",  specimen: "Ur" },
  { name: "Urine Specific Gravity", category: "urinalysis", synonyms: ["SG (Urine)", "Specific Gravity"],                        organs: ["urinary"],              loinc: "5811-5",  specimen: "Ur" },

  // Electrolytes (Ca and P also serve as bone markers)
  { name: "Sodium",               category: "chemistry",  synonyms: ["Na", "Na+"],                                               organs: ["electro"],           loinc: "2951-2",    specimen: "Ser/Plas" },
  { name: "Potassium",            category: "chemistry",  synonyms: ["K", "K+"],                                                 organs: ["electro"],           loinc: "2823-3",    specimen: "Ser/Plas" },
  { name: "Chloride",             category: "chemistry",  synonyms: ["Cl", "Cl-"],                                               organs: ["electro"],           loinc: "2075-0",    specimen: "Ser/Plas" },
  { name: "Bicarbonate",          category: "chemistry",  synonyms: ["HCO3", "HCO3-"],                                           organs: ["electro"],           loinc: "1963-8",    specimen: "Ser/Plas" },
  { name: "Calcium",              category: "chemistry",  synonyms: ["Ca", "Total Calcium"],                                     organs: ["electro", "bone"],   loinc: "17861-6",   specimen: "Ser/Plas" },
  { name: "Phosphorus",           category: "chemistry",  synonyms: ["Phosphate", "PO4"],                                        organs: ["electro", "bone"],   loinc: "2777-1",    specimen: "Ser/Plas" },
  { name: "Magnesium",            category: "chemistry",  synonyms: ["Mg", "Mg++"],                                              organs: ["electro"],           loinc: "2601-3",    specimen: "Ser/Plas" },

  // ─── Additions targeting the new organ systems ───────────────────────────

  // Bone
  { name: "Vitamin D",            category: "nutrition",  synonyms: ["25-OH Vitamin D", "25 Hydroxy Vitamin D", "Vitamin D 25 Hydroxy"], organs: ["bone", "vitamins"], loinc: "62292-8",  specimen: "Ser/Plas" },
  { name: "PTH",                  category: "endocrine",  synonyms: ["Parathyroid Hormone", "Intact PTH"],                       organs: ["bone", "hormones"],  loinc: "2731-8",    specimen: "Ser/Plas" },

  // Vitamins & Nutrition
  { name: "Vitamin B12",          category: "nutrition",  synonyms: ["B12", "Cobalamin", "Cyanocobalamin"],                      organs: ["vitamins"],          loinc: "2132-9",    specimen: "Ser/Plas" },
  { name: "Folate",               category: "nutrition",  synonyms: ["Folic Acid", "Serum Folate"],                              organs: ["vitamins"],          loinc: "2284-8",    specimen: "Ser/Plas" },
  { name: "Iron",                 category: "nutrition",  synonyms: ["Serum Iron", "Fe"],                                        organs: ["vitamins"],          loinc: "2498-4",    specimen: "Ser/Plas" },
  { name: "Ferritin",             category: "nutrition",  synonyms: ["S. Ferritin", "Serum Ferritin"],                           organs: ["vitamins", "inflammation"], loinc: "2276-4", specimen: "Ser/Plas" },
  { name: "TIBC",                 category: "nutrition",  synonyms: ["Total Iron Binding Capacity"],                             organs: ["vitamins"],          loinc: "2500-7",    specimen: "Ser/Plas" },
  { name: "Transferrin",          category: "nutrition",  synonyms: ["S. Transferrin"],                                          organs: ["vitamins"],          loinc: "3034-6",    specimen: "Ser/Plas" },

  // Inflammation
  { name: "CRP",                  category: "inflammation", synonyms: ["C-Reactive Protein", "C Reactive Protein"],              organs: ["inflammation"],      loinc: "1988-5",    specimen: "Ser/Plas" },
  { name: "hs-CRP",               category: "inflammation", synonyms: ["High Sensitivity CRP", "hs CRP", "HS CRP"],              organs: ["inflammation", "heart"], loinc: "30522-7", specimen: "Ser/Plas" },
  { name: "ESR",                  category: "inflammation", synonyms: ["Erythrocyte Sedimentation Rate", "Sed Rate"],            organs: ["inflammation"],      loinc: "4537-7",    specimen: "Bld" },
  { name: "Procalcitonin",        category: "inflammation", synonyms: ["PCT"],                                                    organs: ["inflammation"],      loinc: "33959-8",   specimen: "Ser/Plas" },

  // Coagulation
  { name: "PT",                   category: "coagulation", synonyms: ["Prothrombin Time"],                                        organs: ["coagulation"],       loinc: "5902-2",    specimen: "PPP" },
  { name: "INR",                  category: "coagulation", synonyms: ["International Normalized Ratio", "PT-INR"],                organs: ["coagulation"]        /* derived from PT */ },
  { name: "aPTT",                 category: "coagulation", synonyms: ["APTT", "Activated Partial Thromboplastin Time", "PTT"],   organs: ["coagulation"],       loinc: "3173-2",    specimen: "PPP" },
  { name: "D-Dimer",              category: "coagulation", synonyms: ["D Dimer", "DDimer"],                                      organs: ["coagulation"],       loinc: "48065-7",   specimen: "PPP" },
  { name: "Fibrinogen",           category: "coagulation", synonyms: ["S. Fibrinogen"],                                          organs: ["coagulation"],       loinc: "3255-7",    specimen: "PPP" },

  // Hormones (sex hormones + adrenal)
  { name: "Cortisol",             category: "endocrine",  synonyms: ["Serum Cortisol", "S. Cortisol"],                           organs: ["hormones"],          loinc: "2143-6",    specimen: "Ser/Plas" },
  { name: "Testosterone",         category: "endocrine",  synonyms: ["Total Testosterone", "S. Testosterone"],                   organs: ["hormones"],          loinc: "2986-8",    specimen: "Ser/Plas" },
  { name: "Prolactin",            category: "endocrine",  synonyms: ["S. Prolactin", "PRL"],                                     organs: ["hormones"],          loinc: "2842-3",    specimen: "Ser/Plas" },

  // Pancreas (exocrine markers, distinct from glucose panel)
  { name: "Amylase",              category: "chemistry",  synonyms: ["S. Amylase", "Serum Amylase"],                             organs: ["pancreas"],          loinc: "1798-8",    specimen: "Ser/Plas" },
  { name: "Lipase",               category: "chemistry",  synonyms: ["S. Lipase", "Serum Lipase"],                               organs: ["pancreas"],          loinc: "3040-3",    specimen: "Ser/Plas" },
];

// Plausibility bounds + canonical units. Deliberately permissive — err wide
// to avoid rejecting rare-but-real values. Applied to CANONICALS after the
// fact so we don't have to rewrite the entire array inline.
//
// Sources: Tietz (14th ed) reference intervals × 3–5x, cross-checked with
// common Indian lab report ranges (Thyrocare, SRL, Apollo).
const PLAUSIBILITY: Record<string, { min: number; max: number; unit: string }> = {
  // Kidney
  "Creatinine":              { min: 0.05, max: 30,     unit: "mg/dL" },
  "Urea":                    { min: 1,    max: 400,    unit: "mg/dL" },
  "Uric Acid":               { min: 0.5,  max: 25,     unit: "mg/dL" },
  "eGFR":                    { min: 1,    max: 200,    unit: "mL/min/1.73m2" },
  "Urine Albumin":           { min: 0,    max: 5000,   unit: "mg/L" },

  // Liver
  "ALT":                     { min: 1,    max: 5000,   unit: "U/L" },
  "AST":                     { min: 1,    max: 5000,   unit: "U/L" },
  "ALP":                     { min: 10,   max: 3000,   unit: "U/L" },
  "GGT":                     { min: 1,    max: 3000,   unit: "U/L" },
  "Total Bilirubin":         { min: 0.05, max: 50,     unit: "mg/dL" },
  "Direct Bilirubin":        { min: 0,    max: 40,     unit: "mg/dL" },
  "Indirect Bilirubin":      { min: 0,    max: 40,     unit: "mg/dL" },
  "Albumin":                 { min: 0.5,  max: 7,      unit: "g/dL" },
  "Total Protein":           { min: 2,    max: 12,     unit: "g/dL" },
  "Globulin":                { min: 0.5,  max: 8,      unit: "g/dL" },
  "A/G Ratio":               { min: 0.1,  max: 5,      unit: "" },

  // Thyroid
  "TSH":                     { min: 0.001, max: 500,   unit: "µIU/mL" },
  "Free T3":                 { min: 0.1,  max: 30,     unit: "pg/mL" },
  "Free T4":                 { min: 0.05, max: 15,     unit: "ng/dL" },
  "Total T3":                { min: 10,   max: 800,    unit: "ng/dL" },
  "Total T4":                { min: 0.5,  max: 30,     unit: "µg/dL" },

  // Metabolic / Pancreas
  "Fasting Glucose":         { min: 20,   max: 800,    unit: "mg/dL" },
  "Postprandial Glucose":    { min: 20,   max: 1000,   unit: "mg/dL" },
  "Random Glucose":          { min: 20,   max: 1000,   unit: "mg/dL" },
  "HbA1c":                   { min: 3,    max: 20,     unit: "%" },
  "Insulin":                 { min: 0.1,  max: 1000,   unit: "µIU/mL" },
  "C-Peptide":               { min: 0.05, max: 50,     unit: "ng/mL" },

  // Lipid
  "Total Cholesterol":       { min: 40,   max: 800,    unit: "mg/dL" },
  "HDL Cholesterol":         { min: 5,    max: 200,    unit: "mg/dL" },
  "LDL Cholesterol":         { min: 5,    max: 600,    unit: "mg/dL" },
  "VLDL":                    { min: 1,    max: 300,    unit: "mg/dL" },
  "Triglycerides":           { min: 10,   max: 5000,   unit: "mg/dL" },
  "Non-HDL Cholesterol":     { min: 10,   max: 700,    unit: "mg/dL" },

  // Cardiac
  "Troponin I":              { min: 0,    max: 100,    unit: "ng/mL" },
  "Troponin T":              { min: 0,    max: 100,    unit: "ng/mL" },
  "CK-MB":                   { min: 0,    max: 500,    unit: "ng/mL" },
  "BNP":                     { min: 0,    max: 50000,  unit: "pg/mL" },

  // CBC / Blood
  "Hemoglobin":              { min: 2,    max: 25,     unit: "g/dL" },
  "Hematocrit":              { min: 5,    max: 75,     unit: "%" },
  "RBC Count":               { min: 1,    max: 10,     unit: "10^6/µL" },
  "WBC Count":               { min: 0.1,  max: 500,    unit: "10^3/µL" },
  "Platelet Count":          { min: 1,    max: 2000,   unit: "10^3/µL" },
  "MCV":                     { min: 40,   max: 150,    unit: "fL" },
  "MCH":                     { min: 10,   max: 50,     unit: "pg" },
  "MCHC":                    { min: 20,   max: 45,     unit: "g/dL" },
  "RDW":                     { min: 8,    max: 40,     unit: "%" },
  "Neutrophils":             { min: 0,    max: 100,    unit: "%" },
  "Lymphocytes":             { min: 0,    max: 100,    unit: "%" },
  "Eosinophils":             { min: 0,    max: 50,     unit: "%" },
  "Monocytes":               { min: 0,    max: 50,     unit: "%" },
  "Basophils":               { min: 0,    max: 20,     unit: "%" },

  // Urinalysis (all qualitative — no bounds, but expected unit is "" so
  // unit-mismatch doesn't fire on strings like "Negative"/"1+")
  "Urine pH":                { min: 3,    max: 10,     unit: "" },
  "Urine Specific Gravity":  { min: 1.0,  max: 1.05,   unit: "" },

  // Electrolytes
  "Sodium":                  { min: 100,  max: 200,    unit: "mmol/L" },
  "Potassium":               { min: 1,    max: 12,     unit: "mmol/L" },
  "Chloride":                { min: 70,   max: 150,    unit: "mmol/L" },
  "Bicarbonate":             { min: 5,    max: 50,     unit: "mmol/L" },
  "Calcium":                 { min: 4,    max: 20,     unit: "mg/dL" },
  "Phosphorus":              { min: 0.5,  max: 15,     unit: "mg/dL" },
  "Magnesium":               { min: 0.5,  max: 8,      unit: "mg/dL" },

  // Additions (new organs)
  "Vitamin D":               { min: 1,    max: 400,    unit: "ng/mL" },
  "PTH":                     { min: 1,    max: 5000,   unit: "pg/mL" },
  "Vitamin B12":             { min: 20,   max: 5000,   unit: "pg/mL" },
  "Folate":                  { min: 0.5,  max: 50,     unit: "ng/mL" },
  "Iron":                    { min: 5,    max: 500,    unit: "µg/dL" },
  "Ferritin":                { min: 1,    max: 20000,  unit: "ng/mL" },
  "TIBC":                    { min: 100,  max: 800,    unit: "µg/dL" },
  "Transferrin":             { min: 50,   max: 500,    unit: "mg/dL" },
  "CRP":                     { min: 0,    max: 500,    unit: "mg/L" },
  "hs-CRP":                  { min: 0,    max: 100,    unit: "mg/L" },
  "ESR":                     { min: 0,    max: 200,    unit: "mm/hr" },
  "Procalcitonin":           { min: 0,    max: 1000,   unit: "ng/mL" },
  "PT":                      { min: 5,    max: 100,    unit: "sec" },
  "INR":                     { min: 0.5,  max: 15,     unit: "" },
  "aPTT":                    { min: 15,   max: 300,    unit: "sec" },
  "D-Dimer":                 { min: 0,    max: 50000,  unit: "ng/mL" },
  "Fibrinogen":              { min: 30,   max: 1500,   unit: "mg/dL" },
  "Cortisol":                { min: 0.5,  max: 100,    unit: "µg/dL" },
  "Testosterone":            { min: 5,    max: 3000,   unit: "ng/dL" },
  "Prolactin":               { min: 0.5,  max: 500,    unit: "ng/mL" },
  "Amylase":                 { min: 5,    max: 5000,   unit: "U/L" },
  "Lipase":                  { min: 5,    max: 20000,  unit: "U/L" },
};

// Apply plausibility overrides to CANONICALS (inline the bounds).
for (const c of CANONICALS) {
  const p = PLAUSIBILITY[c.name];
  if (p) {
    c.min = p.min;
    c.max = p.max;
    c.unit = p.unit;
  }
}

async function main() {
  // 1. Organs
  console.log(`[seed] upserting ${ORGANS.length} organs…`);
  for (const o of ORGANS) {
    await prisma.organSystem.upsert({
      where: { key: o.key },
      create: o,
      update: { name: o.name, icon: o.icon, svgRegionId: o.svgRegionId },
    });
  }

  // 2. Canonicals + synonyms + organ maps
  // Pre-check which LOINC codes exist. If loinc_terms is empty (user hasn't
  // run `npm run loinc:seed` yet), we skip setting loincNum rather than
  // failing the whole seed on the FK constraint.
  const wantedLoincs = Array.from(new Set(CANONICALS.map((c) => c.loinc).filter((v): v is string => !!v)));
  const foundLoincs = wantedLoincs.length === 0
    ? new Set<string>()
    : new Set(
        (await prisma.loincTerm.findMany({ where: { loincNum: { in: wantedLoincs } }, select: { loincNum: true } }))
          .map((r) => r.loincNum),
      );
  const missing = wantedLoincs.filter((l) => !foundLoincs.has(l));
  if (missing.length > 0) {
    console.warn(
      `[seed] ${missing.length}/${wantedLoincs.length} LOINC code(s) not present in loinc_terms. ` +
      `Run \`npm run loinc:seed\` first, then re-run this to populate loincNum. ` +
      `Continuing with loincNum=null for those canonicals.`,
    );
  }

  console.log(`[seed] upserting ${CANONICALS.length} canonical tests…`);
  for (const c of CANONICALS) {
    const loincNum = c.loinc && foundLoincs.has(c.loinc) ? c.loinc : null;
    const shared = {
      category: c.category,
      loincNum,
      specimen: c.specimen ?? null,
      minValue: c.min ?? null,
      maxValue: c.max ?? null,
      expectedUnit: c.unit ?? null,
    };
    const canonical = await prisma.testCanonical.upsert({
      where: { name: c.name },
      create: { name: c.name, ...shared },
      update: shared,
    });

    for (const raw of c.synonyms) {
      await prisma.testSynonym.upsert({
        where: { rawName: raw },
        create: { rawName: raw, canonicalTestId: canonical.id },
        update: { canonicalTestId: canonical.id },
      });
    }

    for (const organKey of c.organs) {
      const organ = await prisma.organSystem.findUnique({ where: { key: organKey } });
      if (!organ) {
        console.warn(`  ! unknown organ key "${organKey}" for canonical "${c.name}"`);
        continue;
      }
      await prisma.organSystemTestMap.upsert({
        where: { organSystemId_canonicalTestId: { organSystemId: organ.id, canonicalTestId: canonical.id } },
        create: { organSystemId: organ.id, canonicalTestId: canonical.id },
        update: {},
      });
    }
  }

  const synCount = await prisma.testSynonym.count();
  const mapCount = await prisma.organSystemTestMap.count();
  const loincLinked = await prisma.testCanonical.count({ where: { loincNum: { not: null } } });
  const specimenSet = await prisma.testCanonical.count({ where: { specimen: { not: null } } });
  const boundsSet = await prisma.testCanonical.count({ where: { minValue: { not: null } } });
  console.log(
    `[seed] done — organs=${ORGANS.length}, canonicals=${CANONICALS.length}, synonyms=${synCount}, organ-maps=${mapCount}, loinc-linked=${loincLinked}/${CANONICALS.length}, specimen-set=${specimenSet}/${CANONICALS.length}, bounds-set=${boundsSet}/${CANONICALS.length}`,
  );

  // 3. LOINC ↔ specimen consistency audit. Both are set on canonicals — verify
  //    they agree. LOINC's system column is authoritative for what specimen
  //    that code refers to; a divergence means either the LOINC assignment
  //    is wrong or the specimen tag is wrong.
  const canonicalsWithLoinc = await prisma.testCanonical.findMany({
    where: { loincNum: { not: null }, specimen: { not: null } },
    select: {
      name: true,
      specimen: true,
      loincNum: true,
      loincTerm: { select: { system: true } },
    },
  });

  const mismatches: Array<{ name: string; canonicalSpecimen: string; loincSystem: string; loincNum: string }> = [];
  for (const c of canonicalsWithLoinc) {
    if (!c.loincTerm?.system) continue; // LOINC row has no system data — can't judge
    const canonicalSpec = (c.specimen ?? "").trim().toLowerCase();
    const loincSpec = c.loincTerm.system.trim().toLowerCase();
    if (canonicalSpec !== loincSpec) {
      mismatches.push({
        name: c.name,
        canonicalSpecimen: c.specimen!,
        loincSystem: c.loincTerm.system,
        loincNum: c.loincNum!,
      });
    }
  }
  if (mismatches.length > 0) {
    console.warn(
      `\n[seed] ⚠  ${mismatches.length} canonical(s) have specimen mismatched with their LOINC's system:`,
    );
    for (const m of mismatches) {
      console.warn(
        `  · ${m.name}  (LOINC ${m.loincNum})  canonical.specimen="${m.canonicalSpecimen}"  vs  loinc.system="${m.loincSystem}"`,
      );
    }
    console.warn(
      `  Fix: adjust the biomarker's specimen or LOINC code in seed-biomarkers.ts, then re-run.`,
    );
  } else {
    console.log(`[seed] ✓ LOINC ↔ specimen consistency: all ${canonicalsWithLoinc.length} checked canonicals agree`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
