# Codex AI Code Review

[![Tests](https://github.com/milanhorvatovic/codex-ai-code-review-action/actions/workflows/tests.yaml/badge.svg)](https://github.com/milanhorvatovic/codex-ai-code-review-action/actions/workflows/tests.yaml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmilanhorvatovic%2Fcodex-ai-code-review-action%2Fbadges%2Fcoverage.json)](https://github.com/milanhorvatovic/codex-ai-code-review-action/actions/workflows/tests.yaml)

AI-powered code review GitHub Action using [OpenAI Codex](https://github.com/openai/codex-action). Three-job design with security isolation: read-only prepare job (diff chunking, prompt assembly), read-only review job (parallel chunk reviews via `openai/codex-action`), and write-access publish job (chunk merging, inline PR comments, per-file summaries, verdict). Fully configurable prompts, models, confidence thresholds, and user allowlists.

## Trust model

PR diffs, title, body, and metadata leave your runner only via two destinations:

- **GitHub** — for fetching the PR base commit, posting the review, and storing inter-job artifacts. This is expected behaviour for any GitHub Action.
- **OpenAI** — via [`openai/codex-action`](https://github.com/openai/codex-action), which sends the prompt (including the diff) to OpenAI's API to generate the review.

This repository does **not** operate any maintainer-owned backend, proxy, analytics service, or telemetry pipeline that receives diffs. There is no data destination beyond GitHub and OpenAI. The action does not phone home, and it does not collect usage data beyond what `openai/codex-action` itself does.

Two trust questions are commonly conflated; they have different answers:

- *"Does OpenAI see the diff?"* — **Yes.** The review job invokes `openai/codex-action`, which calls OpenAI's API with the prompt and the diff. This is the explicit purpose of the action.
- *"Does the action maintainer see the diff?"* — **No.** No maintainer-operated destination exists. The action's source is auditable in this repository, and `openai/codex-action` is SHA-pinned in [`review/action.yaml`](review/action.yaml) (currently `@086169432f1d2ab2f4057540b1754d550f6a1189`, v1.4) so the referenced commit is immutable unless this repo bumps the SHA. (Runtime behaviour of OpenAI's API and model selection are outside this guarantee — see OpenAI's data-handling terms.)

This action reduces risk when wired safely (read-only `prepare` and `review`, write access scoped to `publish`), but it does not make sending diffs to OpenAI risk-free. Evaluate OpenAI's data-handling terms separately for your organisation.

## Minimal quick start

Create `.github/workflows/codex-review.yaml` in your repository:

```yaml
name: Codex code review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

concurrency:
  group: codex-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  prepare:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      skipped: ${{ steps.prepare.outputs.skipped }}
      has-changes: ${{ steps.prepare.outputs.has-changes }}
      chunk-count: ${{ steps.prepare.outputs.chunk-count }}
      chunk-matrix: ${{ steps.prepare.outputs.chunk-matrix }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - id: prepare
        uses: milanhorvatovic/codex-ai-code-review-action/prepare@v2

      - uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
        if: steps.prepare.outputs.skipped != 'true' && steps.prepare.outputs.has-changes == 'true'
        with:
          name: codex-prepare
          path: .codex/
          include-hidden-files: true
          retention-days: 1

  review:
    needs: prepare
    if: needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJson(needs.prepare.outputs.chunk-matrix) }}
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/review@v2
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          chunk: ${{ matrix.chunk }}

  publish:
    needs: [prepare, review]
    if: always() && needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: .codex/
          merge-multiple: true

      - uses: milanhorvatovic/codex-ai-code-review-action/publish@v2
        with:
          github-token: ${{ github.token }}
          expected-chunks: ${{ needs.prepare.outputs.chunk-count }}
```

> **Note:** This is a minimal functional example, not a hardened production workflow. Before using it for a team or private repository, review the [Trust model](#trust-model) and [Security guidance](#security-guidance) sections, and consider the [Production workflow example](#production-workflow-example).

## Security guidance

The subsections below describe how to wire this action into a workflow safely.

### Do not use `pull_request_target`

> Always use `pull_request` as the trigger for this action. `pull_request_target` runs the workflow YAML from the base branch, but it executes in the base-repository context with access to repository secrets and broader token permissions. When a workflow handles untrusted pull request content, that combination creates a straightforward secret-exfiltration path for a malicious fork PR.
>
> The risk is not that a fork PR can edit the workflow file and have that modified YAML execute under `pull_request_target` — it cannot. The risk is that the trusted base-branch workflow may still execute attacker-controlled code from the PR. For example, if the workflow checks out `${{ github.event.pull_request.head.sha }}` and then runs a repository script such as `./scripts/review.sh`, a fork PR can modify that script to exfiltrate `OPENAI_API_KEY`. With `pull_request_target`, that attacker-controlled script runs with secrets in scope. With `pull_request`, repository secrets are not exposed to the fork PR workflow, so the same script has nothing useful to steal.

### Pinning the action

GitHub recommends pinning third-party actions to a full commit SHA for the strongest supply-chain protection. See GitHub's [security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) for the canonical guidance.

Pick one of the two forms below — they are alternatives, not steps to combine.

Convenient — follows the `v2` tag. Trusts future releases from the maintainer account:

```yaml
- id: prepare
  uses: milanhorvatovic/codex-ai-code-review-action/prepare@v2
```

Security-conscious — immutable. Immune to tag movement or account compromise. Replace `<tag>` with the release tag you want to pin (e.g., `v2.0.0`) and `<full-sha>` with its commit SHA; resolve the SHA with `gh api repos/milanhorvatovic/codex-ai-code-review-action/commits/<tag> --jq '.sha'`:

```yaml
- id: prepare
  uses: milanhorvatovic/codex-ai-code-review-action/prepare@<full-sha> # v2.0.0
```

Version tags are mutable references controlled by the maintainer account, while SHA pinning removes that trust dependency.

The same pattern applies to the `review` and `publish` actions. Pin all three sub-actions to the **same** `<full-sha>` from a single release — `prepare`, `review`, and `publish` share artifact layout and schema, and mixing SHAs from different releases can break the workflow:

```yaml
- uses: milanhorvatovic/codex-ai-code-review-action/review@<full-sha> # v2.0.0
- uses: milanhorvatovic/codex-ai-code-review-action/publish@<full-sha> # v2.0.0
```

Inside this repository, `review/action.yaml` SHA-pins `openai/codex-action`. That transitive pin is only frozen for you when you pin this action itself to a full SHA — at the SHA you chose, `review/action.yaml` is fixed and the `openai/codex-action` reference cannot move. Pinning to `@v2` does not carry that guarantee: a future `v2` release can update the transitive SHA.

## Production workflow example

The Minimal quick start prioritises legibility. Use this section instead when adopting the action in a private repository, an enterprise org, or any setting where you want fewer assumptions about who can trigger reviews and tighter blast-radius controls. The example below preserves every guardrail from the Minimal quick start and adds runner pinning, an environment-scoped API key, a PR-author allowlist (gated on `pull_request.user.login`, not `github.actor`, so a maintainer re-run does not bypass it), immutable SHAs for this action's three sub-actions, per-job timeouts, and a same-repo trigger restriction.

### One-time repo setup

The example references a GitHub Environment named `codex-review` that scopes the OpenAI API key. Configure it once before adopting the workflow:

1. Navigate to **Settings → Environments → New environment** and create one named `codex-review` (the workflow references this string verbatim — lowercase, hyphen).
2. Inside that environment, add `OPENAI_API_KEY` as an **environment secret**, not a repository secret. If a repo-scoped copy already exists, remove it after confirming the environment-scoped copy works — that way a future workflow without `environment: codex-review` cannot read the key.
3. Leave **Required reviewers** empty. The `review` job uses a matrix strategy, so a required reviewer would prompt once per chunk and block every PR. The environment exists only to scope the secret; PR-level gating is handled by the `allow-users` allowlist below.
4. Leave **Deployment branches** at the default (all branches) unless you want to restrict reviews to PRs targeting specific branches.

If step 1 is missed, the `review` job fails at schedule time with `The job was not started because it requires environment 'codex-review' which does not exist.` If `OPENAI_API_KEY` is not defined anywhere, `${{ secrets.OPENAI_API_KEY }}` resolves to an empty string and `openai/codex-action` fails authentication. If the secret exists only at repository scope, the workflow still runs because repository secrets remain visible to jobs that declare an `environment:` — the workflow appears healthy but the environment-scoping guardrail is not enforced until the repo-scoped copy is removed.

### Workflow

Create `.github/workflows/codex-review.yaml`:

```yaml
name: Codex code review (hardened)

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

concurrency:
  group: codex-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  prepare:
    # Skip drafts; refuse fork PRs so secrets and broader permissions never see fork-controlled code.
    if: ${{ !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-24.04 # pinned image; bump as GitHub retires older runner versions
    permissions:
      contents: read
    timeout-minutes: 10
    outputs:
      skipped: ${{ steps.prepare.outputs.skipped }}
      has-changes: ${{ steps.prepare.outputs.has-changes }}
      chunk-count: ${{ steps.prepare.outputs.chunk-count }}
      chunk-matrix: ${{ steps.prepare.outputs.chunk-matrix }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.pull_request.head.sha }} # all jobs check out the same SHA the workflow was triggered on
          fetch-depth: 0
          persist-credentials: false

      - id: prepare
        # SHA corresponds to tag v2.0.0 — update when adopting a new release.
        uses: milanhorvatovic/codex-ai-code-review-action/prepare@af72a5bd7330432cee97137b04d04edebde80149 # v2.0.0
        with:
          allow-users: alice,bob,charlie # replace with real GitHub usernames; an empty value allows everyone

      - uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
        if: steps.prepare.outputs.skipped != 'true' && steps.prepare.outputs.has-changes == 'true'
        with:
          name: codex-prepare
          path: .codex/
          include-hidden-files: true # .codex/ is dot-prefixed; without this the upload silently skips it
          retention-days: 1 # ephemeral hand-off; default 90 days burns storage and lengthens diff retention

  review:
    needs: prepare
    if: needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: codex-review # scopes OPENAI_API_KEY; do not add required reviewers (matrix would trigger one prompt per chunk)
    permissions:
      contents: read
    timeout-minutes: 30 # applies per matrix leg, not total — bound on a single chunk's Codex run, not a budget across all chunks
    strategy:
      fail-fast: false # one failing chunk must not cancel the others; partial output is recoverable
      matrix: ${{ fromJson(needs.prepare.outputs.chunk-matrix) }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: milanhorvatovic/codex-ai-code-review-action/review@af72a5bd7330432cee97137b04d04edebde80149 # v2.0.0
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          chunk: ${{ matrix.chunk }}

  publish:
    needs: [prepare, review]
    # always() keeps publish running when a review matrix leg fails so partial output still posts.
    if: always() && needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: .codex/
          merge-multiple: true

      - uses: milanhorvatovic/codex-ai-code-review-action/publish@af72a5bd7330432cee97137b04d04edebde80149 # v2.0.0
        with:
          github-token: ${{ github.token }}
          expected-chunks: ${{ needs.prepare.outputs.chunk-count }}
          retain-findings: false # explicit for auditors; matches the action default
          # fail-on-missing-chunks: "true" # available in the next tagged release; uncomment after bumping the SHAs above
```

When you adopt a release that contains [issue #44](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/44), bump the three `codex-ai-code-review-action` SHAs to that release and uncomment `fail-on-missing-chunks: "true"` to make the publish step fail closed when any chunk is missing.

## Architecture

The workflow is split into three jobs for security isolation:

| Job | Permissions | Purpose |
|-----|-------------|---------|
| `prepare` | `contents: read` | Build diff, split into chunks, assemble prompts |
| `review` | `contents: read` | Review each chunk in parallel via matrix, powered by [`openai/codex-action`](https://github.com/openai/codex-action) |
| `publish` | `contents: read`, `pull-requests: write` | Merge chunk reviews, post PR review with inline comments |

The prepare job never gets write access. The review job has the OpenAI API key but no write access. The publish job never sees the API key. Artifact handoff between jobs is explicit.

```
prepare job                 review job (matrix)         publish job
───────────                 ───────────────────         ────────────
check allowlist             download artifacts          download all artifacts
build PR diff (git)         run openai/codex-action     merge chunk reviews
split diff into chunks      upload chunk output         validate merged JSON
assemble prompts                                        publish review
write schema                                              ├── PR review body
upload artifacts ────────── ▶                              ├── inline comments
                                          ──────────── ▶   ├── verdict + confidence
                                                           └── per-file summary
```

## Configuration

### Prepare action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | No | `github.token` | GitHub token for fetching PR base commit |
| `allow-users` | No | all users | Comma-separated list of GitHub usernames who can run this action |
| `review-reference-file` | No | built-in | Path to custom review reference |
| `max-chunk-bytes` | No | `204800` | Target max bytes per diff chunk (splits at file boundaries) |

### Prepare action outputs

| Output | Description |
|--------|-------------|
| `skipped` | Whether review was skipped (`true`/`false`) |
| `has-changes` | Whether the diff has changes |
| `chunk-count` | Number of chunks produced |
| `chunk-matrix` | JSON-encoded matrix for chunk-based jobs |

### Review action inputs

The review action wraps [`openai/codex-action`](https://github.com/openai/codex-action) and handles artifact download/upload automatically.

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `openai-api-key` | Yes | — | OpenAI API key for Codex |
| `chunk` | Yes | — | Chunk index to review (from `chunk-matrix` output) |
| `model` | No | Codex CLI default | OpenAI model to use |
| `effort` | No | Codex CLI default | Reasoning effort the agent should use |

### Publish action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | — | Token for posting reviews (`pull-requests: write`) |
| `expected-chunks` | No | — | Expected chunk count. On mismatch, the publish step logs a warning, renders an "Incomplete review" banner in the published review body (v2.1.0+), and (when `fail-on-missing-chunks: true`, also v2.1.0+) fails the step after publishing. |
| `fail-on-missing-chunks` | No | `false` | _Since v2.1.0._ After publishing, fail the publish step when any expected chunks are missing from the review artifacts. Partial reviews are always published with an "Incomplete review" banner regardless of this setting; the banner uses the `WARNING` admonition by default and `CAUTION` when this input is `true`. "Missing" here means the chunk artifact is absent **or** present but failed schema validation. No-op when `expected-chunks` is unset or `0`. Setting this input on `@v2.0.0` (or any earlier SHA) typically produces an `Unexpected input(s)` warning and the input is ignored rather than failing the workflow; pin the action to `@v2.1.0` or later before enabling it. |
| `model` | No | — | Model name for review footer (overridden by the model field in review output) |
| `review-effort` | No | — | Effort label for review footer |
| `min-confidence` | No | `0` | Minimum confidence threshold (0.0-1.0) |
| `max-comments` | No | unlimited | Maximum inline comments (0 to disable) |
| `retain-findings` | No | `false` | Upload findings as long-lived artifact |
| `retain-findings-days` | No | `90` | Days to retain findings artifact (1-90, clamped to 90) |

### Publish action outputs

| Output | Description |
|--------|-------------|
| `findings-count` | Total findings in merged review |
| `verdict` | `patch is correct` or `patch is incorrect` |
| `review-file` | Path to the merged review JSON |
| `published` | Whether review was posted (`true`/`false`) |

## Customizing review rules per repository

The review reference file controls what the AI focuses on during reviews — language-specific checklists, focus areas, examples, and confidence calibration.

To customize, create `.github/codex/review-reference.md` in your repository and pass it:

```yaml
- id: prepare
  uses: milanhorvatovic/codex-ai-code-review-action/prepare@v2
  with:
    review-reference-file: .github/codex/review-reference.md
```

See [`defaults/review-reference.md`](defaults/review-reference.md) for the structure and examples.

## Adopting in enterprise environments

Some organisations have policies that prohibit running non-vendor public actions in sensitive repositories — even when those actions are SHA-pinned. The fork-and-wrap pattern documented below is a first-class adoption path for those environments, not a workaround.

The pattern uses two distinct internal repositories:

- **`<org>/codex-ai-code-review-action-fork`** — the forked action itself (this repository, mirrored into the org). Consumers never reference this directly.
- **`<org>/codex-review-internal`** — an org-owned repository that hosts a reusable workflow wrapping the fork. Product repos call this reusable workflow via `workflow_call`.

Naming the repos separately makes the layering visible: the fork carries the action source, while the wrapper repo carries the org's trigger, secret, and environment policy. Use whichever names match your org convention — the key is that they are two different repositories.

### 1. Fork or mirror this repository

Two acceptable options; pick based on how you want upstream updates to flow.

- **True fork** (via GitHub's fork button or `gh repo fork`) preserves the upstream-tracking relationship. GitHub surfaces "N commits behind" and your fork can open PRs back to the public repo. Use when your security team wants upstream visibility baked in.
- **Detached mirror** (`git clone --mirror <upstream> && git push --mirror <org-repo>`) creates a fully detached copy with no upstream link. Use when policy requires the internal repository to have no visible dependency on the public one. The cost is manual upstream tracking — periodic `git remote add upstream` plus `git fetch` on a maintainer clone.

Document the choice inline in the fork's `README.md` so future maintainers know which model is in play.

### 2. Pin all action references inside the fork

Pin every `uses:` reference in the fork to an immutable SHA, including the transitive pin of `openai/codex-action` in [`review/action.yaml`](review/action.yaml) (currently `@086169432f1d2ab2f4057540b1754d550f6a1189 # v1.4`). Update the transitive pin on the org's own schedule, not OpenAI's — each bump is a trust-boundary change and should go through whatever internal review the org applies to other vendor dependencies.

### 3. Create an org-owned reusable workflow

Build a reusable workflow inside `<org>/codex-review-internal` that wraps the forked sub-actions. Product repos call this workflow; they do not reference the fork directly. The wrapper repo is where centralised trigger, secret, and environment policy lives.

### 4. Restrict product repos to the internal version

Configure org-level policy so that product repos can only invoke `<org>/codex-review-internal/.github/workflows/...` and not the public `<owner>/codex-ai-code-review-action/...` references. GitHub allows actions to be shared across repositories within the same organisation without Marketplace publication via **Settings → Actions → Allow actions from repositories within the organization**.

### 5. Pull upstream updates deliberately

Watch the upstream `CHANGELOG.md` and review each release internally before adopting. Treat each fork-side SHA bump (and each transitive `openai/codex-action` bump) the same way the org treats other vendor dependency upgrades.

### Example consumer workflow

The product repo's workflow looks like this:

```yaml
# .github/workflows/code-review.yaml in a product repo
name: Code review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

jobs:
  review:
    uses: <org>/codex-review-internal/.github/workflows/codex-review.yaml@<full-sha>
    permissions:
      contents: read
      pull-requests: write
    secrets:
      openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

A reusable workflow can _narrow_ but not _widen_ the caller's `GITHUB_TOKEN` scope. The `permissions:` block above is required whenever the consumer repo's (or its org's) default `GITHUB_TOKEN` permissions are read-only — i.e. anything narrower than `pull-requests: write`. Omitting it then makes the wrapper inherit the read-only default, and the publish job fails with `Resource not accessible by integration` even though the wrapper itself declares `pull-requests: write` at job level. Repos whose default `GITHUB_TOKEN` already includes `pull-requests: write` work without the explicit block, but spelling it out at the call site is recommended for defence-in-depth and to make the workflow portable across orgs with different defaults.

### Example wrapper workflow

The wrapper inside `<org>/codex-review-internal/.github/workflows/codex-review.yaml` mirrors the [Production workflow example](#production-workflow-example) with three substitutions: the `uses:` references point at the fork, `OPENAI_API_KEY` flows in via `workflow_call.secrets`, and the trigger is `workflow_call` instead of `pull_request`.

```yaml
name: Codex review (org-wrapped)

on:
  workflow_call:
    secrets:
      openai-api-key:
        required: true

jobs:
  prepare:
    if: github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    outputs:
      skipped: ${{ steps.prepare.outputs.skipped }}
      has-changes: ${{ steps.prepare.outputs.has-changes }}
      chunk-count: ${{ steps.prepare.outputs.chunk-count }}
      chunk-matrix: ${{ steps.prepare.outputs.chunk-matrix }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha }}
      - id: prepare
        uses: <org>/codex-ai-code-review-action-fork/prepare@<full-sha> # v2.0.0
        with:
          allow-users: alice,bob,charlie
      - uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
        if: steps.prepare.outputs.skipped != 'true' && steps.prepare.outputs.has-changes == 'true'
        with:
          name: codex-prepare
          path: .codex/
          include-hidden-files: true
          retention-days: 1

  review:
    needs: prepare
    if: >-
      github.event.pull_request.head.repo.full_name == github.repository
      && needs.prepare.outputs.skipped != 'true'
      && needs.prepare.outputs.has-changes == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: codex-review
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJson(needs.prepare.outputs.chunk-matrix) }}
    steps:
      - uses: <org>/codex-ai-code-review-action-fork/review@<full-sha> # v2.0.0
        with:
          chunk: ${{ matrix.chunk }}
          openai-api-key: ${{ secrets.openai-api-key }}

  publish:
    needs: [prepare, review]
    if: >-
      always()
      && github.event.pull_request.head.repo.full_name == github.repository
      && needs.prepare.outputs.skipped != 'true'
      && needs.prepare.outputs.has-changes == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: .codex/
          merge-multiple: true
      - uses: <org>/codex-ai-code-review-action-fork/publish@<full-sha> # v2.0.0
        with:
          github-token: ${{ github.token }}
          expected-chunks: ${{ needs.prepare.outputs.chunk-count }}
          retain-findings: "false"
          # fail-on-missing-chunks: "true"
```

#### Differences from the Production workflow example

1. **Secret naming.** The `review` job reads `${{ secrets.openai-api-key }}` (lowercase, scoped to this `workflow_call`), not `${{ secrets.OPENAI_API_KEY }}`. `workflow_call` secret names are defined by the reusable workflow, not inherited from the caller's secret scope. Stored repo/org secrets are restricted to `[A-Za-z0-9_]`, but `workflow_call` pass-through names accept hyphens — the caller maps a stored `OPENAI_API_KEY` to the hyphenated `workflow_call` name in its `secrets:` block.
2. **Trigger.** `on: workflow_call` instead of `on: pull_request`. The product repo's workflow owns the `pull_request` trigger; this wrapper only accepts `workflow_call` invocations.
3. **No explicit `checkout` in `review` or `publish`.** The `review` composite action downloads the prepare artifact internally, and the `publish` job only needs the artifact contents, not the repo tree.
4. **`environment: codex-review` resolves against the wrapper repo, not the consumer repo.** When a called workflow declares `environment:`, GitHub looks it up in the **repo that hosts the called workflow** (`<org>/codex-review-internal`).
5. **`fail-on-missing-chunks` is left commented out.** Uncomment it after bumping the three sub-action SHAs to a release that includes this input.

#### Environment setup deltas

The general environment setup steps are documented in [One-time repo setup](#one-time-repo-setup). The following deltas apply to the wrapper-repo location:

- Create the `codex-review` environment on **`<org>/codex-review-internal`**, not on each product repo. The same matrix-leg caveat from the linked subsection applies — leave **Required reviewers** empty, since a required reviewer would prompt once per chunk.
- **Do not bind `OPENAI_API_KEY` as an environment secret on the wrapper repo.** The secret does not flow through the environment in this design — it is passed by the caller via `workflow_call.secrets.openai-api-key` and referenced inside the `review` job as `${{ secrets.openai-api-key }}`. Binding it to the environment would be dead weight and would expose the wrapper-repo's maintainers to an unnecessary credential surface.
- The `environment:` line therefore exists only as a _policy hook_ — deployment protection rules, audit trail, tag-gated deployments. **Drop the `environment: codex-review` line entirely** if the org does not use GitHub's deployment-protection features; the wrapper keeps working because all real secret-scoping happens via `workflow_call.secrets`.
- Failure mode if `environment:` is kept but the env is not created on the wrapper repo: every consumer call fails with `The job was not started because it requires environment 'codex-review' which does not exist.` The diagnostic reads as if the caller is at fault, but the environment must be created on the wrapper repo — adding it to the product repo will not fix the failure.

#### Output and input names are load-bearing

The wrapper threads four `prepare` outputs (`skipped`, `has-changes`, `chunk-count`, `chunk-matrix`) into the `review` and `publish` jobs, and passes `matrix.chunk` to the `review` action as a plain chunk index. These names are defined by [`prepare/action.yaml`](prepare/action.yaml) and [`review/action.yaml`](review/action.yaml). Renaming any of them in the wrapper silently breaks the workflow.

#### Extending the wrapper's input surface

The example above only exposes the OpenAI API key via `workflow_call.secrets`. If product repos need to tune `allow-users`, `review-reference-file`, `max-chunk-bytes`, `min-confidence`, or other per-repo knobs, add them to `on.workflow_call.inputs:` in the wrapper and thread them down into the matching `with:` blocks. Keep the input surface minimal — every input exposed becomes a policy decision the wrapper has to enforce.

### Enterprise adoption checklist

A security team can run through this list before approving adoption:

- Forked or mirrored to an org-owned repo
- All action references in the fork pinned to immutable SHAs
- Transitive `openai/codex-action` pin reviewed and (if desired) re-pinned
- Org-owned reusable workflow exists and wraps the fork
- Product repos call only the reusable workflow
- Centralised trigger, secret, and environment policy documented
- Upstream-update process defined (who reviews, how often, what triggers re-review)
- Rollback plan documented (how to revert to the previous SHA)

## Setup

1. Add `OPENAI_API_KEY` as a repository secret (Settings > Secrets and variables > Actions)
2. Create the workflow file as shown in [Minimal quick start](#minimal-quick-start)
3. Optionally create `.github/codex/review-reference.md` for repo-specific review rules
4. Open a pull request — the review appears automatically

## Development

Prerequisites: Node 24

```bash
npm install          # Install dependencies
npm run build        # Build dist bundles
npm test             # Run tests
npm run test -- --coverage  # Run tests with coverage
npm run lint         # Lint source code
npm run typecheck    # Type check
```

## Version history

See the [`CHANGELOG`](CHANGELOG.md) for details.

## License

This project is licensed under the [MIT](LICENSE).
