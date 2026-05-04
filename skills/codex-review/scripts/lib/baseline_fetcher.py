"""Fetch the action's defaults/review-reference.md at the resolved release SHA.

The skill is portable — it does not assume the integrator has the action's
repository checked out alongside their own working tree. The starter
review-reference is composed against the upstream baseline, fetched at
runtime via gh api at the same SHA the workflow pin resolves to. An
integrator who needs an offline path can pass an explicit local override.
"""

from __future__ import annotations

from pathlib import Path

from .pin_resolver import ACTION_REPO, GhExec


class BaselineFetchError(Exception):
    """Raised when the baseline review-reference cannot be obtained."""


def fetch_baseline_from_action(gh: GhExec, sha: str) -> str:
    """Pull defaults/review-reference.md from the action repo at the given SHA."""
    result = gh(
        (
            "api",
            f"repos/{ACTION_REPO}/contents/defaults/review-reference.md?ref={sha}",
            "-H",
            "Accept: application/vnd.github.raw",
        )
    )
    if result.code != 0:
        raise BaselineFetchError(
            f"gh api repos/{ACTION_REPO}/contents/defaults/review-reference.md exited "
            f"{result.code}: {result.stderr.strip()}"
        )
    if not result.stdout.strip():
        raise BaselineFetchError(
            f"gh api repos/{ACTION_REPO}/contents/defaults/review-reference.md@{sha} returned empty content"
        )
    return result.stdout


def load_baseline_from_path(path: str | Path) -> str:
    """Read a locally-staged baseline file. Used when the integrator overrides the fetch."""
    candidate = Path(path)
    if not candidate.exists():
        raise BaselineFetchError(f"baseline path '{candidate}' does not exist")
    if not candidate.is_file():
        raise BaselineFetchError(f"baseline path '{candidate}' is not a regular file")
    return candidate.read_text(encoding="utf-8")
