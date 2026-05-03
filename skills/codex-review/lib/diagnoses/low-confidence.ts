import type { DiagnosisFn } from "./types.js";

const VERDICT_THRESHOLD = 0.9;
const FINDING_BAND_LOWER = 0.5;
const FINDING_BAND_UPPER = 0.7;

export const lowConfidenceDiagnosis: DiagnosisFn = (findings) => {
  if (findings.overall_confidence_score >= VERDICT_THRESHOLD) {
    return { kind: "low-confidence", recommendations: [], triggered: false };
  }
  const inBand = findings.findings.filter(
    (f) => f.confidence_score >= FINDING_BAND_LOWER && f.confidence_score <= FINDING_BAND_UPPER,
  );
  if (inBand.length === 0) {
    return { kind: "low-confidence", recommendations: [], triggered: false };
  }
  const titles = inBand.map((f) => f.title);
  const diff = [
    "--- a/.github/codex/review-reference.md",
    "+++ b/.github/codex/review-reference.md",
    "@@",
    "+## Calibration",
    "+",
    "+The verdict's overall confidence dropped below the 0.9 threshold because the following findings",
    "+landed in the 0.5–0.7 band. Add a few-shot example or sharpen the focus areas so the model can",
    "+commit to a verdict on similar diffs:",
    "+",
    ...titles.map((t) => `+- ${t}`),
    "+",
  ].join("\n");
  const rationale = [
    `Overall verdict confidence ${findings.overall_confidence_score.toFixed(2)} is below 0.9.`,
    `${inBand.length} finding(s) clustered in the 0.5–0.7 confidence band. Consider one of:`,
    "  - Add a focus-area sentence or a few-shot example to the reference file (preferred).",
    "  - Bump effort: medium → high on the review job (if cost allows).",
    "  - Bump model: try a higher-tier model on this surface area only.",
    "Pick at most one. Do not adjust min-confidence to mask the band — that hides calibration drift.",
  ].join("\n");
  return {
    kind: "low-confidence",
    recommendations: [
      {
        contributingFindings: titles,
        diff,
        kind: "low-confidence",
        rationale,
        target: "reference-file",
      },
    ],
    triggered: true,
  };
};
