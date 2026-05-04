"""Resolve the latest reviewed action SHA + tag at runtime via gh.

No static pin table is shipped. The capability calls resolve_pin() once per
invocation; tests pass an in-memory GhExec so no network is touched.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from typing import Callable

ACTION_REPO = "milanhorvatovic/codex-ai-code-review-action"

_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_PRE_RELEASE = re.compile(r"-(rc|beta|alpha|pre|next)\b", re.IGNORECASE)
_TAG_PATTERN = re.compile(r"^v\d+\.\d+\.\d+$")


@dataclass(frozen=True)
class GhResult:
    code: int
    stderr: str
    stdout: str


type GhExec = Callable[[tuple[str, ...]], GhResult]


@dataclass(frozen=True)
class PinResolution:
    sha: str
    tag: str


class PinResolutionError(Exception):
    """Raised when the gh-driven pin resolution cannot proceed."""


def default_gh() -> GhExec:
    """Build a GhExec that shells out to the local `gh` binary."""

    def _exec(args: tuple[str, ...]) -> GhResult:
        try:
            result = subprocess.run(  # noqa: S603 - args are explicit, no shell expansion
                ["gh", *args],
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError:
            return GhResult(
                code=127,
                stderr="`gh` was not found on PATH. Install the GitHub CLI and run `gh auth status`.",
                stdout="",
            )
        return GhResult(code=result.returncode, stderr=result.stderr or "", stdout=result.stdout or "")

    return _exec


def _response_body(result: GhResult) -> str:
    return result.stderr.strip() or result.stdout.strip() or "(no response body)"


def resolve_pin(gh: GhExec) -> PinResolution:
    tag_result = gh(("api", f"repos/{ACTION_REPO}/releases/latest", "--jq", ".tag_name"))
    if tag_result.code != 0:
        raise PinResolutionError(
            f"gh api repos/{ACTION_REPO}/releases/latest exited {tag_result.code}: {_response_body(tag_result)}\n"
            "Run `gh auth status` to verify GitHub CLI authentication before retrying."
        )
    tag = tag_result.stdout.strip()
    if not tag:
        raise PinResolutionError("releases/latest returned an empty tag_name")
    if not _TAG_PATTERN.match(tag):
        raise PinResolutionError(f"releases/latest returned malformed tag '{tag}'")
    if _PRE_RELEASE.search(tag):
        raise PinResolutionError(f"refusing pre-release tag '{tag}' as the default for adopt")

    sha_result = gh(("api", f"repos/{ACTION_REPO}/commits/{tag}", "--jq", ".sha"))
    if sha_result.code != 0:
        raise PinResolutionError(
            f"gh api repos/{ACTION_REPO}/commits/{tag} exited {sha_result.code}: {_response_body(sha_result)}"
        )
    sha = sha_result.stdout.strip()
    if not _SHA_PATTERN.match(sha):
        raise PinResolutionError(f"commits/{tag} returned malformed SHA '{sha}'")
    return PinResolution(sha=sha, tag=tag)
