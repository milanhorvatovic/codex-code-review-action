import type { DiagnosisFn } from "./types.js";

const P3_COUNT_THRESHOLD = 6;

export const noisyP3Diagnosis: DiagnosisFn = (findings) => {
  const p3 = findings.findings.filter((f) => f.priority === 3);
  if (p3.length <= P3_COUNT_THRESHOLD) {
    return { kind: "noisy-p3", recommendations: [], triggered: false };
  }
  const sorted = [...p3].map((f) => f.confidence_score).sort((a, b) => a - b);
  const cutoffIndex = Math.floor(sorted.length * 0.75);
  const cutoff = Number((sorted[cutoffIndex] ?? sorted[sorted.length - 1] ?? 0.7).toFixed(2));
  const titles = p3.map((f) => f.title);
  const diff = [
    "--- a/.github/workflows/codex-review.yaml",
    "+++ b/.github/workflows/codex-review.yaml",
    "@@",
    "       - uses: milanhorvatovic/codex-ai-code-review-action/publish@<sha>",
    "         with:",
    "           github-token: ${{ github.token }}",
    "           expected-chunks: ${{ needs.prepare.outputs.chunk-count }}",
    `+          min-confidence: "${cutoff.toFixed(2)}"`,
    '           retain-findings: "false"',
    '           fail-on-missing-chunks: "true"',
  ].join("\n");
  const rationale = [
    `Found ${p3.length} P3 (minor) findings.`,
    `Setting publish.min-confidence to ${cutoff.toFixed(2)} would prune the bottom 75% of P3 findings on this run.`,
    "If P3 noise is concentrated in one file-type section of your review-reference.md, consider pruning that section instead — that addresses the cause, not the symptom.",
    "Affected finding titles below.",
  ].join("\n");
  return {
    kind: "noisy-p3",
    recommendations: [
      {
        contributingFindings: titles,
        diff,
        kind: "noisy-p3",
        rationale,
        target: "workflow",
      },
    ],
    triggered: true,
  };
};
