---
compatibility: Requires Python 3.12+, git, and the GitHub CLI (gh) on PATH for pin resolution. No third-party packages — stdlib only.
description: >
  Adopt and operate the milanhorvatovic/codex-ai-code-review-action GitHub
  Action. Routes to capabilities for generating a hardened workflow file plus a
  starter review-reference (adopt) and for diagnosing a saved findings.json and
  proposing minimal-diff tweaks (tune). Triggers when an integrator asks to set
  up Codex code review on a repository, audit an existing setup, or explain
  why a published review came out the way it did.
license: MIT
metadata:
  author: Milan Horvatovič
  spec: agentskills.io
  version: 0.1.0
name: codex-review
---

# codex-review

Router skill for the [`milanhorvatovic/codex-ai-code-review-action`](https://github.com/milanhorvatovic/codex-ai-code-review-action) GitHub Action.

The action ships three composite sub-actions (`prepare`, `review`, `publish`) that compose a privilege-separated PR review pipeline. Adoption is non-trivial: the consumer picks `min-confidence`, authors a project-specific `review-reference-file`, sizes `max-chunk-bytes`, gates `OPENAI_API_KEY` to a single job, pins all three sub-actions to the same SHA, and walks the [consumer-controls audit checklist](https://github.com/milanhorvatovic/codex-ai-code-review-action/blob/main/docs/consumer-controls.md). This skill compresses that work into two capabilities and validates the result against the same checklist before emitting any file.

## Capabilities

Route to the appropriate capability based on the integrator's intent:

| Capability | Trigger | Path |
|---|---|---|
| adopt | Generate a hardened workflow + starter review-reference + audit-mapped report for a repository that does not yet use the action | capabilities/adopt/capability.md |
| tune | Read a saved findings.json (or a published PR review) and propose concrete, minimal-diff tweaks to the consumer's review-reference and workflow | capabilities/tune/capability.md |

Read only the capability that matches the task. Do not load both unless the task explicitly spans them.

## Shared resources

- `references/invariants.md` — the 9 consumer-controls items encoded as machine-checkable predicates with stable IDs `CC-01..CC-09`. Both capabilities walk this list before emitting any workflow YAML.
- `references/pin-resolution.md` — the runtime contract for resolving the latest reviewed SHA and tag for the action's three sub-actions via `gh api`. No static pin table is shipped.
- `scripts/adopt.py`, `scripts/tune.py` — entry-point CLIs invoked by the capabilities. Each accepts `--help` and operates on explicit paths; no environment-variable inputs.
- `scripts/lib/` — Python 3.12 stdlib-only internals consumed by the entry-point scripts (`detect.py`, `schema_mapper.py`, `invariants/`, `reference_layerer.py`, `workflow_templates.py`, `pin_resolver.py`, `findings_loader.py`, plus per-finding diagnoses under `scripts/lib/diagnoses/`). No `pip install` required.

Tests and test fixtures live outside the skill directory at `tests/skills/codex-review/` (in the source repository) so the skill directory contains only files that ship to integrators via Claude Code marketplace install. Marketplace installers copy the skill source tree verbatim and have no exclusion mechanism.

## Trust boundary

The skill writes only inside the consumer's working directory. It uses only `git`, `gh`, and reads of the consumer's own repository. It opens no other network endpoints, runs no consumer code, and does not auto-commit or auto-PR anything it emits.

## Versioning

The skill version in this file's frontmatter tracks the skill's own surface, not the action's release version. The action SHA the skill emits is resolved at invocation time from `gh api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest` per [`references/pin-resolution.md`](references/pin-resolution.md).
