# Consumer-controls invariants

Machine-checkable encoding of the 9 items in [`docs/consumer-controls.md`](../../../docs/consumer-controls.md). Every capability that emits a workflow walks this list and refuses to write any artifact when an invariant fails.

## Encoding rules

- IDs are stable across versions of this skill. New invariants take the next free `CC-NN`; existing IDs never change meaning.
- The `structural-check` is a one-line predicate over the parsed workflow YAML. The matching predicate function lives in `../lib/invariants/predicates.ts` keyed by ID.
- The `remediation-anchor` points to the `docs/consumer-controls.md` section a human should read when the assertion fails.
- The `owner` follows the doc: `upstream-default` (the action enforces it at runtime) or `consumer-responsibility` (the consumer must wire it correctly).

## Source-of-truth consistency

`docs/consumer-controls.md` numbers the same items 1–9 with `### N. <heading>`. The unit test at `references/invariants.test.ts` asserts every `CC-NN` ID in this file has a matching `### N. ` heading in the doc. When the doc adds or renumbers an item, both this file and the test must be updated in the same change.

## Invariant table

| ID | Owner | Title | Structural check | Remediation anchor |
|---|---|---|---|---|
| CC-01 | consumer-responsibility | Pin prepare/review/publish to the same reviewed full SHA | Every `uses:` referencing `milanhorvatovic/codex-ai-code-review-action/{prepare,review,publish}` is pinned to a 40-character SHA, and all three SHAs are byte-equal | `docs/consumer-controls.md#1-pin-prepare-review-and-publish-to-the-same-reviewed-full-sha` |
| CC-02 | consumer-responsibility | Use `pull_request`, never `pull_request_target` | The workflow's `on:` block contains `pull_request` and not `pull_request_target` | `docs/consumer-controls.md#2-use-pull_request-never-pull_request_target` |
| CC-03 | consumer-responsibility | Same-repo gate on every job | Each of the three jobs (`prepare`, `review`, `publish`) carries `github.event.pull_request.head.repo.full_name == github.repository` in its `if:` expression | `docs/consumer-controls.md#3-gate-every-job-with-githubeventpull_requestheadrepofull_name--githubrepository` |
| CC-04 | consumer-responsibility | Scope `OPENAI_API_KEY` only to the review job | `${{ secrets.OPENAI_API_KEY }}` appears only inside the `review:` job block; `prepare:` and `publish:` declare neither the secret reference nor `environment: codex-review` (or any environment that scopes the key) | `docs/consumer-controls.md#4-scope-openai_api_key-only-to-the-review-job` |
| CC-05 | consumer-responsibility | Keep prepare and review read-only | Both `prepare:` and `review:` declare `permissions: { contents: read }` and request no write scope (`pull-requests: write`, `contents: write`, etc.) | `docs/consumer-controls.md#5-keep-prepare-and-review-read-only` |
| CC-06 | consumer-responsibility | Give `pull-requests: write` only to publish | `publish:` declares `permissions: { contents: read, pull-requests: write }` and no other write scope; no other job requests `pull-requests: write` | `docs/consumer-controls.md#6-give-pull-requests-write-only-to-publish` |
| CC-07 | upstream-default | Keep `retain-findings: "false"` unless retention is explicitly approved | The `publish:` step's `with:` block sets `retain-findings: "false"` (an absent value is also acceptable since the upstream default is `false`); a `"true"` value is allowed only when the workflow file carries an explicit consent comment containing the literal phrase `retention approved` | `docs/consumer-controls.md#7-keep-retain-findings-false-unless-retention-is-explicitly-approved` |
| CC-08 | consumer-responsibility | Set `fail-on-missing-chunks: "true"` for v2.1+ | The `publish:` step's `with:` block sets `fail-on-missing-chunks: "true"` whenever the resolved sub-action SHA corresponds to a v2.1.0-or-later release | `docs/consumer-controls.md#8-set-fail-on-missing-chunks-true-for-v21` |
| CC-09 | consumer-responsibility | Do not pass `review-reference-file` until base-mode is available and enabled | The `prepare:` step does NOT carry `with: review-reference-file:` unless the workflow file carries an explicit consent comment containing the literal phrase `workspace-mode accepted` OR the workflow also sets `review-reference-source: base` (currently unimplemented; tracked under issue #97) | `docs/consumer-controls.md#9-do-not-pass-review-reference-file-until-review-reference-source-base-is-available-and-enabled` |

## Out-of-band detection rules

The action ships a top-level `action.yaml` whose only behavior is to error out on direct use. It is not a consumer-controls invariant, but the `adopt` capability flags it as a remediation. ID: `CC-EXTRA-01-bare-action`. Predicate: any `uses: milanhorvatovic/codex-ai-code-review-action@<sha>` (without `/prepare`, `/review`, or `/publish`) in the workflow. Remediation: rewrite to the three sub-actions per the canonical template.
