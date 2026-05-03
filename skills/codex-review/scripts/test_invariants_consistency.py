"""Consistency check between references/invariants.md and docs/consumer-controls.md.

Asserts every CC-NN ID in invariants.md has a matching numbered heading in
the upstream consumer-controls doc, so a renumbering or rename in either
file forces the other to update.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SKILL_ROOT = _HERE.parent
_REPO_ROOT = _SKILL_ROOT.parent.parent

_INVARIANTS_PATH = _SKILL_ROOT / "references" / "invariants.md"
_CONSUMER_CONTROLS_PATH = _REPO_ROOT / "docs" / "consumer-controls.md"

_ID_RE = re.compile(r"\| (CC-\d{2}) \|")
_HEADING_RE = re.compile(r"^### (\d+)\. ", re.MULTILINE)


def _read_ids() -> list[str]:
    text = _INVARIANTS_PATH.read_text(encoding="utf-8")
    return sorted({match.group(1) for match in _ID_RE.finditer(text)})


def _read_heading_numbers() -> list[int]:
    text = _CONSUMER_CONTROLS_PATH.read_text(encoding="utf-8")
    return sorted({int(match.group(1)) for match in _HEADING_RE.finditer(text)})


class InvariantsConsistencyTests(unittest.TestCase):
    def test_invariants_md_encodes_cc01_through_cc09(self) -> None:
        self.assertEqual(
            _read_ids(),
            ["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08", "CC-09"],
        )

    def test_consumer_controls_doc_numbers_items_1_through_9(self) -> None:
        numbers = _read_heading_numbers()
        for expected in range(1, 10):
            self.assertIn(expected, numbers)

    def test_each_cc_id_has_matching_numbered_heading(self) -> None:
        heading_numbers = set(_read_heading_numbers())
        for invariant_id in _read_ids():
            number = int(invariant_id.split("-")[1])
            self.assertIn(number, heading_numbers, f"missing '### {number}.' heading for {invariant_id}")


if __name__ == "__main__":
    unittest.main()
