"""Unit tests for the three diagnoses in lib.diagnoses."""

from __future__ import annotations

import unittest
from pathlib import Path

from lib.diagnoses import DiagnosisContext
from lib.diagnoses.low_confidence import low_confidence_diagnosis
from lib.diagnoses.noisy_p3 import noisy_p3_diagnosis
from lib.diagnoses.truncation import truncation_diagnosis
from lib.findings_loader import Findings, parse_findings

_HERE = Path(__file__).resolve().parent
_FIXTURES = _HERE / "__fixtures__" / "findings-examples"


def _load(name: str) -> Findings:
    return parse_findings((_FIXTURES / name).read_text(encoding="utf-8"))


def _ctx() -> DiagnosisContext:
    return DiagnosisContext()


class LowConfidenceTests(unittest.TestCase):
    def test_triggers_on_low_confidence_fixture(self) -> None:
        out = low_confidence_diagnosis(_load("low-confidence-verdict.json"), _ctx())
        self.assertTrue(out.triggered)
        rec = out.recommendations[0]
        self.assertEqual(rec.target, "reference-file")
        self.assertIn("Calibration", rec.diff)

    def test_does_not_trigger_on_high_confidence(self) -> None:
        self.assertFalse(low_confidence_diagnosis(_load("noisy-p3.json"), _ctx()).triggered)

    def test_diff_uses_supplied_reference_path(self) -> None:
        custom = DiagnosisContext(reference_path=".codex/policy.md", workflow_path=".github/workflows/code-review.yaml")
        out = low_confidence_diagnosis(_load("low-confidence-verdict.json"), custom)
        rec = out.recommendations[0]
        self.assertIn("--- a/.codex/policy.md", rec.diff)
        self.assertIn("+++ b/.codex/policy.md", rec.diff)
        self.assertNotIn(".github/codex/review-reference.md", rec.diff)

    def test_diff_uses_placeholder_when_no_path_supplied(self) -> None:
        out = low_confidence_diagnosis(_load("low-confidence-verdict.json"), _ctx())
        rec = out.recommendations[0]
        self.assertIn("<your-review-reference-path>", rec.diff)


class NoisyP3Tests(unittest.TestCase):
    def test_triggers_on_noisy_fixture(self) -> None:
        out = noisy_p3_diagnosis(_load("noisy-p3.json"), _ctx())
        self.assertTrue(out.triggered)
        rec = out.recommendations[0]
        self.assertEqual(rec.target, "workflow")
        self.assertRegex(rec.diff, r"min-confidence:")

    def test_does_not_trigger_on_quiet_diff(self) -> None:
        self.assertFalse(noisy_p3_diagnosis(_load("low-confidence-verdict.json"), _ctx()).triggered)

    def test_diff_uses_supplied_workflow_path(self) -> None:
        custom = DiagnosisContext(reference_path=".codex/policy.md", workflow_path=".github/workflows/code-review.yaml")
        out = noisy_p3_diagnosis(_load("noisy-p3.json"), custom)
        rec = out.recommendations[0]
        self.assertIn("--- a/.github/workflows/code-review.yaml", rec.diff)
        self.assertIn("+++ b/.github/workflows/code-review.yaml", rec.diff)


class TruncationTests(unittest.TestCase):
    def test_triggers_on_truncation_summary(self) -> None:
        out = truncation_diagnosis(_load("truncation.json"), _ctx())
        self.assertTrue(out.triggered)
        self.assertRegex(out.recommendations[0].diff, r"max-chunk-bytes")

    def test_does_not_trigger_on_clean_summary(self) -> None:
        self.assertFalse(truncation_diagnosis(_load("noisy-p3.json"), _ctx()).triggered)

    def test_diff_uses_supplied_workflow_path(self) -> None:
        custom = DiagnosisContext(reference_path=".codex/policy.md", workflow_path=".github/workflows/code-review.yaml")
        out = truncation_diagnosis(_load("truncation.json"), custom)
        rec = out.recommendations[0]
        self.assertIn("--- a/.github/workflows/code-review.yaml", rec.diff)


if __name__ == "__main__":
    unittest.main()
