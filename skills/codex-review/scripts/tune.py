"""Deterministic glue for the codex-review:tune capability.

Loads findings, runs every diagnosis, renders a markdown report with one
fenced-diff Recommendation per fired diagnosis. Never writes to disk.

Invoked from the capability prompt as:

    python3 scripts/tune.py --findings-path /path/to/findings.json [--reference-path ...] [--workflow-path ...]
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from lib.diagnoses import Diagnosis, run_all_diagnoses
from lib.findings_loader import Findings, parse_findings


class TuneError(Exception):
    """Raised when tune cannot proceed (no input supplied, invalid findings, etc.)."""


@dataclass(frozen=True)
class TuneInputs:
    findings_path: str | None = None
    findings_text: str | None = None
    reference_path: str | None = None
    workflow_path: str | None = None


@dataclass(frozen=True)
class TuneOutputs:
    diagnoses: tuple[Diagnosis, ...]
    findings: Findings
    report: str


def _load_findings(inputs: TuneInputs) -> Findings:
    if inputs.findings_text is not None:
        return parse_findings(inputs.findings_text)
    if inputs.findings_path is not None:
        return parse_findings(Path(inputs.findings_path).read_text(encoding="utf-8"))
    raise TuneError("supply either findings_path or findings_text")


def _render_report(findings: Findings, diagnoses: tuple[Diagnosis, ...]) -> str:
    triggered = [diagnosis for diagnosis in diagnoses if diagnosis.triggered]
    skipped = [diagnosis for diagnosis in diagnoses if not diagnosis.triggered]

    lines: list[str] = []
    lines.append("# Tune report")
    lines.append("")
    lines.append("## Verdict")
    lines.append("")
    lines.append(f"- Overall correctness: `{findings.overall_correctness}`")
    lines.append(f"- Overall confidence: `{findings.overall_confidence_score:.2f}`")
    lines.append(f"- Total findings: `{len(findings.findings)}`")
    lines.append("")

    if not triggered:
        lines.append("## Recommendations")
        lines.append("")
        lines.append(
            "No diagnoses fired. The verdict is well-calibrated, the P3 surface is below the noise threshold, and the summary contains no truncation banner. No changes recommended."
        )
        lines.append("")
    else:
        for diagnosis in triggered:
            for rec in diagnosis.recommendations:
                lines.append(f"## Recommendation: {rec.kind}")
                lines.append("")
                lines.append(f"Target: `{rec.target}`.")
                lines.append("")
                lines.append("```diff")
                lines.append(rec.diff)
                lines.append("```")
                lines.append("")
                lines.append("### Rationale")
                lines.append("")
                lines.append(rec.rationale)
                if rec.contributing_findings:
                    lines.append("")
                    lines.append("### Contributing findings")
                    lines.append("")
                    for title in rec.contributing_findings:
                        lines.append(f"- {title}")
                lines.append("")

    lines.append("## Diagnoses summary")
    lines.append("")
    for diagnosis in diagnoses:
        mark = "fired" if diagnosis.triggered else "skipped"
        lines.append(f"- `{diagnosis.kind}`: {mark}")
    lines.append("")
    if not triggered and len(skipped) == len(diagnoses):
        lines.append("All diagnoses skipped — no tuning required.")

    return "\n".join(lines)


def run_tune(inputs: TuneInputs) -> TuneOutputs:
    findings = _load_findings(inputs)
    diagnoses = run_all_diagnoses(findings)
    report = _render_report(findings, diagnoses)
    return TuneOutputs(diagnoses=diagnoses, findings=findings, report=report)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tune.py",
        description="Diagnose a saved findings.json and emit a markdown report with a unified diff per recommendation.",
    )
    parser.add_argument(
        "--findings-path",
        required=True,
        help="Path to a saved findings.json artifact (typically from retain-findings: true).",
    )
    parser.add_argument(
        "--reference-path",
        default=None,
        help="Path to the consumer's current .github/codex/review-reference.md (optional).",
    )
    parser.add_argument(
        "--workflow-path",
        default=None,
        help="Path to the consumer's current workflow file (optional).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        out = run_tune(
            TuneInputs(
                findings_path=args.findings_path,
                reference_path=args.reference_path,
                workflow_path=args.workflow_path,
            )
        )
    except TuneError as exc:
        print(f"tune failed: {exc}", file=sys.stderr)
        return 1
    print(out.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
