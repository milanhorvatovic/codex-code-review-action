---
compatibility: Requires Python 3.12+. adopt uses GitHub CLI (gh) for default release/baseline fetches unless a reviewed pin and baseline are supplied manually. No third-party packages.
description: >
  Helps integrators adopt and tune the milanhorvatovic/codex-ai-code-review-action
  GitHub Action in consumer repositories. Routes to capabilities for generating
  a hardened workflow plus starter review-reference (adopt) and for diagnosing
  a retained findings.json, including confirmed false positives, with
  minimal-diff tuning recommendations (tune).
  Triggers when an integrator asks to set up Codex review, audit an existing
  workflow, or improve review quality from saved findings.
license: MIT
metadata:
  author: Milan Horvatovič
  spec: agentskills.io
  version: 0.1.0
name: codex-review
---

# codex-review

Router skill for adopting and tuning the `milanhorvatovic/codex-ai-code-review-action` GitHub Action in an arbitrary consumer repository.

The action ships three composite sub-actions (`prepare`, `review`, `publish`) that compose a privilege-separated PR review pipeline. Adoption is non-trivial: the consumer chooses who can trigger reviews, gates `OPENAI_API_KEY` to the review job, pins all three sub-actions to the same reviewed SHA, sizes diff chunks, decides whether retained findings are acceptable, and authors project-specific review guidance without weakening workflow guardrails.

This skill is installed as a companion artifact. It does not assume any checkout of the action implementation, and it does not read maintainer-only files. Helper scripts operate on explicit consumer paths, fetch upstream release artifacts via `gh api`, or use caller-supplied reviewed pin values for offline/pre-resolved runs.

## Portability

Use this skill from any Agent Skills-capable client against any consumer repository adopting this action. The working checkout does not need to be this source repository: `adopt` accepts `--target-repo`, and `tune` accepts a retained `findings.json` plus optional consumer workflow/reference paths.

Clients that do not auto-route `capabilities/` should load `capabilities/adopt/capability.md` for setup/refresh/audit requests and `capabilities/tune/capability.md` for retained-finding diagnosis requests.

## Capabilities

Route to the appropriate capability based on the integrator's intent:

| Capability | Trigger | Path |
|---|---|---|
| adopt | Generate a hardened workflow + starter review-reference + audit-mapped report for a consumer repository that is adopting or refreshing the action | capabilities/adopt/capability.md |
| tune | Read a retained `findings.json` artifact and propose concrete, minimal-diff tweaks to the consumer's review-reference and workflow, including calibration from integrator-confirmed false positives | capabilities/tune/capability.md |

Read only the capability that matches the task. Do not load both unless the task explicitly spans them.

## Shared resources

- `references/invariants.md` — the consumer-controls items encoded as machine-checkable predicates with stable IDs `CC-01..CC-09`. Capabilities use these IDs as non-negotiable workflow guardrails.
- `references/pin-resolution.md` — the runtime contract for resolving the latest reviewed SHA and tag for the action's three sub-actions via `gh api`. No static pin table is shipped.
- `scripts/adopt.py`, `scripts/tune.py` — entry-point CLIs invoked by the capabilities. Each accepts `--help` and operates on explicit paths; no environment-variable inputs.
- `scripts/lib/detect.py`, `scripts/lib/reference_layerer.py`, `scripts/lib/workflow_templates.py`, `scripts/lib/pin_resolver.py`, `scripts/lib/findings_loader.py`, `scripts/lib/workflow_parser.py` — stdlib-only support modules for repository detection, workflow rendering, pin resolution, findings parsing, and invariant checks.
- `scripts/lib/diagnoses/false_positive.py`, `scripts/lib/diagnoses/low_confidence.py`, `scripts/lib/diagnoses/noisy_p3.py`, `scripts/lib/diagnoses/truncation.py` — deterministic tuning diagnoses used by `tune`.

## Trust boundary

The skill writes only validated repository-relative paths under the consumer's target repository, and only when `adopt --write` is explicitly passed. It reads the consumer's own repository and opens no network endpoints except GitHub API calls through `gh api`. It runs no consumer code and does not auto-commit or auto-PR anything it emits.

## Versioning

The skill version in this file's frontmatter tracks the skill's own surface, not the action's release version. By default, the action SHA emitted by `adopt` is resolved at invocation time from `gh api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest` per `references/pin-resolution.md`. Integrators who already have a reviewed pin can pass `--pin-sha` and `--pin-tag` to avoid runtime release resolution.
