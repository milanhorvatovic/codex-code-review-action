"""Truncation diagnosis: detect the 'Incomplete review' banner and suggest a smaller chunk size."""

from __future__ import annotations

from ..findings_loader import Findings
from .types import Diagnosis, DiagnosisContext, Recommendation

_BANNER_PHRASE = "incomplete review"


def truncation_diagnosis(findings: Findings, ctx: DiagnosisContext) -> Diagnosis:
    if _BANNER_PHRASE not in findings.summary.lower():
        return Diagnosis(kind="truncation", recommendations=(), triggered=False)
    titles = tuple(finding.title for finding in findings.findings)
    diff = "\n".join(
        [
            f"--- a/{ctx.workflow_path}",
            f"+++ b/{ctx.workflow_path}",
            "@@",
            "       - id: prepare",
            "         uses: milanhorvatovic/codex-ai-code-review-action/prepare@<sha>",
            "         with:",
            "           allow-users: <unchanged>",
            '+          max-chunk-bytes: "102400"',
            "",
        ]
    )
    rationale = "\n".join(
        [
            "Summary contains the literal 'Incomplete review' banner phrase. One or more chunks did not produce output, so the published review has gaps.",
            "Halving max-chunk-bytes (default 204800 → 102400) is the safest first move: it splits the diff into smaller chunks, which both lowers per-chunk model timeouts and reduces the blast radius of any single chunk failure.",
            "If the truncation persists after halving, investigate the failing chunk's run log directly (debug-run capability, planned).",
        ]
    )
    return Diagnosis(
        kind="truncation",
        recommendations=(
            Recommendation(
                contributing_findings=titles,
                diff=diff,
                kind="truncation",
                rationale=rationale,
                target="workflow",
            ),
        ),
        triggered=True,
    )
