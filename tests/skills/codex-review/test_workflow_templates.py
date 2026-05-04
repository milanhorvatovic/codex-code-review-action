"""Unit tests for lib.workflow_templates."""

from __future__ import annotations

import re
import unittest

from lib.invariants import assert_workflow
from lib.workflow_templates import WorkflowTemplateOptions, render_hardened_workflow

_SHA = "1111111111111111111111111111111111111111"
_TAG = "v2.1.0"


class RenderHardenedWorkflowTests(unittest.TestCase):
    def test_rejects_malformed_sha(self) -> None:
        with self.assertRaisesRegex(ValueError, "40-character"):
            render_hardened_workflow(WorkflowTemplateOptions(allow_users="alice", pin_sha="abc", pin_tag=_TAG))

    def test_rejects_malformed_tag(self) -> None:
        with self.assertRaisesRegex(ValueError, "vX.Y.Z"):
            render_hardened_workflow(WorkflowTemplateOptions(allow_users="alice", pin_sha=_SHA, pin_tag="latest"))

    def test_emits_workflow_passing_every_cc_invariant(self) -> None:
        yaml_text = render_hardened_workflow(
            WorkflowTemplateOptions(allow_users="alice,bob", pin_sha=_SHA, pin_tag=_TAG)
        )
        report = assert_workflow(yaml_text, action_version=_TAG)
        if not report.ok:
            for outcome in report.outcomes:
                print(outcome)  # noqa: T201 - debug aid for failing tests
        self.assertTrue(report.ok)

    def test_preserves_trailing_tag_comment_on_uses_lines(self) -> None:
        yaml_text = render_hardened_workflow(
            WorkflowTemplateOptions(allow_users="alice", pin_sha=_SHA, pin_tag=_TAG)
        )
        matches = re.findall(
            r"milanhorvatovic/codex-ai-code-review-action/(prepare|review|publish)@[0-9a-f]{40} # v2\.1\.0",
            yaml_text,
        )
        self.assertEqual(len(matches), 3)

    def test_empty_allow_users_falls_back_to_quoted_empty(self) -> None:
        yaml_text = render_hardened_workflow(
            WorkflowTemplateOptions(allow_users="  ", pin_sha=_SHA, pin_tag=_TAG)
        )
        self.assertRegex(yaml_text, r'allow-users: ""')


if __name__ == "__main__":
    unittest.main()
