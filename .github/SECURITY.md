# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x | Yes |
| 1.x | No (see [CHANGELOG](../CHANGELOG.md) for migration to 2.x) |

## Data destinations

PR diffs and metadata leave the runner only via two destinations: **GitHub** (PR context, posting the review, artifact storage) and **OpenAI** (via the SHA-pinned [`openai/codex-action`](https://github.com/openai/codex-action) invoked from `review/action.yaml`). This repository operates no maintainer-owned backend, proxy, analytics service, or telemetry pipeline that receives diffs. See the [Trust model](../README.md#trust-model) section in the README for the full statement.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public issue.
2. Use [GitHub's private vulnerability reporting](https://github.com/milanhorvatovic/codex-ai-code-review-action/security/advisories/new) to submit your report.
3. Include steps to reproduce, impact assessment, and suggested fix if possible.

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Considerations

This action processes untrusted input (PR diffs and metadata). It mitigates prompt injection via backtick neutralization, dynamic fencing, and untrusted-data labeling.

The three-job architecture splits responsibilities by permission scope:

- `prepare` (`contents: read`) — builds the PR diff, splits it into chunks, and assembles prompts. No write access; does not require or receive the OpenAI API key.
- `review` (`contents: read`) — invokes `openai/codex-action` per chunk in parallel. This is the only job that requires the OpenAI API key, and it has no write access to the repository.
- `publish` (`contents: read`, `pull-requests: write`) — merges chunk reviews and posts the PR review with inline comments. Does not require or receive the OpenAI API key.

If you believe any of these defenses can be bypassed, please report it using the process above.
