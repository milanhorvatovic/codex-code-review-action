"""Unit tests for the adopt capability."""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from lib.pin_resolver import GhResult, PinResolution

from adopt import AdoptError, AdoptInputs, main as adopt_main, run_adopt

_HERE = Path(__file__).resolve().parent
_FIXTURE_REPO = _HERE / "__fixtures__" / "codex-review-action"
_BASELINE_PATH = _FIXTURE_REPO / "defaults" / "review-reference.md"
_SHA = "0fc55cdd3d5cf9841c9ba58822354f67b6c63293"
_TAG = "v2.1.0"


def _gh_returning_baseline(content: str):  # type: ignore[no-untyped-def]
    """Build a GhExec stub that returns a fixed baseline for the contents fetch."""

    def _exec(args: tuple[str, ...]) -> GhResult:
        if args[0] == "api" and "/contents/defaults/review-reference.md" in args[1]:
            return GhResult(code=0, stderr="", stdout=content)
        return GhResult(code=1, stderr=f"unmocked: {args}", stdout="")

    return _exec


def _baseline() -> str:
    return _BASELINE_PATH.read_text(encoding="utf-8")


def _default_inputs(**overrides) -> AdoptInputs:  # type: ignore[no-untyped-def]
    base = {
        "allow_users": "alice",
        "dry_run": True,
        "pin": PinResolution(sha=_SHA, tag=_TAG),
        "reference_baseline_path": str(_BASELINE_PATH),
        "target_repo": str(_FIXTURE_REPO),
    }
    base.update(overrides)
    return AdoptInputs(**base)


class AdoptTests(unittest.TestCase):
    def test_emits_workflow_passing_every_cc_invariant(self) -> None:
        out = run_adopt(
            _default_inputs(allow_users="milanhorvatovic", project_name="codex-ai-code-review-action")
        )
        self.assertIn("CC-01", out.invariants_report)
        self.assertNotRegex(out.invariants_report, r"^✗")

    def test_pin_comments_present_on_every_uses_line(self) -> None:
        out = run_adopt(_default_inputs())
        for sub in ("prepare", "review", "publish"):
            self.assertRegex(
                out.workflow,
                rf"{sub}@0fc55cdd3d5cf9841c9ba58822354f67b6c63293 # v2\.1\.0",
            )

    def test_workflow_does_not_wire_review_reference_file(self) -> None:
        out = run_adopt(_default_inputs())
        self.assertNotRegex(out.workflow, r"review-reference-file:")

    def test_starter_reference_file_includes_consent_guidance(self) -> None:
        out = run_adopt(_default_inputs())
        self.assertIn("not wired into the workflow", out.reference_file.lower())
        self.assertRegex(out.reference_file, r"### JavaScript / TypeScript")

    def test_adoption_report_maps_decisions_to_cc_ids(self) -> None:
        out = run_adopt(_default_inputs())
        self.assertIn("# Adoption report", out.adoption_report)
        for invariant_id in ("CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08", "CC-09"):
            self.assertIn(invariant_id, out.adoption_report)

    def test_writes_default_to_canonical_paths(self) -> None:
        out = run_adopt(_default_inputs())
        paths = sorted(entry.path for entry in out.writes)
        self.assertEqual(
            paths,
            [
                ".github/codex/review-reference.md",
                ".github/workflows/codex-review.yaml",
                "ADOPTION.md",
            ],
        )

    def test_writes_honor_path_overrides(self) -> None:
        out = run_adopt(
            _default_inputs(
                workflow_path=".github/workflows/code-review.yaml",
                reference_path=".codex/policy.md",
                report_path="docs/codex-adoption.md",
            )
        )
        paths = sorted(entry.path for entry in out.writes)
        self.assertEqual(
            paths,
            [
                ".codex/policy.md",
                ".github/workflows/code-review.yaml",
                "docs/codex-adoption.md",
            ],
        )

    def test_rejects_output_paths_outside_target_repo(self) -> None:
        with self.assertRaisesRegex(AdoptError, r"must not contain '\.\.'"):
            run_adopt(_default_inputs(workflow_path="../codex-review.yaml"))
        with self.assertRaisesRegex(AdoptError, "reference path must be repository-relative"):
            run_adopt(_default_inputs(reference_path="/tmp/review-reference.md"))

    def test_rejects_workflow_paths_outside_github_workflows(self) -> None:
        with self.assertRaisesRegex(AdoptError, r"under \.github/workflows/"):
            run_adopt(_default_inputs(workflow_path="docs/codex-review.yaml"))

    def test_adoption_report_flags_bare_action_with_tag_pin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workflows = root / ".github" / "workflows"
            workflows.mkdir(parents=True)
            (workflows / "legacy.yaml").write_text(
                "jobs:\n  review:\n    steps:\n      - uses: milanhorvatovic/codex-ai-code-review-action@v2\n",
                encoding="utf-8",
            )
            out = run_adopt(_default_inputs(target_repo=str(root)))
        self.assertIn("Bare-action remediation", out.adoption_report)
        self.assertIn("legacy.yaml", out.adoption_report)

    def test_adoption_report_documents_the_chosen_paths(self) -> None:
        out = run_adopt(
            _default_inputs(
                workflow_path=".github/workflows/code-review.yaml",
                reference_path=".codex/policy.md",
                report_path="docs/codex-adoption.md",
            )
        )
        self.assertIn(".codex/policy.md", out.adoption_report)
        self.assertIn("docs/codex-adoption.md", out.adoption_report)
        self.assertIn("code-review.yaml", out.adoption_report)

    def test_dry_run_does_not_touch_target_repo(self) -> None:
        # The fixture pre-commits a dogfood workflow; record its content before the run and
        # confirm the dry-run leaves it byte-identical. The two new artifacts (ADOPTION.md
        # and the starter reference file) must NOT appear in the working tree.
        existing_workflow = (_FIXTURE_REPO / ".github/workflows/codex-review.yaml").read_text(encoding="utf-8")
        run_adopt(_default_inputs())
        self.assertEqual(
            (_FIXTURE_REPO / ".github/workflows/codex-review.yaml").read_text(encoding="utf-8"),
            existing_workflow,
        )
        for relative in (".github/codex/review-reference.md", "ADOPTION.md"):
            self.assertFalse((_FIXTURE_REPO / relative).exists(), f"unexpected file written: {relative}")

    def test_runtime_baseline_fetch_is_used_when_no_local_override(self) -> None:
        # When --reference-baseline-path is not supplied the script must fetch the baseline
        # from the action repo via gh api. Use a stub that returns the fixture's baseline.
        gh = _gh_returning_baseline(_baseline())
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
                # NOTE: reference_baseline_path is None
            ),
            gh=gh,
        )
        self.assertRegex(out.reference_file, r"### JavaScript / TypeScript")

    def test_write_refuses_existing_outputs_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workflow = root / ".github" / "workflows" / "codex-review.yaml"
            workflow.parent.mkdir(parents=True)
            workflow.write_text("existing workflow\n", encoding="utf-8")

            with self.assertRaisesRegex(AdoptError, "refusing to overwrite"):
                run_adopt(_default_inputs(target_repo=str(root), dry_run=False))

            self.assertEqual(workflow.read_text(encoding="utf-8"), "existing workflow\n")
            self.assertFalse((root / "ADOPTION.md").exists())
            self.assertFalse((root / ".github" / "codex" / "review-reference.md").exists())

    def test_write_allows_overwrite_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workflow = root / ".github" / "workflows" / "codex-review.yaml"
            workflow.parent.mkdir(parents=True)
            workflow.write_text("existing workflow\n", encoding="utf-8")

            run_adopt(_default_inputs(target_repo=str(root), dry_run=False, overwrite=True))

            self.assertIn("milanhorvatovic/codex-ai-code-review-action/prepare", workflow.read_text(encoding="utf-8"))
            self.assertTrue((root / "ADOPTION.md").is_file())
            self.assertTrue((root / ".github" / "codex" / "review-reference.md").is_file())

    def test_cli_json_output_is_machine_readable(self) -> None:
        stdout = io.StringIO()
        args = [
            "--target-repo",
            str(_FIXTURE_REPO),
            "--pin-sha",
            _SHA,
            "--pin-tag",
            _TAG,
            "--reference-baseline-path",
            str(_BASELINE_PATH),
            "--json",
        ]

        with contextlib.redirect_stdout(stdout):
            code = adopt_main(args)

        self.assertEqual(code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["wrote"])
        self.assertIn("workflow", payload)
        self.assertIn("reference_file", payload)
        self.assertEqual(
            sorted(entry["path"] for entry in payload["writes"]),
            [
                ".github/codex/review-reference.md",
                ".github/workflows/codex-review.yaml",
                "ADOPTION.md",
            ],
        )


if __name__ == "__main__":
    unittest.main()
