# Consumer controls for safe adoption

This page is a single auditable checklist for teams adopting the Codex AI Code Review action in production or in a private repository. Every item below is a hard constraint a security reviewer can verify against a consumer's workflow file in one pass; the rationale and pointers to the canonical guidance live alongside each item so the checklist itself stays scannable.

The action handles privilege separation inside its three-job pipeline; it does not — and cannot — make the surrounding workflow safe. Most controls in this list are owned by the consuming team, not by the action at runtime. The [`Responsibility boundary`](../README.md#responsibility-boundary) section in the README states the same separation in prose; this page restates it as audit items.

## How to use this checklist

1. Open the workflow file that calls this action (typically `.github/workflows/codex-review.yaml`).
2. Walk the checklist top to bottom and confirm each item against your workflow.
3. Where an item fails, follow the linked README section to fix it before adoption.

The [Production workflow example](../README.md#production-workflow-example) in the README satisfies every item below as written; you can also use it as a known-good reference.

## Owner column

Each item is tagged so it is clear who enforces the control:

- **Upstream default** — the action enforces the constraint at runtime regardless of how the workflow is wired. Listed here so an audit can confirm the dependency.
- **Consumer responsibility** — the action cannot enforce the constraint; the consuming team must wire it correctly in the workflow file.

## Checklist

### 1. Pin `prepare`, `review`, and `publish` to the same reviewed full SHA

> **Owner:** Consumer responsibility.

Every `uses:` reference to this action in your workflow must use a 40-character commit SHA, not a `@v2` (or any other) mutable tag. All three sub-actions must point at the **same** SHA from the same release — `prepare`, `review`, and `publish` share artifact layout and schema, and mixing SHAs from different releases can break the workflow.

**Why:** SHA pinning is GitHub's recommended supply-chain control for third-party actions. A mutable tag like `@v2` is a maintainer-account-controlled reference that can be moved at any time; a SHA freezes the exact code you reviewed, including the transitive `openai/codex-action` pin in [`review/action.yaml`](../review/action.yaml).

**Example.** Resolve the SHA for the release tag you want to adopt, then pin all three sub-actions to that single SHA. Replace `<tag>` with the release (e.g. `v2.1.0`) and `<full-sha>` with the resolved 40-character commit SHA:

```bash
gh api repos/milanhorvatovic/codex-ai-code-review-action/commits/<tag> --jq '.sha'
```

```yaml
- id: prepare
  uses: milanhorvatovic/codex-ai-code-review-action/prepare@<full-sha> # v2.1.0
- uses: milanhorvatovic/codex-ai-code-review-action/review@<full-sha> # v2.1.0
- uses: milanhorvatovic/codex-ai-code-review-action/publish@<full-sha> # v2.1.0
```

The `# v2.1.0` trailing comment is for human readers; pin verification reads the SHA, not the comment. Bumping to a new release is a one-line edit per `uses:` line plus a re-run of the `gh api` command.

**How to apply:** see [Pinning the action](../README.md#pinning-the-action) for the full convenient-vs-immutable comparison and the transitive-pin guarantee, and the [Production workflow example](../README.md#production-workflow-example) for a complete workflow that has all three sub-actions pinned to the same SHA in context.

### 2. Use `pull_request`, never `pull_request_target`

> **Owner:** Consumer responsibility.

The workflow must be triggered by `on: pull_request`. Using `on: pull_request_target` is unsafe for any workflow that processes pull-request content.

**Why:** `pull_request_target` runs the trusted base-branch workflow with repository secrets in scope. If that workflow then executes attacker-controlled code from the PR head — for example, a repository script the PR rewrote — `OPENAI_API_KEY` is exfiltratable. With `pull_request`, repository secrets are not exposed to fork-PR workflow runs, so the same script has nothing useful to steal.

**How to apply:** see [Do not use `pull_request_target`](../README.md#do-not-use-pull_request_target) for the threat model and the script-rewrite example.

### 3. Gate every job with `github.event.pull_request.head.repo.full_name == github.repository`

> **Owner:** Consumer responsibility.

Each of the three jobs must carry the same-repo gate in its `if:` expression. The gate must be present on `prepare`, `review`, and `publish` independently — a single missed gate exposes that job to fork-PR runs.

**Why:** `pull_request` events fire on fork PRs as well as same-repo PRs. The same-repo gate skips fork PRs cleanly instead of letting them produce failed runs (no `OPENAI_API_KEY` is available on a fork-PR workflow run, so `review` would fail at auth and `publish` would post nothing). It also reinforces the expectation that this action is wired for trusted same-repo contributors only — see [Why fork PRs are skipped](#why-fork-prs-are-skipped) below for the full reasoning.

**How to apply:** see the `if:` lines on every job in the [Production workflow example](../README.md#production-workflow-example), and the [Public repos](../README.md#public-repos) and [Private repos](../README.md#private-repos) subsections.

### 4. Scope `OPENAI_API_KEY` only to the `review` job

> **Owner:** Consumer responsibility.

The OpenAI API key must reach only the `review` job. The `prepare` and `publish` jobs do not declare it, do not reference it via `${{ secrets.OPENAI_API_KEY }}`, and do not declare an `environment:` that would make it readable.

For private-repo and team adoption, the key must additionally be bound to a GitHub Environment (the [Production workflow example](../README.md#production-workflow-example) uses `environment: codex-review` on the `review` job). The repo-scoped secret path is acceptable only for one-person evaluation in the [Minimal quick start](../README.md#minimal-quick-start).

**Why:** privilege separation. The `review` job has the OpenAI key but no write permission; the `publish` job has write permission but no key. See [Why publish must not receive the OpenAI key](#why-publish-must-not-receive-the-openai-key) below for the full reasoning. Environment scoping is a defense-in-depth layer on top of that — see the "Environment-scoped secret" bullet under [Private repos](../README.md#private-repos).

**How to apply:** see the [Production workflow example](../README.md#production-workflow-example) for the per-job split, and [One-time repo setup](../README.md#one-time-repo-setup) for the GitHub Environment configuration.

### 5. Keep `prepare` and `review` read-only

> **Owner:** Consumer responsibility.

Both jobs must declare `permissions: { contents: read }` and nothing more. Neither job should request `pull-requests: write`, `contents: write`, or any other write scope.

**Why:** the action's three-job design assumes neither `prepare` nor `review` ever has write access to the repository or PR. Granting either job a write scope collapses the three-trust-boundary design into two and removes the guarantee that an attacker who compromises the part of the pipeline that handles the diff cannot also write to the PR.

**How to apply:** see the `permissions:` blocks on `prepare` and `review` in the [Production workflow example](../README.md#production-workflow-example), and the Architecture table in [Architecture](../README.md#architecture).

### 6. Give `pull-requests: write` only to `publish`

> **Owner:** Consumer responsibility.

The `publish` job is the only place that needs `pull-requests: write`. It uses the scope to post the PR review and the inline comments. Other write scopes (`contents: write`, etc.) must not be added.

**Why:** the same privilege-separation argument as above, viewed from the other side. The job that writes to the PR is the job that does not see the OpenAI key. Adding write scopes elsewhere defeats the purpose of the split.

**How to apply:** see the `permissions:` block on `publish` in the [Production workflow example](../README.md#production-workflow-example).

### 7. Keep `retain-findings: "false"` unless retention is explicitly approved

> **Owner:** Upstream default; consumer must not override without approval.

The action defaults `retain-findings` to `false`. Production workflows should leave it at `false` (or set it explicitly for auditors) and only opt in when an auditor or compliance regime requires it. When opted in, set `retain-findings-days` to the shortest value your retention policy allows; the upstream cap is 90 days.

**Why:** `retain-findings: "true"` uploads the merged review JSON — including the diff and the model's findings — as a long-lived artifact. That extends the retention window for diff-derived data well beyond the ephemeral `prepare`-to-`publish` artifact handoff.

**How to apply:** the [Production workflow example](../README.md#production-workflow-example) sets `retain-findings: false` explicitly so an auditor reading the workflow file sees the choice was deliberate. See the [Publish action inputs](../README.md#publish-action-inputs) table for the input definition and the upstream cap behavior of `retain-findings-days`.

### 8. Set `fail-on-missing-chunks: "true"` for v2.1+

> **Owner:** Consumer responsibility.

Once `prepare`, `review`, and `publish` are pinned to a v2.1.0-or-later SHA, the `publish` job must set `fail-on-missing-chunks: "true"`. This is the steady-state production setting from v2.1.0 onward.

**Important: the input is recognized only on v2.1.0 and later.** If the SHAs are still on `@v2.0.0` (or any pre-v2.1.0 commit), GitHub emits an `Unexpected input(s)` warning and silently ignores the value. A consumer who copies this checklist line without first bumping the SHAs gets neither the protection nor a hard failure — only a warning buried in the workflow log. Pin to v2.1.0+ first, then enable the input.

**Why:** when one or more review chunks are missing (job failure, invalid output, artifact lost), the partial review is always published with an "Incomplete review" banner. With the default `fail-on-missing-chunks: false`, the publish step still exits 0 — CI status stays green, and a reviewer who sees "Codex review posted" may miss the banner and assume full diff coverage. With `true`, the same banner is posted **and** the publish step then fails, so the missing-chunks case surfaces as a red CI check on the PR rather than a green one with the warning buried in the body.

The default remains `false` for backward compatibility — flipping it in a v2.x minor release would change the CI status of a workflow that previously stayed green. The explicit recommendation to set it to `"true"` exists precisely because the default does not.

**How to apply:** see the [Publish action inputs](../README.md#publish-action-inputs) table for the v2.1.0 behavior contract and the `Unexpected input(s)` warning note. The [Production workflow example](../README.md#production-workflow-example) shows the line uncommented after the action is pinned to v2.1.0.

### 9. Do not pass `review-reference-file` until `review-reference-source: base` is available and enabled

> **Owner:** Consumer responsibility.

The default — and the recommended setting — is to **not pass `review-reference-file` at all**. The action ships a built-in default reference at [`defaults/review-reference.md`](../defaults/review-reference.md) that is frozen at the SHA you pinned this action to and is therefore immutable from a consuming PR's perspective. Both direct and wrapper consumers should rely on it until tamper-resistant base-mode reads ship in [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97).

The rule has two strict halves:

- **Wrappers (`workflow_call`)**: do **not** expose `review-reference-file` as a `workflow_call` input. There is no exception. This matches the "Defer until `review-reference-source: base` ships" category in the wrapper input-surface guidance — see [Extending the wrapper's input surface](../README.md#extending-the-wrappers-input-surface).
- **Direct consumers (`pull_request`)**: passing `review-reference-file` in workspace mode is allowed only when the consuming repo explicitly accepts that same-repo PR authors can steer the policy of their own PR's review. Document the consent in a comment on the workflow line so an auditor can see the decision was deliberate, not a default copy-paste.

**Why:** in the only mode that exists today (workspace mode), the reference file is checked out from `${{ github.event.pull_request.head.sha }}`. A same-repo PR author can include an edit to `.github/codex/review-reference.md` in the same PR and steer the review of that very PR — before any code-owner review can land, because the workflow runs on PR head, not on the merged result. The hardening from PR [#98](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/98) closes the file-disclosure path (no symlinks, no traversal, no `.git`, ≤64 KiB, regular file only) but does not pin the policy file's source to the base branch. Until [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97) ships, workspace mode is PR-controlled by design.

**Future state (after #97 ships):** the rule changes to "if you pass `review-reference-file`, you must also set `review-reference-source: base`." At that point the input becomes safe to expose from wrappers as well, with `base` as the wrapper's locked default.

**How to apply:** see [Customizing review rules per repository](../README.md#customizing-review-rules-per-repository) and [Constraints on `review-reference-file`](../README.md#constraints-on-review-reference-file) for the workspace-safety constraints in force today, and the callout in the [Production workflow example](../README.md#production-workflow-example) for the workspace-mode tamper-resistance gap. For wrappers, [Extending the wrapper's input surface](../README.md#extending-the-wrappers-input-surface) is the canonical reference.

## Why fork PRs are skipped

Two technical reasons drive the same-repo gate from item 3:

1. **Secrets are not available on fork-PR runs.** GitHub does not pass repository or environment secrets to workflows triggered from forks. So `${{ secrets.OPENAI_API_KEY }}` resolves to an empty string and `openai/codex-action` fails authentication. The job would fail noisily on every fork PR; the gate skips it cleanly instead.
2. **The skip is intentional, not a limitation.** The trade-off is the security property that makes the action safe to wire under `pull_request`: an attacker-controlled diff or script in a fork PR cannot exfiltrate the OpenAI key, because the key is never present in that workflow run. Letting fork PRs run would require either accepting that secrets reach untrusted code (wrong direction) or building a maintainer-triggered review path on trusted base-repo code (separate workflow, different threat model).

This repository does not ship a fork-PR review workflow. If you need one, the canonical pattern is a `workflow_dispatch` triggered by a maintainer that fetches the diff via the GitHub API and runs against trusted base-repo code — that workflow's design is out of scope for this action.

## Why publish must not receive the OpenAI key

The three-job split exists so that no single job has both write access to the repository and the OpenAI API key. The trust boundary is a privilege-separation argument, not a network-isolation argument:

- `prepare` (`contents: read`, no key) — builds the diff and chunks it. If compromised, an attacker has read-only access and no credentials to leak.
- `review` (`contents: read`, key in scope) — sends the prompt to OpenAI. If compromised, the attacker has the key but cannot write to the PR or the repository — the worst they can do is trigger OpenAI calls.
- `publish` (`contents: read` + `pull-requests: write`, no key) — posts the review. If compromised, the attacker can write to the PR but has no credentials to leak.

Putting the OpenAI key on the `publish` job collapses the second and third trust boundaries into one. A single attacker-controlled step on `publish` (a future maintainer mistake, an injected dependency, a compromised checkout step) would then have both write access **and** the key. The split exists specifically to prevent that combination from existing in any one job.

For the same reason, the `publish` job in your workflow must not declare `environment: codex-review` (or any other environment that scopes `OPENAI_API_KEY`). Doing so would make the key readable from `publish` even though no step inside it references the secret — environment scoping is per-job, not per-step.

## Company forks and wrappers

The fork-and-wrap adoption path documented in [Adopting in enterprise environments](../README.md#adopting-in-enterprise-environments) is a complementary control, not a replacement for the items above:

- A company fork **does not replace SHA pinning.** The fork still references composite-action `uses:` lines internally, and those references must be pinned to immutable SHAs inside the fork — including the transitive `openai/codex-action` pin. Forking moves the trust dependency from the upstream maintainer account to the fork's maintainers, but it does not eliminate the SHA-pinning discipline.
- The `allow-users` allowlist **does not replace fork gating.** `allow-users` controls *who* may trigger the prepare step among same-repo PR authors; the same-repo gate from item 3 controls *which PRs* the workflow runs on at all. A workflow with `allow-users` set but without the same-repo gate still runs on fork PRs (and fails noisily, see above). Both controls are required.

Wrapper consumers calling the org-internal reusable workflow inherit items 2, 3, 4, 5, 6, 7, and the wrapper-side half of item 9 from the wrapper's own workflow definition. Items 1 and 8, plus the direct-consumer half of item 9, remain the wrapper maintainer's responsibility.

## Audit summary

A consuming team's workflow is ready for production adoption when every item above is satisfied. If any item fails, fix it before adopting — the action does not provide security by default; the controls above are how the architecture is meant to be wired.

## Automated audit via `codex-review:adopt`

The `adopt` capability of the [`codex-review`](../skills/codex-review/) Claude Code skill emits an `ADOPTION.md` report that maps every emitted decision to one of `CC-01..CC-09` plus the bare-action detection rule (`CC-EXTRA-01-bare-action`). The capability refuses to write any artifact unless every applicable invariant in this checklist passes. The IDs are encoded in [`skills/codex-review/references/invariants.md`](../skills/codex-review/references/invariants.md); a unit test in the same directory asserts every `CC-NN` ID still has a matching numbered heading in this file, so renumbering or renaming items requires a coordinated change.

Running the skill does not replace human review of the generated workflow. The audit list above remains the source of truth; the skill is a faster path to the same outcome.
