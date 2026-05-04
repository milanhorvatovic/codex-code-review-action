"""Unit tests for lib.pin_resolver."""

from __future__ import annotations

import unittest
from typing import Callable

from lib.pin_resolver import GhResult, PinResolutionError, resolve_pin


def _fake_gh(map_: dict[tuple[str, ...], GhResult]) -> Callable[[tuple[str, ...]], GhResult]:
    def _exec(args: tuple[str, ...]) -> GhResult:
        if args in map_:
            return map_[args]
        return GhResult(code=1, stderr=f"unmocked: {args}", stdout="")

    return _exec


_TAG_ARGS = ("api", "repos/milanhorvatovic/codex-ai-code-review-action/releases/latest", "--jq", ".tag_name")


class ResolvePinTests(unittest.TestCase):
    def test_returns_latest_tag_and_sha(self) -> None:
        gh = _fake_gh(
            {
                _TAG_ARGS: GhResult(code=0, stderr="", stdout="v2.1.0\n"),
                ("api", "repos/milanhorvatovic/codex-ai-code-review-action/commits/v2.1.0", "--jq", ".sha"): GhResult(
                    code=0, stderr="", stdout="1111111111111111111111111111111111111111\n"
                ),
            }
        )
        pin = resolve_pin(gh)
        self.assertEqual(pin.tag, "v2.1.0")
        self.assertEqual(pin.sha, "1111111111111111111111111111111111111111")

    def test_refuses_pre_release_tag(self) -> None:
        gh = _fake_gh({_TAG_ARGS: GhResult(code=0, stderr="", stdout="v2.1.0-rc.1\n")})
        with self.assertRaises(PinResolutionError):
            resolve_pin(gh)

    def test_refuses_malformed_tag(self) -> None:
        gh = _fake_gh({_TAG_ARGS: GhResult(code=0, stderr="", stdout="latest\n")})
        with self.assertRaisesRegex(PinResolutionError, "malformed tag"):
            resolve_pin(gh)

    def test_refuses_malformed_sha(self) -> None:
        gh = _fake_gh(
            {
                _TAG_ARGS: GhResult(code=0, stderr="", stdout="v2.1.0\n"),
                ("api", "repos/milanhorvatovic/codex-ai-code-review-action/commits/v2.1.0", "--jq", ".sha"): GhResult(
                    code=0, stderr="", stdout="abcd\n"
                ),
            }
        )
        with self.assertRaisesRegex(PinResolutionError, "malformed SHA"):
            resolve_pin(gh)

    def test_surfaces_non_zero_gh_exit(self) -> None:
        gh = _fake_gh({_TAG_ARGS: GhResult(code=1, stderr="401 Unauthorized", stdout="")})
        with self.assertRaisesRegex(PinResolutionError, r"releases/latest exited 1: 401 Unauthorized"):
            resolve_pin(gh)


if __name__ == "__main__":
    unittest.main()
