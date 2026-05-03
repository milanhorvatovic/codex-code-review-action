"""Unit tests for lib.detect."""

from __future__ import annotations

import json
import unittest

from .detect import DetectOptions, detect, make_dict_reader


class DetectTests(unittest.TestCase):
    def test_typescript_npm_github_actions(self) -> None:
        reader = make_dict_reader(
            {
                "package.json": json.dumps({"devDependencies": {"vitest": "^4.0.0"}}),
                "package-lock.json": "{}",
            },
            {
                ".": [".github", "package.json", "package-lock.json"],
                ".github/workflows": ["codex-review.yaml", "tests.yaml"],
            },
        )
        facts = detect(reader)
        self.assertEqual(list(facts.languages), ["javascript", "typescript"])
        self.assertEqual(list(facts.package_managers), ["npm"])
        self.assertIn("vitest", facts.test_runners)
        self.assertEqual(facts.ci_provider, "github-actions")
        self.assertTrue(facts.has_github_actions)
        self.assertTrue(facts.has_codex_review_workflow)

    def test_python_pytest(self) -> None:
        reader = make_dict_reader(
            {
                "pyproject.toml": "[tool.pytest.ini_options]\n",
                "requirements.txt": "requests\n",
            },
            {".": ["pyproject.toml", "requirements.txt"]},
        )
        facts = detect(reader)
        self.assertEqual(list(facts.languages), ["python"])
        self.assertEqual(list(facts.package_managers), ["pip"])
        self.assertIn("pytest", facts.test_runners)
        self.assertEqual(facts.ci_provider, "none")

    def test_shell_flagged_when_sh_files_present(self) -> None:
        reader = make_dict_reader({}, {".": ["build.sh", "deploy.sh"]})
        self.assertIn("shell", detect(reader).languages)

    def test_polyglot_go_rust(self) -> None:
        reader = make_dict_reader(
            {"go.mod": "module x\n", "Cargo.toml": "[package]\n"},
            {".": ["go.mod", "Cargo.toml"]},
        )
        facts = detect(reader)
        self.assertEqual(list(facts.languages), ["go", "rust"])
        self.assertEqual(sorted(facts.package_managers), ["cargo", "go-modules"])
        self.assertEqual(sorted(facts.test_runners), ["cargo-test", "go-test"])

    def test_options_propagate(self) -> None:
        reader = make_dict_reader({}, {".": []})
        facts = detect(
            reader,
            DetectOptions(
                contributor_count=12,
                fork_posture_signal="fork-prs-observed",
                recent_diff_sizes=(4096, 8192),
            ),
        )
        self.assertEqual(facts.contributor_count, 12)
        self.assertEqual(facts.fork_posture_signal, "fork-prs-observed")
        self.assertEqual(facts.recent_diff_sizes, (4096, 8192))

    def test_gitlab_ci_fallback(self) -> None:
        reader = make_dict_reader({".gitlab-ci.yml": "stages: []\n"}, {".": [".gitlab-ci.yml"]})
        self.assertEqual(detect(reader).ci_provider, "gitlab-ci")


if __name__ == "__main__":
    unittest.main()
