"""Render the canonical hardened workflow YAML used by the adopt capability.

Source of truth is the README "Production workflow example". Keep emission
byte-deterministic — workflow content must not depend on model temperature.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")


@dataclass(frozen=True)
class WorkflowTemplateOptions:
    allow_users: str
    pin_sha: str
    pin_tag: str


def render_hardened_workflow(options: WorkflowTemplateOptions) -> str:
    if not _SHA_RE.match(options.pin_sha):
        raise ValueError(f"pin_sha must be a 40-character lowercase hex SHA; got '{options.pin_sha}'")
    if not _TAG_RE.match(options.pin_tag):
        raise ValueError(f"pin_tag must look like vX.Y.Z; got '{options.pin_tag}'")

    allow_users_value = options.allow_users.strip()
    if allow_users_value == "":
        allow_users_line = (
            '          allow-users: "" # empty value allows all same-repo PR authors; tighten to a comma-separated allowlist'
        )
    else:
        allow_users_line = f"          allow-users: {allow_users_value} # bound the allowlist to known maintainers"

    return f"""name: Codex code review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

concurrency:
  group: codex-review-${{{{ github.event.pull_request.number }}}}
  cancel-in-progress: true

jobs:
  prepare:
    if: ${{{{ !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository }}}}
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    timeout-minutes: 10
    outputs:
      skipped: ${{{{ steps.prepare.outputs.skipped }}}}
      has-changes: ${{{{ steps.prepare.outputs.has-changes }}}}
      chunk-count: ${{{{ steps.prepare.outputs.chunk-count }}}}
      chunk-matrix: ${{{{ steps.prepare.outputs.chunk-matrix }}}}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{{{ github.event.pull_request.head.sha }}}}
          fetch-depth: 0
          persist-credentials: false

      - id: prepare
        uses: milanhorvatovic/codex-ai-code-review-action/prepare@{options.pin_sha} # {options.pin_tag}
        with:
{allow_users_line}

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: steps.prepare.outputs.skipped != 'true' && steps.prepare.outputs.has-changes == 'true'
        with:
          name: codex-prepare
          path: .codex/
          include-hidden-files: true
          retention-days: 1

  review:
    needs: prepare
    if: needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: codex-review
    permissions:
      contents: read
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix: ${{{{ fromJson(needs.prepare.outputs.chunk-matrix) }}}}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{{{ github.event.pull_request.head.sha }}}}
          fetch-depth: 0
          persist-credentials: false

      - uses: milanhorvatovic/codex-ai-code-review-action/review@{options.pin_sha} # {options.pin_tag}
        with:
          openai-api-key: ${{{{ secrets.OPENAI_API_KEY }}}}
          chunk: ${{{{ matrix.chunk }}}}

  publish:
    needs: [prepare, review]
    if: always() && needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{{{ github.event.pull_request.head.sha }}}}
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: .codex/
          merge-multiple: true

      - uses: milanhorvatovic/codex-ai-code-review-action/publish@{options.pin_sha} # {options.pin_tag}
        with:
          github-token: ${{{{ github.token }}}}
          expected-chunks: ${{{{ needs.prepare.outputs.chunk-count }}}}
          retain-findings: "false"
          fail-on-missing-chunks: "true"
"""
