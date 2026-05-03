"""Unit tests for the adopt capability."""

from __future__ import annotations

import unittest
from pathlib import Path

from lib.pin_resolver import PinResolution

from adopt import AdoptInputs, run_adopt

_HERE = Path(__file__).resolve().parent
_FIXTURE_REPO = _HERE.parent / "__fixtures__" / "codex-review-action"
_SHA = "0fc55cdd3d5cf9841c9ba58822354f67b6c63293"
_TAG = "v2.1.0"


class AdoptTests(unittest.TestCase):
    def test_emits_workflow_passing_every_cc_invariant(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="milanhorvatovic",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                project_name="codex-ai-code-review-action",
                target_repo=str(_FIXTURE_REPO),
            )
        )
        self.assertIn("CC-01", out.invariants_report)
        self.assertNotRegex(out.invariants_report, r"^✗")

    def test_pin_comments_present_on_every_uses_line(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        for sub in ("prepare", "review", "publish"):
            self.assertRegex(
                out.workflow,
                rf"{sub}@0fc55cdd3d5cf9841c9ba58822354f67b6c63293 # v2\.1\.0",
            )

    def test_workflow_does_not_wire_review_reference_file(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        self.assertNotRegex(out.workflow, r"review-reference-file:")

    def test_starter_reference_file_includes_consent_guidance(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        self.assertIn("not wired into the workflow", out.reference_file.lower())
        self.assertRegex(out.reference_file, r"### JavaScript / TypeScript")

    def test_adoption_report_maps_decisions_to_cc_ids(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        self.assertIn("# Adoption report", out.adoption_report)
        for invariant_id in ("CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08", "CC-09"):
            self.assertIn(invariant_id, out.adoption_report)

    def test_writes_target_three_paths_in_consumer_tree(self) -> None:
        out = run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        paths = sorted(entry.path for entry in out.writes)
        self.assertEqual(
            paths,
            [
                ".github/codex/review-reference.md",
                ".github/workflows/codex-review.yaml",
                "ADOPTION.md",
            ],
        )

    def test_dry_run_does_not_touch_target_repo(self) -> None:
        # The fixture pre-commits a dogfood workflow; record its content before the run and
        # confirm the dry-run leaves it byte-identical. The two new artifacts (ADOPTION.md
        # and the starter reference file) must NOT appear in the working tree.
        existing_workflow = (_FIXTURE_REPO / ".github/workflows/codex-review.yaml").read_text(encoding="utf-8")
        run_adopt(
            AdoptInputs(
                allow_users="alice",
                dry_run=True,
                pin=PinResolution(sha=_SHA, tag=_TAG),
                target_repo=str(_FIXTURE_REPO),
            )
        )
        self.assertEqual(
            (_FIXTURE_REPO / ".github/workflows/codex-review.yaml").read_text(encoding="utf-8"),
            existing_workflow,
        )
        for relative in (".github/codex/review-reference.md", "ADOPTION.md"):
            self.assertFalse((_FIXTURE_REPO / relative).exists(), f"unexpected file written: {relative}")


if __name__ == "__main__":
    unittest.main()
