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
  uses: milanhorvatovic/codex-ai-code-review-action/prepare@<full-sha> # <tag>
```

Version tags are mutable references controlled by the maintainer account, while SHA pinning removes that trust dependency.

The same pattern applies to the `review` and `publish` actions. Pin all three sub-actions to the **same** `<full-sha>` from a single release — `prepare`, `review`, and `publish` share artifact layout and schema, and mixing SHAs from different releases can break the workflow:

```yaml
- uses: milanhorvatovic/codex-ai-code-review-action/review@<full-sha> # <tag>
- uses: milanhorvatovic/codex-ai-code-review-action/publish@<full-sha> # <tag>
```

Inside this repository, `review/action.yaml` SHA-pins `openai/codex-action`. That transitive pin is only frozen for you when you pin this action itself to a full SHA — at the SHA you chose, `review/action.yaml` is fixed and the `openai/codex-action` reference cannot move. Pinning to `@v2` does not carry that guarantee: a future `v2` release can update the transitive SHA.

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
| `expected-chunks` | No | — | Expected chunk count. Warns on mismatch but still publishes partial review. |
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
