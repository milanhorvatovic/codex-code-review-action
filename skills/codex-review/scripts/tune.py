"""Deterministic glue for the codex-review:tune capability.

Loads findings, runs every diagnosis, renders a markdown report with one
fenced-diff Recommendation per fired diagnosis. Never writes to disk.

Invoked from the capability prompt as:

    python3 scripts/tune.py --findings-path /path/to/findings.json [--reference-path ...] [--workflow-path ...]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from lib.diagnoses import Diagnosis, DiagnosisContext, run_all_diagnoses
from lib.findings_loader import Findings, FindingsValidationError, parse_findings


class TuneError(Exception):
    """Raised when tune cannot proceed (no input supplied, invalid findings, etc.)."""


@dataclass(frozen=True)
class TuneInputs:
    false_positive_titles: tuple[str, ...] = ()
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
    text: str
    if inputs.findings_text is not None:
        text = inputs.findings_text
    elif inputs.findings_path is not None:
        try:
            text = Path(inputs.findings_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise TuneError(f"failed to read findings file '{inputs.findings_path}': {exc}") from exc
    else:
        raise TuneError("supply either findings_path or findings_text")
    try:
        return parse_findings(text)
    except FindingsValidationError as exc:
        raise TuneError(str(exc)) from exc


def _normalize_title(title: str) -> str:
    return " ".join(title.casefold().split())


def _validate_false_positive_titles(findings: Findings, titles: tuple[str, ...]) -> tuple[str, ...]:
    normalized_to_title = {_normalize_title(finding.title): finding.title for finding in findings.findings}
    out: list[str] = []
    missing: list[str] = []
    seen: set[str] = set()
    for raw in titles:
        title = raw.strip()
        if title == "":
            continue
        key = _normalize_title(title)
        if key not in normalized_to_title:
            missing.append(title)
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized_to_title[key])
    if missing:
        available = "; ".join(finding.title for finding in findings.findings)
        requested = "; ".join(missing)
        raise TuneError(
            "false-positive title(s) not found in findings.json: "
            f"{requested}. Pass the finding title exactly as retained in the artifact. Available titles: {available}"
        )
    return tuple(out)


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
            "No diagnoses fired. No confirmed false positives were supplied, the verdict is well-calibrated, the P3 surface is below the noise threshold, and the summary contains no truncation banner. No changes recommended."
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
    false_positive_titles = _validate_false_positive_titles(findings, inputs.false_positive_titles)
    ctx = DiagnosisContext(
        false_positive_titles=false_positive_titles,
        reference_path=inputs.reference_path or DiagnosisContext().reference_path,
        workflow_path=inputs.workflow_path or DiagnosisContext().workflow_path,
    )
    diagnoses = run_all_diagnoses(findings, ctx)
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
        help=(
            "Path to the consumer's current review-reference file (optional context for the "
            "rationale strings). The action's `review-reference-file` input accepts any "
            "workspace-relative path; pass whichever location your repo uses."
        ),
    )
    parser.add_argument(
        "--workflow-path",
        default=None,
        help=(
            "Path to the consumer's current workflow file (optional context). The codex-review "
            "workflow may live anywhere under .github/workflows/; pass whichever filename your repo uses."
        ),
    )
    parser.add_argument(
        "--false-positive-title",
        action="append",
        default=[],
        help=(
            "Exact title of a finding the integrator confirmed is a false positive. "
            "Repeat for multiple findings; titles are matched case-insensitively after whitespace normalization."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of Markdown output.",
    )
    return parser


def _outputs_to_json(out: TuneOutputs) -> str:
    return json.dumps(
        {
            "diagnoses": [
                {
                    "kind": diagnosis.kind,
                    "recommendations": [
                        {
                            "contributing_findings": list(rec.contributing_findings),
                            "diff": rec.diff,
                            "kind": rec.kind,
                            "rationale": rec.rationale,
                            "target": rec.target,
                        }
                        for rec in diagnosis.recommendations
                    ],
                    "triggered": diagnosis.triggered,
                }
                for diagnosis in out.diagnoses
            ],
            "report": out.report,
            "verdict": {
                "overall_confidence_score": out.findings.overall_confidence_score,
                "overall_correctness": out.findings.overall_correctness,
                "total_findings": len(out.findings.findings),
            },
        },
        indent=2,
    )


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        out = run_tune(
            TuneInputs(
                findings_path=args.findings_path,
                false_positive_titles=tuple(args.false_positive_title),
                reference_path=args.reference_path,
                workflow_path=args.workflow_path,
            )
        )
    except TuneError as exc:
        print(f"tune failed: {exc}", file=sys.stderr)
        return 1
    print(_outputs_to_json(out) if args.json else out.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
