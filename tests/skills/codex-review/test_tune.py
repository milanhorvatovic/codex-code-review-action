"""Unit tests for the tune capability."""

from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path

from tune import TuneError, TuneInputs, main as tune_main, run_tune

_HERE = Path(__file__).resolve().parent
_FIXTURES = _HERE / "__fixtures__" / "findings-examples"


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

    def test_invalid_findings_raise_controlled_error(self) -> None:
        with self.assertRaisesRegex(TuneError, "missing top-level field"):
            run_tune(TuneInputs(findings_text="{}"))

    def test_path_overrides_propagate_into_diff_hunks(self) -> None:
        out = run_tune(
            TuneInputs(
                findings_path=str(_FIXTURES / "noisy-p3.json"),
                workflow_path=".github/workflows/code-review.yaml",
                reference_path=".codex/policy.md",
            )
        )
        # The noisy-p3 diff is workflow-targeted; verify the workflow path is honored.
        self.assertIn(".github/workflows/code-review.yaml", out.report)
        self.assertNotIn("<your-workflow-path>", out.report)

    def test_default_paths_render_as_placeholders(self) -> None:
        out = run_tune(TuneInputs(findings_path=str(_FIXTURES / "low-confidence-verdict.json")))
        # When no path is supplied, the diff hunks use placeholder text rather than lying about paths.
        self.assertIn("<your-review-reference-path>", out.report)

    def test_cli_json_output_is_machine_readable(self) -> None:
        stdout = io.StringIO()
        args = [
            "--findings-path",
            str(_FIXTURES / "noisy-p3.json"),
            "--workflow-path",
            ".github/workflows/code-review.yaml",
            "--json",
        ]

        with contextlib.redirect_stdout(stdout):
            code = tune_main(args)

        self.assertEqual(code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["verdict"]["total_findings"], 12)
        self.assertIn("report", payload)
        self.assertIn("diagnoses", payload)
        self.assertTrue(any(item["kind"] == "noisy-p3" and item["triggered"] for item in payload["diagnoses"]))


if __name__ == "__main__":
    unittest.main()
