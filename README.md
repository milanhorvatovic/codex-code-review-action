# codex-code-review-action

[![Tests](https://github.com/milanhorvatovic/codex-code-review-action/actions/workflows/tests.yaml/badge.svg)](https://github.com/milanhorvatovic/codex-code-review-action/actions/workflows/tests.yaml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmilanhorvatovic%2Fcodex-code-review-action%2Fbadges%2Fcoverage.json)](https://github.com/milanhorvatovic/codex-code-review-action/actions/workflows/tests.yaml)

AI-powered code review GitHub Action using OpenAI Codex. Two-job design with security isolation: read-only review job (diff chunking, prompt assembly, structured findings) and write-access publish job (inline PR comments, per-file summaries, verdict). Fully configurable prompts, models, confidence thresholds, and user allowlists.

## Quick start

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
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: milanhorvatovic/codex-code-review-action/review@v1
        id: review
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}

      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        if: steps.review.outputs.skipped != 'true' && steps.review.outputs.has-changes == 'true'
        with:
          name: codex-review
          path: |
            .codex/review-output.json
            .codex/pr.diff
          include-hidden-files: true
          retention-days: 1

    outputs:
      skipped: ${{ steps.review.outputs.skipped }}
      has-changes: ${{ steps.review.outputs.has-changes }}

  publish:
    needs: review
    if: needs.review.outputs.skipped != 'true' && needs.review.outputs.has-changes == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: codex-review
          path: .codex/

      - uses: milanhorvatovic/codex-code-review-action/publish@v1
```

## Architecture

The action is split into two Node 22 TypeScript actions for security isolation:

| Action | Job permissions | Purpose |
|--------|----------------|---------|
| `review` | `contents: read` | Build diff, split into chunks, assemble prompts, call OpenAI API, merge results |
| `publish` | `contents: read`, `pull-requests: write` | Validate review output, post PR review with inline comments |

The review job never gets write access to the repository — it only needs a read-only GitHub token (for fetching the base commit) and the OpenAI API key. The publish job never sees the OpenAI API key. Artifact handoff between jobs is explicit.

```
review job                              publish job
───────────                             ────────────
check allowlist                         validate JSON
build PR diff (git)                     publish review
split diff into chunks                    ├── PR review body
assemble prompts                          ├── inline comments
call OpenAI API (per chunk)               ├── verdict + confidence
merge chunk results                       └── per-file summary
       │                                        ▲
       └── upload .codex/ ──────────── download .codex/
```

## Configuration

### Review action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `openai-api-key` | Yes | — | OpenAI API key |
| `model` | No | API default | OpenAI model to use (e.g. `o4-mini`, `codex-mini-latest`). When omitted, the OpenAI API selects its current default model. |
| `github-token` | No | `github.token` | GitHub token for fetching PR base commit |
| `allowed-users` | No | all users | Comma-separated allowlist of GitHub usernames |
| `review-reference-file` | No | built-in | Path to custom review reference |
| `max-chunk-bytes` | No | `204800` | Target max bytes per diff chunk (splits at file boundaries) |
| `retain-findings` | No | `false` | Upload findings as long-lived artifact |
| `retain-findings-days` | No | `90` | Number of days to retain the findings artifact when `retain-findings` is `true` (must be between `1` and `90`) |

### Publish action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | `github.token` | Token for posting reviews (`pull-requests: write`) |
| `model` | No | — | Model name for review footer |
| `review-effort` | No | — | Effort label for review footer |
| `min-confidence` | No | `0` | Minimum confidence threshold (0.0-1.0) |
| `max-comments` | No | unlimited | Maximum inline comments (0 to disable) |

### Review action outputs

| Output | Description |
|--------|-------------|
| `skipped` | Whether review was skipped (`true`/`false`) |
| `has-changes` | Whether the diff has changes |
| `chunk-count` | Number of chunks processed |
| `chunk-matrix` | JSON-encoded chunk metadata for the review run |
| `findings-count` | Total findings |
| `verdict` | `patch is correct` or `patch is incorrect` |

### Publish action outputs

| Output | Description |
|--------|-------------|
| `review-file` | Path to the review JSON |
| `published` | Whether review was posted (`true`/`false`) |

## Customizing review rules per repository

The review reference file controls what the AI focuses on during reviews — language-specific checklists, focus areas, examples, and confidence calibration.

To customize, create `.github/codex/review-reference.md` in your repository and pass it:

```yaml
- uses: milanhorvatovic/codex-code-review-action/review@v1
  with:
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    review-reference-file: .github/codex/review-reference.md
```

See [`defaults/review-reference.md`](defaults/review-reference.md) for the structure and examples.

## Setup

1. Add `OPENAI_API_KEY` as a repository secret (Settings > Secrets and variables > Actions)
2. Create the workflow file as shown in [Quick start](#quick-start)
3. Optionally create `.github/codex/review-reference.md` for repo-specific review rules
4. Open a pull request — the review appears automatically

## Development

Prerequisites: Node 22

```bash
npm install          # Install dependencies
npm run build        # Build dist bundles
npm test             # Run tests
npm run test -- --coverage  # Run tests with coverage
npm run lint         # Lint source code
npm run typecheck    # Type check
```

## License

This project is licensed under the [MIT](LICENSE).
