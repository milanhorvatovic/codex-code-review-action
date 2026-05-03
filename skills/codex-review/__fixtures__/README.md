# Fixtures

Inputs used by the skill's unit tests (`python3 -m unittest discover` from `scripts/`) and by the entry-point CLIs during development.

## Per-repo fixtures (top-level subdirectories)

Each subdirectory is a self-contained mini-repo containing only the files the skill reads. Snapshots are committed as copies, not symlinks, so the test run does not depend on the live working tree.

- `codex-review-action/` — this repository, included as the first fixture so dogfooding and the test suite stay in step.

When adding a new fixture, create a sibling subdirectory and copy only:

- `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle*` — whichever apply.
- Any existing `.github/workflows/*.yaml` files the consumer has.
- The action manifests (`prepare/action.yaml`, `review/action.yaml`, `publish/action.yaml`) when present in-tree.
- The current `defaults/review-reference.md` if applicable.

Do NOT copy `node_modules/`, `dist/`, `.git/`, source code, or anything large.

## `findings-examples/`

Hand-authored `findings.json` files conformant with `defaults/review-output-schema.json`. Each file targets one diagnosis surface area:

- `low-confidence-verdict.json` — `overall_correctness: "patch is correct"` with `overall_confidence_score < 0.9` and findings clustered in the 0.5–0.7 confidence band. Drives `scripts/lib/diagnoses/low_confidence.py`.
- `noisy-p3.json` — many `priority: 3` findings whose `confidence_score` would be pruned by a higher `min-confidence`. Drives `scripts/lib/diagnoses/noisy_p3.py`.
- `truncation.json` — `summary` containing the literal "Incomplete review" banner phrase. Drives `scripts/lib/diagnoses/truncation.py`.

These files are NOT sourced from this repository's own runs; the dogfood workflow keeps `retain-findings: "false"` per consumer-controls item 7. If a real artifact ever becomes available it can be added alongside these fixtures, but the skill does not depend on one.
