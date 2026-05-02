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

### Safe `review-reference-file` values

The `review-reference-file` input names a path inside the checked-out workspace, which on a `pull_request` run contains PR-controlled content. To prevent a PR from coercing the prepare step into reading runner-local files outside the workspace (e.g. `/proc/self/environ`) or runner-managed git state (e.g. `.git/config`) and forwarding their contents to OpenAI in the prompt, the value must satisfy every rule below. Anything else fails closed before the file is read:

- workspace-relative — absolute paths (POSIX or Windows-style), backslashes, and NUL bytes are rejected;
- contained — the resolved path stays under `$GITHUB_WORKSPACE` after POSIX normalization (`../...` is rejected);
- not under `.git` — paths whose first component is `.git` (any casing) are rejected, because the contents of the runner's `.git` directory are runtime state, not PR content;
- a regular file — directories, FIFOs, devices, and any kind of symbolic link (leaf or ancestor directory) are rejected;
- bounded — at most 64 KiB.

A workspace-relative path that meets these rules (for example, `.github/codex/review-reference.md`) still represents PR-controlled content: a PR can legitimately edit the reference and steer the review prompt, and any other workspace file the PR is allowed to commit can be referenced too. Tamper-resistant policy reads from the base branch are tracked in [issue #97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97); until that ships, treat workspace-mode references as PR-authored policy.

Adopters on `<= v2.0.x` should either upgrade to a release that contains this hardening or stop passing `review-reference-file` until they do.

The three-job architecture splits responsibilities by permission scope:

- `prepare` (`contents: read`) — builds the PR diff, splits it into chunks, and assembles prompts. No write access; does not require or receive the OpenAI API key.
- `review` (`contents: read`) — invokes `openai/codex-action` per chunk in parallel. This is the only job that requires the OpenAI API key, and it has no write access to the repository.
- `publish` (`contents: read`, `pull-requests: write`) — merges chunk reviews and posts the PR review with inline comments. Does not require or receive the OpenAI API key.

If you believe any of these defenses can be bypassed, please report it using the process above.

## Release automation identity

Release automation is performed by a dedicated GitHub App installed only on this repository. The App identity is `codex-review-action-release-bot[bot]` in audit logs and PR authorship.

### Permission scope

The App has these repository permissions, and only these:

- `Contents: Read and write` — push release branches, create version tags
- `Pull requests: Read and write` — open release PRs and post-release refresh PRs
- `Workflows: Read and write` — required by GitHub when pushes touch any workflow file
- `Metadata: Read-only` — required by GitHub for any installed App

The App has no organization permissions, no user permissions, no webhook, and no installations on other repositories.

### Credentials

App credentials are stored at the repo level (Settings → Secrets and variables → Actions):

- `RELEASE_APP_ID` (variable) — the App's numeric ID. Not a secret; stored as a repo variable so workflows can reference it via `vars.RELEASE_APP_ID`.
- `RELEASE_APP_PRIVATE_KEY` (secret) — the App's signing key. Release-automation workflows are expected to feed this into a token-minting Action (e.g. `actions/create-github-app-token`) to obtain short-lived installation tokens at runtime.

GitHub App installation tokens expire automatically (one-hour default) and are scoped to the installation rather than to a specific workflow run, so a leaked token remains usable until expiry or explicit revocation. Release-automation workflows are expected to mint a token at job start and revoke it at job end (the default post-step behavior of `actions/create-github-app-token`); the App identity itself does not enforce that. Maintainers rotate the private key by generating a new one on the App settings page and replacing the secret value; old keys remain valid until manually revoked.

### Why an App instead of `GITHUB_TOKEN`

PRs opened by the default `GITHUB_TOKEN` do not trigger downstream workflows (a documented anti-recursion safeguard). Release automation requires that release PRs run their normal CI checks before merging, so the App identity is necessary. PATs are avoided because they tie automation to a person and have broader permission scopes than this use needs.
