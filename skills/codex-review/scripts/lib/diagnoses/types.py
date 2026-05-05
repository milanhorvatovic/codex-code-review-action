"""Shared dataclasses and type aliases for the diagnosis modules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from ..findings_loader import Findings

type DiagnosisKind = Literal["false-positive", "low-confidence", "noisy-p3", "truncation"]
type RecommendationTarget = Literal["reference-file", "workflow"]


@dataclass(frozen=True)
class DiagnosisContext:
    """Paths the diagnoses use when rendering diff hunks.

    The fields are integrator-supplied; the integrator runs `tune` and may
    pass --reference-path / --workflow-path to point at whatever conventions
    their repo uses. The diagnoses use these values verbatim in the unified
    diff hunks so the integrator can apply the patch without retargeting.
    Default values are placeholders that make it obvious the integrator did
    not point the script at their actual files.
    """

    reference_path: str = "<your-review-reference-path>"
    workflow_path: str = "<your-workflow-path>"
    false_positive_titles: tuple[str, ...] = ()


@dataclass(frozen=True)
class Recommendation:
    contributing_findings: tuple[str, ...]
    diff: str
    kind: DiagnosisKind
    rationale: str
    target: RecommendationTarget


@dataclass(frozen=True)
class Diagnosis:
    kind: DiagnosisKind
    recommendations: tuple[Recommendation, ...]
    triggered: bool


type DiagnosisFn = Callable[[Findings, DiagnosisContext], Diagnosis]
