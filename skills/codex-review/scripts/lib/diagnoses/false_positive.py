"""False-positive diagnosis driven by integrator-confirmed finding titles."""

from __future__ import annotations

from ..findings_loader import Finding, Findings
from .types import Diagnosis, DiagnosisContext, Recommendation


def _normalize_title(title: str) -> str:
    return " ".join(title.casefold().split())


def _finding_summary(finding: Finding) -> str:
    location = f"{finding.path}:{finding.line}"
    return f"{finding.title} (`{location}`, P{finding.priority}, confidence {finding.confidence_score:.2f})"


def false_positive_diagnosis(findings: Findings, ctx: DiagnosisContext) -> Diagnosis:
    wanted = {_normalize_title(title) for title in ctx.false_positive_titles if title.strip()}
    if not wanted:
        return Diagnosis(kind="false-positive", recommendations=(), triggered=False)

    matched = tuple(finding for finding in findings.findings if _normalize_title(finding.title) in wanted)
    if not matched:
        return Diagnosis(kind="false-positive", recommendations=(), triggered=False)

    titles = tuple(finding.title for finding in matched)
    diff = "\n".join(
        [
            f"--- a/{ctx.reference_path}",
            f"+++ b/{ctx.reference_path}",
            "@@",
            "+## False-positive calibration",
            "+",
            "+The following findings were reviewed by a maintainer and classified as false positives:",
            "+",
            *(f"+- {_finding_summary(finding)}" for finding in matched),
            "+",
            "+Do not emit similar findings unless the diff shows concrete behavioral, security, or runtime impact.",
            "+Before flagging a similar concern, cite the exact broken contract, failing runtime path, or",
            "+documented project rule being violated. Omit concerns that are only style, naming, formatting,",
            "+or linter-owned cleanup unless this reference file explicitly asks for them.",
            "+",
        ]
    )
    paths = ", ".join(sorted({finding.path for finding in matched}))
    score_range = f"{min(f.confidence_score for f in matched):.2f}-{max(f.confidence_score for f in matched):.2f}"
    rationale = "\n".join(
        [
            f"Integrator marked {len(matched)} finding(s) as false positive.",
            "The retained findings artifact cannot infer that label by itself, so this recommendation records the human calibration explicitly in the review-reference file.",
            f"Affected path(s): {paths}.",
            f"False-positive confidence range on this run: {score_range}.",
            "Prefer reference-file calibration over a broad min-confidence increase unless the false positives are all low-confidence noise; a threshold change can hide unrelated real findings.",
        ]
    )
    return Diagnosis(
        kind="false-positive",
        recommendations=(
            Recommendation(
                contributing_findings=titles,
                diff=diff,
                kind="false-positive",
                rationale=rationale,
                target="reference-file",
            ),
        ),
        triggered=True,
    )
