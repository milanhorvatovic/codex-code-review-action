---
name: adopt
description: >
  Read a target repository read-only and emit a hardened
  .github/workflows/codex-review.yaml plus a starter
  .github/codex/review-reference.md plus an audit-mapped ADOPTION.md report.
  Triggers when an integrator asks to set up the codex-ai-code-review-action
  for the first time, regenerate a workflow against the latest reviewed
  release, or audit a fresh checkout against the consumer-controls invariants.
---

# adopt

Generate the three artifacts an integrator needs to land the action: a hardened workflow file, a starter review-reference, and a one-pass audit report. Wire nothing the integrator has not seen.

## Inputs

- `target-repo`: absolute path to the consumer's repository checkout. Defaults to the current working directory if unset.
- `allow-users`: comma-separated GitHub usernames for the prepare allowlist. The capability prompts the integrator if missing; an empty value is permitted but flagged in the report.
- `dry-run` (default `true`): when `true`, emit artifacts to `stdout` and a tempdir, do not touch the consumer's working tree. When `false`, write `.github/workflows/codex-review.yaml`, `.github/codex/review-reference.md`, and `ADOPTION.md` at the repo root, refusing to overwrite any of them without explicit confirmation.

## Instructions

1. Resolve the latest reviewed release per [`../../references/pin-resolution.md`](../../references/pin-resolution.md). Capture both the tag (`v<X.Y.Z>`) and the 40-character commit SHA. Refuse to proceed if `gh` is unavailable or the response is malformed — do not silently fall back to a stale or hand-typed value.
2. Run `lib/detect.py` against `target-repo` to capture `RepoFacts` (languages, package managers, CI provider, contributor count, fork-PR posture, recent diff sizes). Surface the detected facts to the integrator before emitting anything.
3. Run `lib/schema_mapper.py` once against the SHA-pinned action.yaml manifests under `prepare/`, `review/`, `publish/` (read from the consumer-side checkout if it already pins the action; otherwise read from the latest release tag fetched in step 1). Validate that every input the workflow template references actually exists at the resolved SHA.
4. Detect a bare-action pin in any existing `.github/workflows/*.yaml`: a `uses:` line that references `milanhorvatovic/codex-ai-code-review-action@<sha>` without `/prepare`, `/review`, or `/publish`. Top-level `action.yaml` is a guardrail composite that exits 1 by design; if the integrator's existing workflow uses it, flag the line in `ADOPTION.md` and emit a rewrite to the three sub-actions.
5. Compose the workflow YAML via `lib/workflow_templates.py` with the resolved SHA, the integrator-supplied `allow-users`, and the canonical hardened template (mirroring the README Production workflow example). The template:
   - Triggers on `pull_request`, never `pull_request_target`.
   - Gates `prepare`, `review`, and `publish` on `github.event.pull_request.head.repo.full_name == github.repository`.
   - Scopes `OPENAI_API_KEY` to the `review` job via `environment: codex-review`.
   - Pins all three sub-actions to the same resolved SHA with a matching `# v<X.Y.Z>` trailing comment.
   - Sets `permissions: { contents: read }` on `prepare` and `review`; `permissions: { contents: read, pull-requests: write }` on `publish`.
   - Sets `retain-findings: "false"` and `fail-on-missing-chunks: "true"` (the v2.1.0+ steady-state setting).
   - Does NOT include `with: review-reference-file:` on the `prepare` step (option-2 default per the open question; workspace-mode tampering risk per `CC-09`). The starter file is emitted but unwired.
6. Compose the starter `.github/codex/review-reference.md` via `lib/reference_layerer.py`, layering language-specific sections from `defaults/review-reference.md` against `RepoFacts.languages`. Add a header comment documenting the workspace-mode trust posture and the issue #97 cross-reference.
7. Run `lib/invariants/` against the emitted workflow YAML. Refuse to write any artifact if any of `CC-01..CC-09` fails. Surface failures verbatim with the remediation anchor from `references/invariants.md`.
8. Compose `ADOPTION.md` listing every input chosen and the matching `CC-NN` invariant the choice satisfies. Include the bare-action detection result if one was found.
9. Write the artifacts (or print them on `dry-run: true`). Print a final summary with the resolved tag/SHA, the count of `CC-NN` invariants asserted, and a pointer to the open question on `review-reference-file` wiring.

## Output contract

- `.github/workflows/codex-review.yaml` — passes `actionlint` (run by the consumer's CI; not invoked here) and every invariant in `references/invariants.md`.
- `.github/codex/review-reference.md` — present but not wired into the workflow's `with:` block.
- `ADOPTION.md` — at the repo root, mapping each emitted decision to one or more `CC-NN` IDs.

## What this capability does NOT do

- It does not auto-commit or open a PR. The integrator owns the commit step.
- It does not bump `package.json` or `CHANGELOG.md`. Those are owned by the action's release process.
- It does not run `actionlint` or `npm test`. The consumer's CI runs both.
- It does not wire `review-reference-file:` into the workflow. The starter file is a deliberate, non-default opt-in; wiring waits for [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97) to ship base-mode reads.
