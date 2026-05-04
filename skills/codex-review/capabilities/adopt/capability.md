---
name: adopt
description: >
  Help an integrator set up the milanhorvatovic/codex-ai-code-review-action
  against a repository: detect what they're working with, emit a hardened
  workflow plus a starter review-reference calibrated to their stack, and
  explain the choices so they can adjust before committing. Triggers when an
  integrator asks to add Codex code review to a repo, regenerate a workflow
  against the latest reviewed release, or audit a fresh checkout against the
  consumer-controls invariants.
---

# adopt

Help the integrator land the action against a real repository. The deterministic work happens in [`scripts/adopt.py`](../../scripts/adopt.py); your job is to surface the result, answer questions, and help the integrator decide what to commit.

## Run

```
python3 scripts/adopt.py --target-repo /path/to/consumer/repo --help
```

Default is dry-run — artifacts print to stdout, the working tree is untouched. Pass `--write` to land them. The script handles pin resolution via `gh api` ([`references/pin-resolution.md`](../../references/pin-resolution.md)), repository detection, action-input schema validation, workflow + reference-file composition mirroring the [Production workflow example](https://github.com/milanhorvatovic/codex-ai-code-review-action#production-workflow-example), runtime fetch of the upstream review-reference baseline at the resolved release SHA, and the consumer-controls invariants assertion.

The integrator picks where each artifact lands. The script ships sensible defaults but exposes path flags:

- `--workflow-path` — where the emitted workflow YAML is written. Default `.github/workflows/codex-review.yaml`. GitHub Actions only discovers workflows under `.github/workflows/`, so the directory is fixed; the filename is the integrator's call.
- `--reference-path` — where the starter review-reference is written. Default `.github/codex/review-reference.md`. The action's `review-reference-file` input accepts any workspace-relative path (subject to its safety constraints — no symlinks, no traversal, ≤ 64 KiB, regular file). Match whatever convention the repo already uses for policy or doc files.
- `--report-path` — where the ADOPTION audit report is written. Default `ADOPTION.md`. Pure documentation; the integrator may keep it under `docs/` or discard it after reading.
- `--reference-baseline-path` — optional local override for the upstream baseline that the layerer composes against. When omitted, the script fetches it via `gh api` at the resolved release SHA. Useful for offline runs or when pinning to a non-released SHA.

## After running

Walk the integrator through what came back:

- The detected facts: languages, package managers, CI provider, fork-PR posture, recent diff sizes. Surface anything that doesn't match what the integrator expects.
- The resolved pin (tag + 40-char SHA) and the v2.1+ inputs that come with it (e.g. `fail-on-missing-chunks`).
- The output paths the script chose. If they don't fit the integrator's repo conventions, suggest the matching `--*-path` flag and re-run.
- Each decision in the ADOPTION report mapped to its `CC-NN` invariant. Help the integrator audit the choices rather than treating them as fixed.
- The open posture questions where the script chose a default: who can trigger reviews (`allow-users`), whether to wire the starter review-reference into the workflow (workspace-mode trade-off, see `CC-09` and [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97)), and whether to opt in to retention (`retain-findings`, gated on the `retention approved` consent comment per `CC-07`).

The script refuses to write any artifact when an invariant fails — surface the failure verbatim with the matching remediation anchor from [`references/invariants.md`](../../references/invariants.md). The integrator commits whichever artifacts they accept; the script does not auto-commit or open a PR.

## References

- [`../../references/invariants.md`](../../references/invariants.md) — `CC-01..CC-09` predicates the script asserts before emitting.
- [`../../references/pin-resolution.md`](../../references/pin-resolution.md) — runtime pin contract.
- [Consumer-controls audit checklist](https://github.com/milanhorvatovic/codex-ai-code-review-action/blob/main/docs/consumer-controls.md) — human-readable invariants and the audit checklist (in the action repo).
- The action's `defaults/review-reference.md` (fetched at runtime) — the upstream baseline the layerer composes against.
- The action's `review-reference-file` input documentation — supports any workspace-relative path subject to the safety constraints.
