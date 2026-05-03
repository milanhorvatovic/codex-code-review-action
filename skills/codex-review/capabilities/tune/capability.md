---
name: tune
description: >
  Read a saved findings.json (from retain-findings: true) or a published PR
  review and propose concrete, minimal-diff tweaks to the consumer's
  review-reference.md and workflow file. Triggers when an integrator asks why
  a verdict had a low confidence score, why most findings were filtered out,
  why P3 noise dominated, or why a review banner says Incomplete review.
---

# tune

Diagnose a published review and emit a per-finding rationale plus a unified diff against the consumer's `review-reference.md` and/or workflow file. The integrator can accept or reject each suggestion individually.

## Invocation

Run [scripts/tune.py](../../scripts/tune.py) from the skill root:

```
python3 scripts/tune.py --findings-path /path/to/findings.json [--reference-path ...] [--workflow-path ...]
```

`--findings-path` is required. The other two paths are optional context that future diagnoses will use; v0 diagnoses operate on the findings alone.

## Instructions

The script encapsulates the workflow below; the capability's job is to surface the rendered report and answer integrator questions about specific recommendations.

1. The script loads the input findings via `scripts/lib/findings_loader.py` and validates against the runtime contract of `defaults/review-output-schema.json`. Refuse to proceed on any schema violation; surface the offending field path.
2. The script runs each diagnosis under `scripts/lib/diagnoses/`:
   - `low_confidence.py` — when `overall_confidence_score < 0.9`, surface the findings whose `confidence_score` clusters in the 0.5–0.7 band; recommend a reference-file edit OR an `effort: high` / `model:` bump, never both at once.
   - `noisy_p3.py` — when more than 6 P3 findings appear, recommend raising `min-confidence` to a percentile boundary that would prune them, plus optional reference-file pruning anchors for the P3 categories that dominate.
   - `truncation.py` — when `summary` contains the literal "Incomplete review" banner phrase, recommend a `max-chunk-bytes` change (lower it; the banner means a chunk job failed or was missing).
3. For each fired diagnosis the script emits a `Recommendation` record: the affected file (reference or workflow), the unified diff, and a per-finding rationale block listing every `finding.title` that contributed to the recommendation.
4. The script renders the consolidated output: a markdown report with one `## Recommendation` section per hit, each containing a fenced `diff` block and a bulleted rationale. The footer summarizes the verdict, the finding count, and the diagnoses that did and did not fire.
5. The integrator decides whether to apply each diff. The script never writes to the consumer's working tree; the capability does not change that.

## Output contract

- A markdown report on `stdout` (or to a path if the integrator supplied one).
- Zero side effects on the consumer's working tree.
- Diffs that are individually applicable with `git apply` and that the integrator can reject one at a time.

## What this capability does NOT do

- It does not retrain or fine-tune the underlying model. Recommendations stay within the public input surface (`min-confidence`, `effort`, `model`, `max-chunk-bytes`, reference-file edits).
- It does not propose changes to consumer-controls invariants (`CC-01..CC-09`) — those are non-negotiable security guardrails, not tuning parameters. If a finding suggests violating one, the capability surfaces the conflict and refuses to emit the diff.
- It does not auto-fetch or auto-store findings. The integrator points at a path or PR URL.

## Diagnoses not yet supported in v0

- Missed-issues diagnosis (consumer pastes an issue the review missed) — pending a corpus large enough to pattern-match.
- Docs-only / generated-file noise reduction — pending the `paths-filter` capability under follow-up.

When either of these is requested, surface a deterministic deflection ("not yet supported, file an issue") rather than guessing.
