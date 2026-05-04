"""Unit tests for lib.schema_mapper."""

from __future__ import annotations

import unittest
from dataclasses import dataclass
from pathlib import Path

from lib.schema_mapper import classify_trust, find_input, map_schema, parse_manifest

_HERE = Path(__file__).resolve().parent
_FIXTURE_ROOT = _HERE / "__fixtures__" / "codex-review-action"


def _read(relative: str) -> str:
    return (_FIXTURE_ROOT / relative).read_text(encoding="utf-8")


class ClassifyTrustTests(unittest.TestCase):
    def test_secret(self) -> None:
        self.assertEqual(classify_trust("openai-api-key"), "secret")

    def test_policy(self) -> None:
        self.assertEqual(classify_trust("review-reference-file"), "policy")

    def test_tuning(self) -> None:
        self.assertEqual(classify_trust("max-chunk-bytes"), "tuning")

    def test_unknown_falls_back_to_wiring(self) -> None:
        self.assertEqual(classify_trust("some-future-input"), "wiring")


class ParseManifestTests(unittest.TestCase):
    def test_prepare_inputs(self) -> None:
        inputs = parse_manifest(_read("prepare/action.yaml"))
        names = sorted(spec.name for spec in inputs)
        self.assertEqual(
            names,
            ["allow-users", "github-token", "max-chunk-bytes", "review-reference-file"],
        )
        allow_users = next(spec for spec in inputs if spec.name == "allow-users")
        self.assertFalse(allow_users.required)
        self.assertEqual(allow_users.default, "")
        self.assertEqual(allow_users.trust_class, "policy")

    def test_review_inputs(self) -> None:
        inputs = parse_manifest(_read("review/action.yaml"))
        names = sorted(spec.name for spec in inputs)
        self.assertEqual(names, ["chunk", "effort", "model", "openai-api-key"])
        chunk = next(spec for spec in inputs if spec.name == "chunk")
        self.assertTrue(chunk.required)
        api_key = next(spec for spec in inputs if spec.name == "openai-api-key")
        self.assertEqual(api_key.trust_class, "secret")

    def test_publish_inputs(self) -> None:
        inputs = parse_manifest(_read("publish/action.yaml"))
        names = sorted(spec.name for spec in inputs)
        self.assertIn("fail-on-missing-chunks", names)
        self.assertIn("retain-findings", names)
        self.assertIn("min-confidence", names)
        fail_on = next(spec for spec in inputs if spec.name == "fail-on-missing-chunks")
        self.assertEqual(fail_on.default, "false")
        self.assertEqual(fail_on.trust_class, "tuning")

    def test_empty_manifest(self) -> None:
        self.assertEqual(parse_manifest("name: x\nruns:\n  using: composite\n"), ())


@dataclass
class _FsReader:
    def read_file(self, path: str) -> str:
        return Path(path).read_text(encoding="utf-8")


class MapSchemaTests(unittest.TestCase):
    def test_compose_three_manifests(self) -> None:
        schema = map_schema(
            _FsReader(),
            prepare=str(_FIXTURE_ROOT / "prepare" / "action.yaml"),
            publish=str(_FIXTURE_ROOT / "publish" / "action.yaml"),
            review=str(_FIXTURE_ROOT / "review" / "action.yaml"),
        )
        self.assertGreater(len(schema.prepare), 0)
        self.assertGreater(len(schema.review), 0)
        self.assertGreater(len(schema.publish), 0)
        found = find_input(schema, "publish", "fail-on-missing-chunks")
        self.assertIsNotNone(found)
        assert found is not None
        self.assertEqual(found.default, "false")
        self.assertIsNone(find_input(schema, "publish", "no-such-input"))


if __name__ == "__main__":
    unittest.main()
