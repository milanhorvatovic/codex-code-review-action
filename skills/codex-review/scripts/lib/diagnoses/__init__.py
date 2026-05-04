"""Diagnoses for the tune capability.

Each module under this package exposes a single pure function from a parsed
Findings shape (plus a DiagnosisContext that carries the integrator's
reference and workflow paths) to a Diagnosis. The capability runs every
diagnosis and renders the firing ones with their unified diffs and
rationales.
"""

from __future__ import annotations

from ..findings_loader import Findings
from .low_confidence import low_confidence_diagnosis
from .noisy_p3 import noisy_p3_diagnosis
from .truncation import truncation_diagnosis
from .types import (
    Diagnosis,
    DiagnosisContext,
    DiagnosisFn,
    DiagnosisKind,
    Recommendation,
    RecommendationTarget,
)

ALL_DIAGNOSES: tuple[DiagnosisFn, ...] = (
    low_confidence_diagnosis,
    noisy_p3_diagnosis,
    truncation_diagnosis,
)


def run_all_diagnoses(findings: Findings, ctx: DiagnosisContext | None = None) -> tuple[Diagnosis, ...]:
    context = ctx or DiagnosisContext()
    return tuple(diagnose(findings, context) for diagnose in ALL_DIAGNOSES)


__all__ = [
    "ALL_DIAGNOSES",
    "Diagnosis",
    "DiagnosisContext",
    "DiagnosisFn",
    "DiagnosisKind",
    "Recommendation",
    "RecommendationTarget",
    "run_all_diagnoses",
]
