"""Unit tests for lib.baseline_fetcher."""

from __future__ import annotations

import unittest
from pathlib import Path

from lib.baseline_fetcher import (
    BaselineFetchError,
    fetch_baseline_from_action,
    load_baseline_from_path,
)
from lib.pin_resolver import GhResult


def _stub(stdout: str = "", code: int = 0, stderr: str = ""):  # type: ignore[no-untyped-def]
    def _exec(args: tuple[str, ...]) -> GhResult:
        return GhResult(code=code, stderr=stderr, stdout=stdout)

    return _exec


class FetchBaselineFromActionTests(unittest.TestCase):
    def test_returns_stdout_when_gh_succeeds(self) -> None:
        gh = _stub(stdout="# Review reference\n\nhello\n")
        out = fetch_baseline_from_action(gh, "1111111111111111111111111111111111111111")
        self.assertIn("Review reference", out)

    def test_raises_when_gh_exits_non_zero(self) -> None:
        gh = _stub(code=1, stderr="404 Not Found")
        with self.assertRaisesRegex(BaselineFetchError, "404 Not Found"):
            fetch_baseline_from_action(gh, "1111111111111111111111111111111111111111")

    def test_raises_when_response_is_empty(self) -> None:
        gh = _stub(stdout="")
        with self.assertRaisesRegex(BaselineFetchError, "empty content"):
            fetch_baseline_from_action(gh, "1111111111111111111111111111111111111111")


class LoadBaselineFromPathTests(unittest.TestCase):
    def test_reads_an_existing_file(self) -> None:
        here = Path(__file__).resolve().parent
        baseline = here / "__fixtures__" / "codex-review-action" / "defaults" / "review-reference.md"
        self.assertTrue(baseline.exists(), "fixture defaults/review-reference.md is required")
        content = load_baseline_from_path(baseline)
        self.assertIn("Review reference", content)

    def test_raises_when_path_does_not_exist(self) -> None:
        with self.assertRaisesRegex(BaselineFetchError, "does not exist"):
            load_baseline_from_path("/no/such/path/review-reference.md")


if __name__ == "__main__":
    unittest.main()
