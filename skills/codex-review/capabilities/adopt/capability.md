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

Default is dry-run — artifacts print to stdout, the working tree is untouched. Pass `--write` to land them. The script handles pin resolution via `gh api` ([`references/pin-resolution.md`](../../references/pin-resolution.md)), repository detection, action-input schema validation, workflow + reference-file composition mirroring the [Production workflow example](https://github.com/milanhorvatovic/codex-ai-code-review-action#production-workflow-example), and the consumer-controls invariants assertion.

## After running

Walk the integrator through what came back:

- The detected facts: languages, package managers, CI provider, fork-PR posture, recent diff sizes. Surface anything that doesn't match what the integrator expects.
- The resolved pin (tag + 40-char SHA) and the v2.1+ inputs that come with it (e.g. `fail-on-missing-chunks`).
- Each decision in `ADOPTION.md` mapped to its `CC-NN` invariant. Help the integrator audit the choices rather than treating them as fixed.
- The open posture questions where the script chose a default: who can trigger reviews (`allow-users`), whether to wire `.github/codex/review-reference.md` (workspace-mode trade-off, see `CC-09` and [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97)), and whether to opt in to retention (`retain-findings`, gated on the `retention approved` consent comment per `CC-07`).

The script refuses to write any artifact when an invariant fails — surface the failure verbatim with the matching remediation anchor from [`references/invariants.md`](../../references/invariants.md). The integrator commits whichever artifacts they accept; the script does not auto-commit or open a PR.

## References

- [`../../references/invariants.md`](../../references/invariants.md) — `CC-01..CC-09` predicates the script asserts before emitting.
- [`../../references/pin-resolution.md`](../../references/pin-resolution.md) — runtime pin contract.
- [`docs/consumer-controls.md`](../../../docs/consumer-controls.md) — human-readable invariants and the audit checklist.
- The action's `defaults/review-reference.md` — the baseline the layerer composes against.
