"""Deterministic glue for the codex-review:adopt capability.

Composes a hardened workflow YAML, a starter review-reference, and an
ADOPTION report. Refuses to write any artifact unless every CC-NN invariant
passes against the emitted workflow.

All three output paths plus the layering baseline are configurable. The
skill does not assume the integrator wants the workflow at
`.github/workflows/codex-review.yaml`, the reference at
`.github/codex/review-reference.md`, or the report at `ADOPTION.md` — those
are the defaults; the integrator overrides any of them via flags. Likewise
for the action's own `review-reference-file` input, which accepts any
workspace-relative path subject to the action's safety constraints.

Invoked from the capability prompt as:

    python3 scripts/adopt.py --target-repo /path/to/repo [flags]

See `--help` for the full flag list.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath

from lib.baseline_fetcher import (
    BaselineFetchError,
    fetch_baseline_from_action,
    load_baseline_from_path,
)
from lib.detect import DetectOptions, Language, detect, make_filesystem_reader
from lib.invariants import assert_workflow, format_report
from lib.pin_resolver import GhExec, PinResolution, PinResolutionError, default_gh, resolve_pin
from lib.reference_layerer import LayerOptions, layer_reference
from lib.workflow_templates import WorkflowTemplateOptions, render_hardened_workflow

DEFAULT_WORKFLOW_PATH = ".github/workflows/codex-review.yaml"
DEFAULT_REFERENCE_PATH = ".github/codex/review-reference.md"
DEFAULT_REPORT_PATH = "ADOPTION.md"


class AdoptError(Exception):
    """Raised when adopt cannot complete (pin resolution failed, invariants failed, etc.)."""


_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")


@dataclass(frozen=True)
class AdoptInputs:
    allow_users: str = ""
    dry_run: bool = True
    pin: PinResolution | None = None
    project_name: str | None = None
    reference_baseline_path: str | None = None
    reference_path: str = DEFAULT_REFERENCE_PATH
    report_path: str = DEFAULT_REPORT_PATH
    target_repo: str | None = None
    workflow_path: str = DEFAULT_WORKFLOW_PATH


@dataclass(frozen=True)
class WriteEntry:
    content: str
    path: str


@dataclass(frozen=True)
class AdoptOutputs:
    adoption_report: str
    invariants_report: str
    reference_file: str
    workflow: str
    writes: tuple[WriteEntry, ...]


@dataclass(frozen=True)
class _BareActionResult:
    found: bool
    locations: tuple[str, ...] = ()


def _pick_project_name(target_repo: str, override: str | None) -> str:
    if override is not None and override:
        return override
    parts = [part for part in target_repo.split("/") if part]
    return parts[-1] if parts else "repo"


def _normalize_repo_relative_path(raw_path: str, *, label: str) -> str:
    raw = raw_path.strip()
    if raw == "":
        raise AdoptError(f"{label} must not be empty")
    if "\x00" in raw:
        raise AdoptError(f"{label} contains a NUL byte")
    if Path(raw).is_absolute() or PureWindowsPath(raw).is_absolute():
        raise AdoptError(f"{label} must be repository-relative; got absolute path '{raw_path}'")
    normalized = PurePosixPath(raw.replace("\\", "/"))
    if normalized == PurePosixPath("."):
        raise AdoptError(f"{label} must name a file inside the repository")
    if any(part == ".." for part in normalized.parts):
        raise AdoptError(f"{label} must not contain '..' path segments: '{raw_path}'")
    if raw.endswith(("/", "\\")):
        raise AdoptError(f"{label} must name a file, not a directory: '{raw_path}'")
    return normalized.as_posix()


def _normalize_workflow_path(raw_path: str) -> str:
    path = _normalize_repo_relative_path(raw_path, label="workflow path")
    if not path.startswith(".github/workflows/"):
        raise AdoptError("workflow path must live under .github/workflows/ so GitHub Actions can discover it")
    if not path.endswith((".yaml", ".yml")):
        raise AdoptError("workflow path must end with .yaml or .yml")
    return path


def _destination_inside_repo(target_repo: Path, relative_path: str) -> Path:
    root = target_repo.resolve(strict=True)
    destination = (root / relative_path).resolve(strict=False)
    try:
        destination.relative_to(root)
    except ValueError as exc:
        raise AdoptError(f"output path '{relative_path}' resolves outside the target repository") from exc
    return destination


def _detect_bare_action(target_repo: Path) -> _BareActionResult:
    workflows_dir = target_repo / ".github" / "workflows"
    if not workflows_dir.is_dir():
        return _BareActionResult(found=False)
    locations: list[str] = []
    pattern = re.compile(r"milanhorvatovic/codex-ai-code-review-action@[^\s#'\"]+")
    for path in sorted(workflows_dir.iterdir()):
        if not path.is_file():
            continue
        if not path.name.endswith((".yaml", ".yml")):
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            locations.append(f".github/workflows/{path.name}")
    return _BareActionResult(found=bool(locations), locations=tuple(locations))


def _load_baseline(
    *,
    gh: GhExec,
    pin: PinResolution,
    override_path: str | None,
) -> str:
    if override_path is not None:
        try:
            return load_baseline_from_path(override_path)
        except BaselineFetchError as exc:
            raise AdoptError(str(exc)) from exc
    try:
        return fetch_baseline_from_action(gh, pin.sha)
    except BaselineFetchError as exc:
        raise AdoptError(
            f"failed to fetch the baseline review-reference from the action repo at {pin.sha}: {exc}\n"
            "If you have the file staged locally, pass --reference-baseline-path to skip the fetch."
        ) from exc


@dataclass
class _ReportContext:
    allow_users: str
    bare_action: _BareActionResult
    facts: object
    invariants_report: str
    pin: PinResolution
    project_name: str
    reference_path: str
    report_path: str
    workflow_path: str


def _render_adoption_report(ctx: _ReportContext) -> str:
    facts = ctx.facts  # type: ignore[assignment]
    languages = ", ".join(getattr(facts, "languages", ())) or "(none detected)"
    package_managers = ", ".join(getattr(facts, "package_managers", ())) or "(none)"
    ci_provider = getattr(facts, "ci_provider", "none")
    has_existing = getattr(facts, "has_codex_review_workflow", False)

    lines: list[str] = []
    lines.append(f"# Adoption report — {ctx.project_name}")
    lines.append("")
    lines.append("> Generated by `codex-review:adopt`. Review before committing.")
    lines.append("")
    lines.append("## Resolved pin")
    lines.append("")
    lines.append(f"- Tag: `{ctx.pin.tag}`")
    lines.append(f"- SHA: `{ctx.pin.sha}`")
    lines.append("")
    lines.append("## Output paths")
    lines.append("")
    lines.append(f"- Workflow: `{ctx.workflow_path}` (override with `--workflow-path`)")
    lines.append(f"- Starter reference: `{ctx.reference_path}` (override with `--reference-path`)")
    lines.append(f"- This report: `{ctx.report_path}` (override with `--report-path`)")
    lines.append("")
    lines.append("## Detection summary")
    lines.append("")
    lines.append(f"- Languages: {languages}")
    lines.append(f"- Package managers: {package_managers}")
    lines.append(f"- CI provider: {ci_provider}")
    existing_marker = "yes (will overwrite on dry-run: false)" if has_existing else "no"
    lines.append(f"- Existing codex-review workflow: {existing_marker}")
    lines.append("")
    if ctx.bare_action.found:
        lines.append("## Bare-action remediation")
        lines.append("")
        lines.append("The following workflow files reference the bare action and must be rewritten to the three sub-actions:")
        for location in ctx.bare_action.locations:
            lines.append(f"- `{location}`")
        lines.append("")
    lines.append("## Decisions and consumer-controls invariants")
    lines.append("")
    lines.append(f"- `allow-users`: `{ctx.allow_users or '(empty)'}` — scopes who can trigger the prepare step.")
    lines.append("- Trigger: `pull_request` (CC-02).")
    lines.append("- Same-repo gate on every job: yes (CC-03).")
    lines.append("- Environment scoping for `OPENAI_API_KEY`: `codex-review` on the review job only (CC-04).")
    lines.append("- `prepare`/`review` permissions: `contents: read` only (CC-05).")
    lines.append("- `publish` permissions: `contents: read` + `pull-requests: write` (CC-06).")
    lines.append('- `retain-findings`: `"false"` explicit (CC-07).')
    lines.append('- `fail-on-missing-chunks`: `"true"` (CC-08; assumes pinned action ≥ v2.1.0).')
    lines.append("- `review-reference-file`: NOT wired into the workflow (CC-09; starter file emitted but unwired pending issue #97).")
    lines.append("")
    lines.append("## Invariants assertion result")
    lines.append("")
    lines.append("```")
    lines.append(ctx.invariants_report)
    lines.append("```")
    lines.append("")
    lines.append("## Open question")
    lines.append("")
    lines.append(
        "If your repository explicitly accepts that same-repo PR authors can edit the review-reference and steer the review prompt of their own PR, you can wire the file by adding a `# workspace-mode accepted by ...` comment on the prepare step's `with:` block plus a `review-reference-file: <your-path>` line. The action input accepts any workspace-relative path subject to its safety constraints (no symlinks, no traversal, ≤ 64 KiB, regular file). Otherwise wait for [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97)."
    )
    lines.append("")
    return "\n".join(lines)


def run_adopt(inputs: AdoptInputs, gh: GhExec | None = None) -> AdoptOutputs:
    target_repo_str = inputs.target_repo or str(Path.cwd())
    target_repo = Path(target_repo_str)
    if not target_repo.is_dir():
        raise AdoptError(f"target repo path '{target_repo}' does not exist or is not a directory")
    workflow_path = _normalize_workflow_path(inputs.workflow_path)
    reference_path = _normalize_repo_relative_path(inputs.reference_path, label="reference path")
    report_path = _normalize_repo_relative_path(inputs.report_path, label="report path")
    gh_exec = gh or default_gh()
    try:
        pin = inputs.pin if inputs.pin is not None else resolve_pin(gh_exec)
    except PinResolutionError as exc:
        raise AdoptError(str(exc)) from exc
    project_name = _pick_project_name(target_repo_str, inputs.project_name)

    reader = make_filesystem_reader(str(target_repo))
    facts = detect(reader, DetectOptions())
    bare_action = _detect_bare_action(target_repo)

    try:
        workflow = render_hardened_workflow(
            WorkflowTemplateOptions(allow_users=inputs.allow_users, pin_sha=pin.sha, pin_tag=pin.tag)
        )
    except ValueError as exc:
        raise AdoptError(str(exc)) from exc
    report = assert_workflow(workflow, action_version=pin.tag)
    if not report.ok:
        raise AdoptError(
            "emitted workflow failed consumer-controls invariants:\n" + format_report(report)
        )

    languages: tuple[Language, ...] = facts.languages or ("javascript",)
    baseline = _load_baseline(
        gh=gh_exec,
        pin=pin,
        override_path=inputs.reference_baseline_path,
    )
    reference_file = layer_reference(
        baseline,
        LayerOptions(languages=languages, project_name=project_name),
    )

    invariants_report = format_report(report)
    adoption_report = _render_adoption_report(
        _ReportContext(
            allow_users=inputs.allow_users,
            bare_action=bare_action,
            facts=facts,
            invariants_report=invariants_report,
            pin=pin,
            project_name=project_name,
            reference_path=reference_path,
            report_path=report_path,
            workflow_path=workflow_path,
        )
    )

    writes = (
        WriteEntry(content=workflow, path=workflow_path),
        WriteEntry(content=reference_file, path=reference_path),
        WriteEntry(content=adoption_report, path=report_path),
    )

    if not inputs.dry_run:
        for entry in writes:
            destination = _destination_inside_repo(target_repo, entry.path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(entry.content, encoding="utf-8")

    return AdoptOutputs(
        adoption_report=adoption_report,
        invariants_report=invariants_report,
        reference_file=reference_file,
        workflow=workflow,
        writes=writes,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="adopt.py",
        description="Generate a hardened codex-review workflow + starter review-reference + ADOPTION report.",
    )
    parser.add_argument(
        "--target-repo",
        default=".",
        help="Path to the consumer's repository checkout (default: current directory).",
    )
    parser.add_argument(
        "--allow-users",
        default="",
        help="Comma-separated GitHub usernames for the prepare allowlist. Empty allows all same-repo PR authors.",
    )
    parser.add_argument(
        "--project-name",
        default=None,
        help="Project name shown in the starter reference file (default: target-repo's last path segment).",
    )
    parser.add_argument(
        "--workflow-path",
        default=DEFAULT_WORKFLOW_PATH,
        help=(
            "Where to write the emitted workflow file inside the target repository. "
            f"Default: {DEFAULT_WORKFLOW_PATH}. GitHub Actions only discovers workflows under .github/workflows/, "
            "so customizing the directory is unusual; renaming the file is fine."
        ),
    )
    parser.add_argument(
        "--reference-path",
        default=DEFAULT_REFERENCE_PATH,
        help=(
            "Where to write the starter review-reference inside the target repository. "
            f"Default: {DEFAULT_REFERENCE_PATH}. The action's `review-reference-file` input "
            "accepts any workspace-relative path; pick the location that fits your repo's layout."
        ),
    )
    parser.add_argument(
        "--report-path",
        default=DEFAULT_REPORT_PATH,
        help=(
            "Where to write the ADOPTION audit report inside the target repository. "
            f"Default: {DEFAULT_REPORT_PATH}."
        ),
    )
    parser.add_argument(
        "--reference-baseline-path",
        default=None,
        help=(
            "Optional path to a locally-staged copy of the action's defaults/review-reference.md "
            "to layer against. When omitted (default), the script fetches the file from the action "
            "repo at the resolved release SHA via gh api. Useful for offline runs or when pinning "
            "with a pre-approved SHA/tag pair."
        ),
    )
    parser.add_argument(
        "--pin-sha",
        default=None,
        help=(
            "Optional reviewed 40-character SHA to use instead of resolving releases/latest via gh. "
            "Must be passed together with --pin-tag."
        ),
    )
    parser.add_argument(
        "--pin-tag",
        default=None,
        help="Optional vX.Y.Z tag comment paired with --pin-sha for offline or pre-resolved runs.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write artifacts to the target repository's working tree. Default is dry-run.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    pin = None
    if (args.pin_sha is None) != (args.pin_tag is None):
        print("adopt failed: pass --pin-sha and --pin-tag together, or omit both", file=sys.stderr)
        return 1
    if args.pin_sha is not None and args.pin_tag is not None:
        if not _SHA_RE.match(args.pin_sha):
            print("adopt failed: --pin-sha must be a 40-character lowercase hex SHA", file=sys.stderr)
            return 1
        if not _TAG_RE.match(args.pin_tag):
            print("adopt failed: --pin-tag must look like vX.Y.Z", file=sys.stderr)
            return 1
        pin = PinResolution(sha=args.pin_sha, tag=args.pin_tag)
    inputs = AdoptInputs(
        allow_users=args.allow_users,
        dry_run=not args.write,
        pin=pin,
        project_name=args.project_name,
        reference_baseline_path=args.reference_baseline_path,
        reference_path=args.reference_path,
        report_path=args.report_path,
        target_repo=args.target_repo,
        workflow_path=args.workflow_path,
    )
    try:
        out = run_adopt(inputs)
    except AdoptError as exc:
        print(f"adopt failed: {exc}", file=sys.stderr)
        return 1
    if args.write:
        print(f"Wrote {len(out.writes)} artifact(s) under {Path(args.target_repo).resolve()}.")
        for entry in out.writes:
            print(f"  - {entry.path}")
    else:
        print("# === Workflow ===")
        print(out.workflow)
        print("# === Starter reference ===")
        print(out.reference_file)
        print("# === ADOPTION report ===")
        print(out.adoption_report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
