"""Repo detection for the codex-review skill.

Pure-function detection of languages, package managers, CI provider, and test
runners from a small set of marker files. Caller injects a RepoReader so this
module is testable against fixture maps without touching the live filesystem.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal, Protocol

type Language = Literal[
    "go",
    "java",
    "javascript",
    "kotlin",
    "php",
    "python",
    "ruby",
    "rust",
    "shell",
    "typescript",
]

type PackageManager = Literal[
    "cargo",
    "composer",
    "go-modules",
    "gradle",
    "maven",
    "npm",
    "pip",
    "pnpm",
    "poetry",
    "rubygems",
    "yarn",
]

type CIProvider = Literal["circleci", "github-actions", "gitlab-ci", "none"]
type ForkPostureSignal = Literal["fork-prs-observed", "no-fork-prs-observed", "unknown"]


class RepoReader(Protocol):
    """Read interface for the consumer's repository.

    Implementations may back onto the live filesystem (default) or a fixture
    dictionary (tests). All paths are repo-relative and use forward slashes.
    """

    def exists(self, path: str) -> bool: ...

    def list_files(self, directory: str) -> list[str]: ...

    def read_file(self, path: str) -> str: ...


@dataclass(frozen=True)
class RepoFacts:
    ci_provider: CIProvider
    contributor_count: int | Literal["unknown"]
    fork_posture_signal: ForkPostureSignal
    has_codex_review_workflow: bool
    has_github_actions: bool
    languages: tuple[Language, ...]
    package_managers: tuple[PackageManager, ...]
    recent_diff_sizes: tuple[int, ...]
    test_runners: tuple[str, ...]


_LANG_FILES: tuple[tuple[tuple[str, ...], tuple[Language, ...]], ...] = (
    (("package.json",), ("javascript", "typescript")),
    (("pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py"), ("python",)),
    (("Cargo.toml",), ("rust",)),
    (("go.mod",), ("go",)),
    (("Gemfile",), ("ruby",)),
    (("composer.json",), ("php",)),
    (("pom.xml",), ("java",)),
    (("build.gradle", "build.gradle.kts"), ("java", "kotlin")),
)

_PM_FILES: tuple[tuple[str, PackageManager], ...] = (
    ("Cargo.toml", "cargo"),
    ("composer.json", "composer"),
    ("go.mod", "go-modules"),
    ("build.gradle", "gradle"),
    ("build.gradle.kts", "gradle"),
    ("pom.xml", "maven"),
    ("package-lock.json", "npm"),
    ("pnpm-lock.yaml", "pnpm"),
    ("poetry.lock", "poetry"),
    ("requirements.txt", "pip"),
    ("Gemfile.lock", "rubygems"),
    ("yarn.lock", "yarn"),
)


def _detect_languages_and_shell(reader: RepoReader) -> tuple[tuple[Language, ...], bool]:
    found: set[Language] = set()
    for files, languages in _LANG_FILES:
        if any(reader.exists(f) for f in files):
            for language in languages:
                found.add(language)
    top_level = _safe_list(reader, ".")
    has_shell = any(name.endswith(".sh") for name in top_level)
    if has_shell:
        found.add("shell")
    return tuple(sorted(found)), has_shell


def _detect_package_managers(reader: RepoReader) -> tuple[PackageManager, ...]:
    found: set[PackageManager] = set()
    for filename, manager in _PM_FILES:
        if reader.exists(filename):
            found.add(manager)
    return tuple(sorted(found))


def _detect_test_runners(reader: RepoReader, languages: tuple[Language, ...]) -> tuple[str, ...]:
    runners: set[str] = set()
    if reader.exists("package.json"):
        try:
            import json

            pkg = json.loads(reader.read_file("package.json"))
            combined = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            for name in ("vitest", "jest", "mocha"):
                if name in combined:
                    runners.add(name)
            if "playwright" in combined or "@playwright/test" in combined:
                runners.add("playwright")
        except (ValueError, OSError):
            pass
    if "python" in languages:
        if reader.exists("pytest.ini") or _matches_pyproject(reader, "pytest"):
            runners.add("pytest")
        if reader.exists("tox.ini"):
            runners.add("tox")
    if "go" in languages:
        runners.add("go-test")
    if "rust" in languages:
        runners.add("cargo-test")
    return tuple(sorted(runners))


def _matches_pyproject(reader: RepoReader, marker: str) -> bool:
    if not reader.exists("pyproject.toml"):
        return False
    try:
        return marker in reader.read_file("pyproject.toml")
    except OSError:
        return False


def _detect_ci_provider(reader: RepoReader) -> tuple[CIProvider, bool]:
    workflow_dir = ".github/workflows"
    if reader.exists(workflow_dir):
        files = _safe_list(reader, workflow_dir)
        has_codex = any("codex" in f.lower() and "review" in f.lower() and f.endswith(".yaml") for f in files)
        return "github-actions", has_codex
    if reader.exists(".gitlab-ci.yml") or reader.exists(".gitlab-ci.yaml"):
        return "gitlab-ci", False
    if reader.exists(".circleci/config.yml") or reader.exists(".circleci/config.yaml"):
        return "circleci", False
    return "none", False


def _safe_list(reader: RepoReader, directory: str) -> list[str]:
    try:
        return reader.list_files(directory)
    except OSError:
        return []


@dataclass
class DetectOptions:
    contributor_count: int | None = None
    fork_posture_signal: ForkPostureSignal | None = None
    recent_diff_sizes: tuple[int, ...] = field(default_factory=tuple)


def detect(reader: RepoReader, options: DetectOptions | None = None) -> RepoFacts:
    """Build a RepoFacts snapshot from the consumer's repository.

    Optional inputs (contributor count, fork-PR posture, recent diff sizes) are
    not derivable from the marker-file scan; the capability injects them when
    available.
    """
    opts = options or DetectOptions()
    languages, _ = _detect_languages_and_shell(reader)
    package_managers = _detect_package_managers(reader)
    provider, has_codex = _detect_ci_provider(reader)
    test_runners = _detect_test_runners(reader, languages)
    return RepoFacts(
        ci_provider=provider,
        contributor_count=opts.contributor_count if opts.contributor_count is not None else "unknown",
        fork_posture_signal=opts.fork_posture_signal or "unknown",
        has_codex_review_workflow=has_codex,
        has_github_actions=provider == "github-actions",
        languages=languages,
        package_managers=package_managers,
        recent_diff_sizes=opts.recent_diff_sizes,
        test_runners=test_runners,
    )


@dataclass(frozen=True)
class _DictReader:
    """In-memory RepoReader backed by a {path: content} map and a {dir: [name]} map."""

    files: dict[str, str]
    dirs: dict[str, list[str]]

    def exists(self, path: str) -> bool:
        return path in self.files or path in self.dirs

    def list_files(self, directory: str) -> list[str]:
        return list(self.dirs.get(directory, ()))

    def read_file(self, path: str) -> str:
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]


def make_dict_reader(files: dict[str, str], dirs: dict[str, list[str]] | None = None) -> RepoReader:
    """Convenience constructor for tests; not exported as part of the public API."""
    return _DictReader(files=dict(files), dirs=dict(dirs or {}))


def make_filesystem_reader(root: str) -> RepoReader:
    """Build a RepoReader rooted at an absolute directory path."""
    from pathlib import Path

    base = Path(root)

    @dataclass(frozen=True)
    class _FsReader:
        def exists(self, path: str) -> bool:
            return (base / path).exists()

        def list_files(self, directory: str) -> list[str]:
            target = base / directory
            if not target.is_dir():
                return []
            return sorted(p.name for p in target.iterdir())

        def read_file(self, path: str) -> str:
            return (base / path).read_text(encoding="utf-8")

    return _FsReader()


_PathPredicate = Callable[[str], bool]
_ = _PathPredicate  # keep type alias reachable for downstream callers
