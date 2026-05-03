import { lowConfidenceDiagnosis } from "./low-confidence.js";
import { noisyP3Diagnosis } from "./noisy-p3.js";
import { truncationDiagnosis } from "./truncation.js";
import type { Diagnosis, DiagnosisFn } from "./types.js";

import type { Findings } from "../findings-loader.js";

export const ALL_DIAGNOSES: ReadonlyArray<DiagnosisFn> = [
  lowConfidenceDiagnosis,
  noisyP3Diagnosis,
  truncationDiagnosis,
];

export function runAllDiagnoses(findings: Findings): ReadonlyArray<Diagnosis> {
  return ALL_DIAGNOSES.map((fn) => fn(findings));
}

export type { Diagnosis, DiagnosisFn, DiagnosisKind, Recommendation, RecommendationTarget } from "./types.js";
