"""Noisy-P3 diagnosis: surfaces a min-confidence cutoff to suppress style noise."""

from __future__ import annotations

import math

from ..findings_loader import Findings
from .types import Diagnosis, Recommendation

_P3_COUNT_THRESHOLD = 6


def noisy_p3_diagnosis(findings: Findings) -> Diagnosis:
    p3 = [finding for finding in findings.findings if finding.priority == 3]
    if len(p3) <= _P3_COUNT_THRESHOLD:
        return Diagnosis(kind="noisy-p3", recommendations=(), triggered=False)
    sorted_scores = sorted(finding.confidence_score for finding in p3)
    cutoff_index = math.floor(len(sorted_scores) * 0.75)
    raw_cutoff = sorted_scores[cutoff_index] if cutoff_index < len(sorted_scores) else sorted_scores[-1]
    cutoff = round(raw_cutoff, 2)
    titles = tuple(finding.title for finding in p3)
    diff = "\n".join(
        [
            "--- a/.github/workflows/codex-review.yaml",
            "+++ b/.github/workflows/codex-review.yaml",
            "@@",
            "       - uses: milanhorvatovic/codex-ai-code-review-action/publish@<sha>",
            "         with:",
            "           github-token: ${{ github.token }}",
            "           expected-chunks: ${{ needs.prepare.outputs.chunk-count }}",
            f'+          min-confidence: "{cutoff:.2f}"',
            '           retain-findings: "false"',
            '           fail-on-missing-chunks: "true"',
        ]
    )
    rationale = "\n".join(
        [
            f"Found {len(p3)} P3 (minor) findings.",
            f"Setting publish.min-confidence to {cutoff:.2f} would prune the bottom 75% of P3 findings on this run.",
            "If P3 noise is concentrated in one file-type section of your review-reference.md, consider pruning that section instead — that addresses the cause, not the symptom.",
            "Affected finding titles below.",
        ]
    )
    return Diagnosis(
        kind="noisy-p3",
        recommendations=(
            Recommendation(
                contributing_findings=titles,
                diff=diff,
                kind="noisy-p3",
                rationale=rationale,
                target="workflow",
            ),
        ),
        triggered=True,
    )
