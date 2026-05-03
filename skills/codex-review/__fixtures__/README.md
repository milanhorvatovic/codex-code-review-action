# Fixtures

Two fixture kinds, both used by `vitest` and by the capability `run.ts` scripts during development.

## `repos/`

Snapshots of consumer-side files that drive the detection helpers and the schema mapper. Each subdirectory is a self-contained mini-repo containing only the files the skill reads. Snapshots are committed as copies, not symlinks, so a vitest run does not depend on the live working tree.

- `codex-review-action/` — this repository, included as the first fixture so dogfooding and golden tests stay in step.

When adding a new fixture, copy only:

- `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle*` — whichever apply.
- Any existing `.github/workflows/*.yaml` files the consumer has.
- The action manifests (`prepare/action.yaml`, `review/action.yaml`, `publish/action.yaml`) when present in-tree.
- The current `defaults/review-reference.md` if applicable.

Do NOT copy `node_modules/`, `dist/`, `.git/`, source code, or anything large.

## `findings-examples/`

Hand-authored `findings.json` files conformant with `defaults/review-output-schema.json`. Each file targets one diagnosis surface area:

- `low-confidence-verdict.json` — `overall_correctness: "patch is correct"` with `overall_confidence_score < 0.9` and findings clustered in the 0.5–0.7 confidence band. Drives `lib/diagnoses/low-confidence.ts`.
- `noisy-p3.json` — many `priority: 3` findings whose `confidence_score` would be pruned by a higher `min-confidence`. Drives `lib/diagnoses/noisy-p3.ts`.
- `truncation.json` — `summary` containing the literal "Incomplete review" banner phrase. Drives `lib/diagnoses/truncation.ts`.

These files are NOT sourced from this repository's own runs; the dogfood workflow keeps `retain-findings: "false"` per consumer-controls item 7. If a real artifact ever becomes available it can be added alongside these fixtures, but the skill does not depend on one.
