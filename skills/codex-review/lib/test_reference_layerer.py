"""Unit tests for lib.reference_layerer."""

from __future__ import annotations

import unittest
from pathlib import Path

from .reference_layerer import LayerOptions, layer_reference, list_sections, pick_sections_for_languages

_HERE = Path(__file__).resolve().parent
_DEFAULTS_PATH = _HERE.parent.parent.parent / "defaults" / "review-reference.md"


def _defaults() -> str:
    return _DEFAULTS_PATH.read_text(encoding="utf-8")


class ListSectionsTests(unittest.TestCase):
    def test_enumerates_h3_sections(self) -> None:
        headings = [section.heading for section in list_sections(_defaults())]
        for expected in ("Python", "JavaScript / TypeScript", "Go", "YAML / Configuration"):
            self.assertIn(expected, headings)


class PickSectionsForLanguagesTests(unittest.TestCase):
    def test_python_only_plus_always_include(self) -> None:
        picked = [s.heading for s in pick_sections_for_languages(_defaults(), ("python",))]
        self.assertTrue(any(h.startswith("Python") for h in picked))
        self.assertTrue(any(h.startswith("YAML / Configuration") for h in picked))
        self.assertTrue(any(h.startswith("Markdown") for h in picked))
        self.assertFalse(any(h.startswith("Go") for h in picked))

    def test_typescript_repo(self) -> None:
        picked = [s.heading for s in pick_sections_for_languages(_defaults(), ("typescript",))]
        self.assertTrue(any(h.startswith("JavaScript / TypeScript") for h in picked))

    def test_polyglot_go_rust_shell(self) -> None:
        picked = [s.heading for s in pick_sections_for_languages(_defaults(), ("go", "rust", "shell"))]
        for expected in ("Go", "Rust", "Shell scripts"):
            self.assertTrue(any(h.startswith(expected) for h in picked), expected)


class LayerReferenceTests(unittest.TestCase):
    def test_emits_header_and_picked_sections(self) -> None:
        out = layer_reference(_defaults(), LayerOptions(languages=("typescript",), project_name="demo-repo"))
        self.assertIn("# Review reference — demo-repo", out)
        self.assertIn("not wired into the workflow", out.lower())
        self.assertIn("### JavaScript / TypeScript", out)

    def test_excludes_absent_languages(self) -> None:
        out = layer_reference(_defaults(), LayerOptions(languages=("python",), project_name="py-repo"))
        self.assertIn("### Python", out)
        self.assertNotIn("### Go", out)
        self.assertNotIn("### Rust", out)


if __name__ == "__main__":
    unittest.main()
