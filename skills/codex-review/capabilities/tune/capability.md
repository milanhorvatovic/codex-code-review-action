---
name: tune
description: >
  Help an integrator understand why their last Codex review produced the
  verdict, finding count, or noise pattern it did, and propose minimal-diff
  tweaks they can accept or reject individually. Triggers when an integrator
  asks why a verdict had a low confidence score, why most findings were
  filtered out, why P3 noise dominates, or why the published review carries
  an "Incomplete review" banner.
---

# tune

Help the integrator iterate on review quality. The deterministic diagnosis lives in [`scripts/tune.py`](../../scripts/tune.py); your job is to read its rendered report alongside the integrator and help them decide which recommendations match their intent.

## Run

```
python3 scripts/tune.py --findings-path /path/to/findings.json --help
```

`--findings-path` is required — point it at a `findings.json` artifact saved by `retain-findings: "true"` (see `CC-07` consent guidance). The other path flags add context for richer rationale strings; both accept whatever convention the integrator's repo uses:

- `--reference-path` — the integrator's current review-reference file, wherever they store it. The action's `review-reference-file` input does not constrain the location.
- `--workflow-path` — the integrator's current workflow file, wherever they named it under `.github/workflows/`.

The script validates the findings against the runtime contract, runs the three diagnoses (low-confidence verdict, noisy P3 surface, truncation banner), and prints a markdown report with one fenced-diff `## Recommendation` per fired diagnosis plus a per-finding rationale.

## After running

Engage with the integrator on the report:

- For each fired diagnosis, walk the contributing findings and the proposed diff. Help the integrator decide whether the diff matches their intent or whether a different cut would fit better — e.g., a sharper focus-area edit instead of an `effort` bump, or pruning a reference-file section instead of raising `min-confidence`.
- Recommendations stay within the action's public input surface (`min-confidence`, `effort`, `model`, `max-chunk-bytes`, reference-file edits). They never propose changes that would violate `CC-01..CC-09` — those are non-negotiable security guardrails. If a finding seems to suggest one, surface the conflict and help the integrator pick a different angle.
- The diff hunks use whatever paths the integrator passed via `--reference-path` and `--workflow-path`. When the flags are omitted, the hunks emit visible placeholder paths (`<your-review-reference-path>`, `<your-workflow-path>`) so the integrator notices and re-runs with the right values rather than applying a diff against the wrong file.
- If the integrator asks about a pattern the script doesn't yet diagnose (missed-issue audits, docs-only noise reduction, paths-filter recommendations), say so directly and help them reason through the tweak by hand. Don't fabricate a structured recommendation the script wouldn't produce.

The script never writes to the working tree. The integrator applies any diff with `git apply` or by hand and re-runs the action to confirm the next review meets the bar.

## References

- [`../../references/invariants.md`](../../references/invariants.md) — guardrails every recommendation respects.
- [`../../scripts/lib/diagnoses/`](../../scripts/lib/diagnoses/) — `low_confidence.py`, `noisy_p3.py`, `truncation.py`. The three modules are short and self-explanatory; read them when an integrator asks how a recommendation was derived.
- The action's `defaults/review-output-schema.json` — the findings shape the script validates against.
- The action's `review-reference-file` input documentation — supports any workspace-relative path subject to the safety constraints.
