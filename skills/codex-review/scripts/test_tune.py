"""Unit tests for the tune capability."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tune import TuneError, TuneInputs, run_tune

_HERE = Path(__file__).resolve().parent
_FIXTURES = _HERE.parent / "__fixtures__" / "findings-examples"


class TuneTests(unittest.TestCase):
    def test_low_confidence_diagnosis_fires(self) -> None:
        out = run_tune(TuneInputs(findings_path=str(_FIXTURES / "low-confidence-verdict.json")))
        fired = sorted(d.kind for d in out.diagnoses if d.triggered)
        self.assertIn("low-confidence", fired)
        self.assertIn("Recommendation: low-confidence", out.report)
        self.assertIn("```diff", out.report)

    def test_noisy_p3_diagnosis_fires(self) -> None:
        out = run_tune(TuneInputs(findings_path=str(_FIXTURES / "noisy-p3.json")))
        fired = sorted(d.kind for d in out.diagnoses if d.triggered)
        self.assertIn("noisy-p3", fired)
        self.assertRegex(out.report, r"min-confidence:")

    def test_truncation_diagnosis_fires(self) -> None:
        out = run_tune(TuneInputs(findings_path=str(_FIXTURES / "truncation.json")))
        fired = sorted(d.kind for d in out.diagnoses if d.triggered)
        self.assertIn("truncation", fired)
        self.assertRegex(out.report, r"max-chunk-bytes")

    def test_clean_verdict_reports_no_diagnoses_fired(self) -> None:
        clean_findings = json.dumps(
            {
                "changes": ["small refactor"],
                "effort": "low",
                "files": [{"description": "rename", "path": "x.ts"}],
                "findings": [],
                "model": "gpt-5",
                "overall_confidence_score": 0.97,
                "overall_correctness": "patch is correct",
                "summary": "Tidy refactor; no concerns.",
            }
        )
        out = run_tune(TuneInputs(findings_text=clean_findings))
        self.assertIn("No diagnoses fired", out.report)

    def test_no_input_raises(self) -> None:
        with self.assertRaises(TuneError):
            run_tune(TuneInputs())


if __name__ == "__main__":
    unittest.main()
