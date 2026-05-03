"""Unit tests for lib.findings_loader."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from .findings_loader import FindingsValidationError, parse_findings

_HERE = Path(__file__).resolve().parent
_FIXTURES = _HERE.parent / "__fixtures__" / "findings-examples"


def _load_text(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


class ParseFindingsTests(unittest.TestCase):
    def test_low_confidence_fixture(self) -> None:
        parsed = parse_findings(_load_text("low-confidence-verdict.json"))
        self.assertEqual(parsed.overall_correctness, "patch is correct")
        self.assertEqual(len(parsed.findings), 2)

    def test_noisy_p3_fixture(self) -> None:
        parsed = parse_findings(_load_text("noisy-p3.json"))
        self.assertTrue(all(finding.priority == 3 for finding in parsed.findings))

    def test_truncation_fixture(self) -> None:
        parsed = parse_findings(_load_text("truncation.json"))
        self.assertIn("incomplete review", parsed.summary.lower())

    def test_rejects_out_of_range_confidence(self) -> None:
        with self.assertRaises(FindingsValidationError):
            parse_findings(
                json.dumps(
                    {
                        "changes": [],
                        "effort": None,
                        "files": [],
                        "findings": [
                            {
                                "body": "x",
                                "confidence_score": 1.5,
                                "line": 1,
                                "path": "x",
                                "priority": 1,
                                "reasoning": "x",
                                "start_line": None,
                                "suggestion": None,
                                "title": "x",
                            }
                        ],
                        "model": "x",
                        "overall_confidence_score": 0.5,
                        "overall_correctness": "patch is correct",
                        "summary": "x",
                    }
                )
            )

    def test_rejects_unknown_overall_correctness(self) -> None:
        with self.assertRaisesRegex(FindingsValidationError, "overall_correctness"):
            parse_findings(
                json.dumps(
                    {
                        "changes": [],
                        "effort": None,
                        "files": [],
                        "findings": [],
                        "model": "x",
                        "overall_confidence_score": 0.5,
                        "overall_correctness": "unknown",
                        "summary": "x",
                    }
                )
            )

    def test_rejects_malformed_json(self) -> None:
        with self.assertRaisesRegex(FindingsValidationError, "not valid JSON"):
            parse_findings("{not json")


if __name__ == "__main__":
    unittest.main()
