"""Unit tests for lib.invariants."""

from __future__ import annotations

import unittest
from pathlib import Path

from .invariants import assert_workflow, format_report

_HERE = Path(__file__).resolve().parent
_FIXTURE_WORKFLOW = (
    _HERE.parent
    / "__fixtures__"
    / "repos"
    / "codex-review-action"
    / ".github"
    / "workflows"
    / "codex-review.yaml"
)


def _read_fixture() -> str:
    return _FIXTURE_WORKFLOW.read_text(encoding="utf-8")


_BASE_WORKFLOW = """name: Codex code review

on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  prepare:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111

  review:
    needs: prepare
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: codex-review
    permissions:
      contents: read
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/review@1111111111111111111111111111111111111111
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}

  publish:
    needs: [prepare, review]
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/publish@1111111111111111111111111111111111111111
        with:
          retain-findings: "false"
          fail-on-missing-chunks: "true"
"""


def _outcome(report, invariant_id):  # type: ignore[no-untyped-def]
    for o in report.outcomes:
        if o.id == invariant_id:
            return o
    raise AssertionError(f"invariant {invariant_id} not in report")


class DogfoodFixtureTests(unittest.TestCase):
    def test_passes_cc01_through_cc07_and_cc09_on_v21_pre(self) -> None:
        report = assert_workflow(_read_fixture(), action_version="v2.1.0-pre")
        for invariant_id in ("CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-09", "CC-EXTRA-01-bare-action"):
            self.assertTrue(_outcome(report, invariant_id).ok, invariant_id)

    def test_cc08_passes_on_v21(self) -> None:
        report = assert_workflow(_read_fixture(), action_version="v2.1.0")
        self.assertTrue(_outcome(report, "CC-08").ok)

    def test_cc08_skipped_on_v20(self) -> None:
        report = assert_workflow(_read_fixture(), action_version="v2.0.0")
        outcome = _outcome(report, "CC-08")
        self.assertTrue(outcome.ok)
        self.assertIn("skipped", outcome.detail)


class FailureCaseTests(unittest.TestCase):
    def test_cc01_fails_when_sub_actions_disagree(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "/review@1111111111111111111111111111111111111111",
            "/review@2222222222222222222222222222222222222222",
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-01").ok)

    def test_cc02_fails_on_pull_request_target(self) -> None:
        broken = _BASE_WORKFLOW.replace("pull_request:", "pull_request_target:")
        self.assertFalse(_outcome(assert_workflow(broken), "CC-02").ok)

    def test_cc03_fails_when_a_job_omits_the_gate(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "  publish:\n    needs: [prepare, review]\n    if: github.event.pull_request.head.repo.full_name == github.repository",
            "  publish:\n    needs: [prepare, review]\n    if: always()",
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-03").ok)

    def test_cc04_fails_when_prepare_references_the_key(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
            (
                "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n"
                "        env:\n"
                "          KEY: ${{ secrets.OPENAI_API_KEY }}"
            ),
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-04").ok)

    def test_cc05_fails_when_prepare_requests_pr_write(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "  prepare:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read",
            "  prepare:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      pull-requests: write",
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-05").ok)

    def test_cc07_fails_without_consent_comment(self) -> None:
        broken = _BASE_WORKFLOW.replace('retain-findings: "false"', 'retain-findings: "true"')
        self.assertFalse(_outcome(assert_workflow(broken), "CC-07").ok)

    def test_cc07_passes_with_retention_approved_comment(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            'retain-findings: "false"',
            'retain-findings: "true" # retention approved by audit team',
        )
        self.assertTrue(_outcome(assert_workflow(broken), "CC-07").ok)

    def test_cc09_fails_when_wired_without_consent(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
            (
                "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n"
                "        with:\n"
                "          review-reference-file: .github/codex/review-reference.md"
            ),
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-09").ok)

    def test_cc09_passes_with_workspace_mode_accepted_comment(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
            (
                "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n"
                "        # workspace-mode accepted by maintainer\n"
                "        with:\n"
                "          review-reference-file: .github/codex/review-reference.md"
            ),
        )
        self.assertTrue(_outcome(assert_workflow(broken), "CC-09").ok)

    def test_bare_action_fails(self) -> None:
        broken = _BASE_WORKFLOW.replace(
            "milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
            "milanhorvatovic/codex-ai-code-review-action@1111111111111111111111111111111111111111",
        )
        self.assertFalse(_outcome(assert_workflow(broken), "CC-EXTRA-01-bare-action").ok)


class FormatReportTests(unittest.TestCase):
    def test_one_line_per_outcome(self) -> None:
        report = assert_workflow(_read_fixture(), action_version="v2.1.0")
        formatted = format_report(report)
        self.assertEqual(len(formatted.split("\n")), len(report.outcomes))
        self.assertIn("CC-01", formatted)


if __name__ == "__main__":
    unittest.main()
