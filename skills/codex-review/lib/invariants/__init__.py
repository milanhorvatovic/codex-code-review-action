"""Consumer-controls invariants engine.

Walks a parsed workflow against the CC-NN predicates encoded in
``predicates.py``. Every capability that emits a workflow file refuses to
write any artifact unless this engine returns ok=True.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..workflow_parser import parse_workflow
from .predicates import PREDICATES, InvariantContext, InvariantId, InvariantOutcome

ALL_INVARIANTS: tuple[InvariantId, ...] = (
    "CC-01",
    "CC-02",
    "CC-03",
    "CC-04",
    "CC-05",
    "CC-06",
    "CC-07",
    "CC-08",
    "CC-09",
    "CC-EXTRA-01-bare-action",
)


@dataclass(frozen=True)
class AssertReport:
    failures: tuple[InvariantOutcome, ...]
    ok: bool
    outcomes: tuple[InvariantOutcome, ...]


def assert_workflow(
    yaml_text: str,
    *,
    action_version: str | None = None,
    ids: tuple[InvariantId, ...] | None = None,
) -> AssertReport:
    workflow = parse_workflow(yaml_text)
    chosen_ids = ids if ids is not None else ALL_INVARIANTS
    ctx = InvariantContext(action_version=action_version, workflow=workflow)
    outcomes = tuple(PREDICATES[invariant_id](ctx) for invariant_id in chosen_ids)
    failures = tuple(o for o in outcomes if not o.ok)
    return AssertReport(failures=failures, ok=len(failures) == 0, outcomes=outcomes)


def format_report(report: AssertReport) -> str:
    lines: list[str] = []
    for outcome in report.outcomes:
        mark = "✓" if outcome.ok else "✗"
        lines.append(f"{mark} {outcome.id}: {outcome.detail}")
    return "\n".join(lines)


__all__ = [
    "ALL_INVARIANTS",
    "AssertReport",
    "InvariantContext",
    "InvariantId",
    "InvariantOutcome",
    "assert_workflow",
    "format_report",
]
