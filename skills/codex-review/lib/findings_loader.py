"""Validate parsed findings against the runtime shape of review-output-schema.json.

Range checks on confidence_score and priority, enum check on
overall_correctness, and presence checks on every required field.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Finding:
    body: str
    confidence_score: float
    line: int
    path: str
    priority: int
    reasoning: str
    start_line: int | None
    suggestion: str | None
    title: str


@dataclass(frozen=True)
class FileChange:
    description: str
    path: str


@dataclass(frozen=True)
class Findings:
    changes: tuple[str, ...]
    effort: str | None
    files: tuple[FileChange, ...]
    findings: tuple[Finding, ...]
    model: str
    overall_confidence_score: float
    overall_correctness: Literal["patch is correct", "patch is incorrect"]
    summary: str


class FindingsValidationError(Exception):
    """Raised when findings JSON does not match the schema's runtime contract."""


_REQUIRED_TOP = (
    "changes",
    "effort",
    "files",
    "findings",
    "model",
    "overall_confidence_score",
    "overall_correctness",
    "summary",
)
_REQUIRED_FIELDS = (
    "body",
    "confidence_score",
    "line",
    "path",
    "priority",
    "reasoning",
    "start_line",
    "suggestion",
    "title",
)


def parse_findings(json_text: str) -> Findings:
    try:
        raw = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise FindingsValidationError(f"findings JSON is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise FindingsValidationError("findings root must be an object")
    for key in _REQUIRED_TOP:
        if key not in raw:
            raise FindingsValidationError(f"missing top-level field: {key}")
    if not isinstance(raw["findings"], list):
        raise FindingsValidationError("findings must be an array")
    findings_list: list[Finding] = []
    for index, finding in enumerate(raw["findings"]):
        if not isinstance(finding, dict):
            raise FindingsValidationError(f"findings[{index}] must be an object")
        for field_name in _REQUIRED_FIELDS:
            if field_name not in finding:
                raise FindingsValidationError(f"findings[{index}] missing field: {field_name}")
        confidence = finding["confidence_score"]
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise FindingsValidationError(f"findings[{index}].confidence_score out of range")
        priority = finding["priority"]
        if not isinstance(priority, int) or not 0 <= priority <= 3:
            raise FindingsValidationError(f"findings[{index}].priority out of range")
        findings_list.append(
            Finding(
                body=finding["body"],
                confidence_score=float(confidence),
                line=int(finding["line"]),
                path=finding["path"],
                priority=int(priority),
                reasoning=finding["reasoning"],
                start_line=finding["start_line"],
                suggestion=finding["suggestion"],
                title=finding["title"],
            )
        )
    verdict = raw["overall_correctness"]
    if verdict not in ("patch is correct", "patch is incorrect"):
        raise FindingsValidationError("overall_correctness must be 'patch is correct' or 'patch is incorrect'")
    overall_conf = raw["overall_confidence_score"]
    if not isinstance(overall_conf, (int, float)) or not 0 <= overall_conf <= 1:
        raise FindingsValidationError("overall_confidence_score out of range")
    files = tuple(FileChange(description=item["description"], path=item["path"]) for item in raw["files"])
    return Findings(
        changes=tuple(raw["changes"]),
        effort=raw["effort"],
        files=files,
        findings=tuple(findings_list),
        model=raw["model"],
        overall_confidence_score=float(overall_conf),
        overall_correctness=verdict,
        summary=raw["summary"],
    )
