import type { Findings } from "../findings-loader.js";

export type DiagnosisKind = "low-confidence" | "noisy-p3" | "truncation";

export type RecommendationTarget = "reference-file" | "workflow";

export type Recommendation = {
  contributingFindings: ReadonlyArray<string>;
  diff: string;
  kind: DiagnosisKind;
  rationale: string;
  target: RecommendationTarget;
};

export type Diagnosis = {
  kind: DiagnosisKind;
  recommendations: ReadonlyArray<Recommendation>;
  triggered: boolean;
};

export type DiagnosisFn = (findings: Findings) => Diagnosis;
