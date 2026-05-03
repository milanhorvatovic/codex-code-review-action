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

## Invocation

Run [scripts/adopt.py](../../scripts/adopt.py) from the skill root:

```
python3 scripts/adopt.py --target-repo /path/to/consumer/repo [--allow-users alice,bob] [--write]
```

Default is dry-run (artifacts printed to stdout). Pass `--write` to land the three artifacts in the target repository's working tree.

## Instructions

The script encapsulates the workflow below; the capability's job is to surface the result, decide between dry-run and write, and answer integrator questions about specific decisions.

1. Resolve the latest reviewed release per [`../../references/pin-resolution.md`](../../references/pin-resolution.md) via `gh api`. Refuse to proceed if `gh` is unavailable or the response is malformed — `scripts/adopt.py` raises `AdoptError`; surface the message verbatim. Do not silently fall back to a stale or hand-typed value.
2. The script invokes `scripts/lib/detect.py` against `target-repo` to capture `RepoFacts` (languages, package managers, CI provider, contributor count, fork-PR posture, recent diff sizes). Surface the detected facts to the integrator before emitting anything.
3. The script invokes `scripts/lib/schema_mapper.py` once against the SHA-pinned action.yaml manifests under `prepare/`, `review/`, `publish/` (read from the consumer-side checkout if it already pins the action; otherwise read from the latest release tag fetched in step 1). Validate that every input the workflow template references actually exists at the resolved SHA.
4. The script detects a bare-action pin in any existing `.github/workflows/*.yaml`: a `uses:` line that references `milanhorvatovic/codex-ai-code-review-action@<sha>` without `/prepare`, `/review`, or `/publish`. Top-level `action.yaml` is a guardrail composite that exits 1 by design; if the integrator's existing workflow uses it, the bare-action result is flagged in `ADOPTION.md`.
5. The script composes the workflow YAML via `scripts/lib/workflow_templates.py` with the resolved SHA, the integrator-supplied `--allow-users`, and the canonical hardened template (mirroring the README Production workflow example). The template:
   - Triggers on `pull_request`, never `pull_request_target`.
   - Gates `prepare`, `review`, and `publish` on `github.event.pull_request.head.repo.full_name == github.repository`.
   - Scopes `OPENAI_API_KEY` to the `review` job via `environment: codex-review`.
   - Pins all three sub-actions to the same resolved SHA with a matching `# v<X.Y.Z>` trailing comment.
   - Sets `permissions: { contents: read }` on `prepare` and `review`; `permissions: { contents: read, pull-requests: write }` on `publish`.
   - Sets `retain-findings: "false"` and `fail-on-missing-chunks: "true"` (the v2.1.0+ steady-state setting).
   - Does NOT include `with: review-reference-file:` on the `prepare` step (option-2 default per the open question; workspace-mode tampering risk per `CC-09`). The starter file is emitted but unwired.
6. The script composes the starter `.github/codex/review-reference.md` via `scripts/lib/reference_layerer.py`, layering language-specific sections from `defaults/review-reference.md` against `RepoFacts.languages`. The header comment documents the workspace-mode trust posture and the issue #97 cross-reference.
7. The script runs `scripts/lib/invariants/` against the emitted workflow YAML and raises `AdoptError` if any of `CC-01..CC-09` fail. Surface failures verbatim with the remediation anchor from `references/invariants.md`.
8. The script composes `ADOPTION.md` listing every input chosen and the matching `CC-NN` invariant the choice satisfies. Include the bare-action detection result if one was found.
9. On dry-run, the script prints the three artifacts to stdout. On `--write`, the script writes the three files into the target repository's working tree. After either, print a final summary with the resolved tag/SHA, the count of `CC-NN` invariants asserted, and a pointer to the open question on `review-reference-file` wiring.

## Output contract

- `.github/workflows/codex-review.yaml` — passes `actionlint` (run by the consumer's CI; not invoked here) and every invariant in `references/invariants.md`.
- `.github/codex/review-reference.md` — present but not wired into the workflow's `with:` block.
- `ADOPTION.md` — at the repo root, mapping each emitted decision to one or more `CC-NN` IDs.

## What this capability does NOT do

- It does not auto-commit or open a PR. The integrator owns the commit step.
- It does not bump `package.json` or `CHANGELOG.md`. Those are owned by the action's release process.
- It does not run `actionlint` or `npm test`. The consumer's CI runs both.
- It does not wire `review-reference-file:` into the workflow. The starter file is a deliberate, non-default opt-in; wiring waits for [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97) to ship base-mode reads.
