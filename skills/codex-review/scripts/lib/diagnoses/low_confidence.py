"""Low-confidence verdict diagnosis."""

from __future__ import annotations

from ..findings_loader import Findings
from .types import Diagnosis, DiagnosisContext, Recommendation

_VERDICT_THRESHOLD = 0.9
_FINDING_BAND_LOWER = 0.5
_FINDING_BAND_UPPER = 0.7


def low_confidence_diagnosis(findings: Findings, ctx: DiagnosisContext) -> Diagnosis:
    if findings.overall_confidence_score >= _VERDICT_THRESHOLD:
        return Diagnosis(kind="low-confidence", recommendations=(), triggered=False)
    in_band = [
        finding
        for finding in findings.findings
        if _FINDING_BAND_LOWER <= finding.confidence_score <= _FINDING_BAND_UPPER
    ]
    if not in_band:
        return Diagnosis(kind="low-confidence", recommendations=(), triggered=False)
    titles = tuple(finding.title for finding in in_band)
    diff = "\n".join(
        [
            f"--- a/{ctx.reference_path}",
            f"+++ b/{ctx.reference_path}",
            "@@",
            "+## Calibration",
            "+",
            "+The verdict's overall confidence dropped below the 0.9 threshold because the following findings",
            "+landed in the 0.5–0.7 band. Add a few-shot example or sharpen the focus areas so the model can",
            "+commit to a verdict on similar diffs:",
            "+",
            *(f"+- {title}" for title in titles),
            "+",
        ]
    )
    rationale = "\n".join(
        [
            f"Overall verdict confidence {findings.overall_confidence_score:.2f} is below 0.9.",
            f"{len(in_band)} finding(s) clustered in the 0.5–0.7 confidence band. Consider one of:",
            "  - Add a focus-area sentence or a few-shot example to the reference file (preferred).",
            "  - Bump effort: medium → high on the review job (if cost allows).",
            "  - Bump model: try a higher-tier model on this surface area only.",
            "Pick at most one. Do not adjust min-confidence to mask the band — that hides calibration drift.",
        ]
    )
    return Diagnosis(
        kind="low-confidence",
        recommendations=(
            Recommendation(
                contributing_findings=titles,
                diff=diff,
                kind="low-confidence",
                rationale=rationale,
                target="reference-file",
            ),
        ),
        triggered=True,
    )
