import type { DiagnosisFn } from "./types.js";

const BANNER_PHRASE = "incomplete review";

export const truncationDiagnosis: DiagnosisFn = (findings) => {
  if (!findings.summary.toLowerCase().includes(BANNER_PHRASE)) {
    return { kind: "truncation", recommendations: [], triggered: false };
  }
  const titles = findings.findings.map((f) => f.title);
  const diff = [
    "--- a/.github/workflows/codex-review.yaml",
    "+++ b/.github/workflows/codex-review.yaml",
    "@@",
    "       - id: prepare",
    "         uses: milanhorvatovic/codex-ai-code-review-action/prepare@<sha>",
    "         with:",
    "           allow-users: <unchanged>",
    `+          max-chunk-bytes: "102400"`,
    "",
  ].join("\n");
  const rationale = [
    "Summary contains the literal 'Incomplete review' banner phrase. One or more chunks did not produce output, so the published review has gaps.",
    "Halving max-chunk-bytes (default 204800 → 102400) is the safest first move: it splits the diff into smaller chunks, which both lowers per-chunk model timeouts and reduces the blast radius of any single chunk failure.",
    "If the truncation persists after halving, investigate the failing chunk's run log directly (debug-run capability, planned).",
  ].join("\n");
  return {
    kind: "truncation",
    recommendations: [
      {
        contributingFindings: titles,
        diff,
        kind: "truncation",
        rationale,
        target: "workflow",
      },
    ],
    triggered: true,
  };
};
