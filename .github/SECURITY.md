# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x | Yes |
| 1.x | No (see [CHANGELOG](../CHANGELOG.md) for migration to 2.x) |

## Data destinations

PR diffs and metadata leave the runner only via two destinations: **GitHub** (PR context, posting the review, artifact storage) and **OpenAI** (via the SHA-pinned [`openai/codex-action`](https://github.com/openai/codex-action) invoked from `review/action.yaml`). This repository operates no maintainer-owned backend, proxy, analytics service, or telemetry pipeline that receives diffs. See the [Trust model](../README.md#trust-model) section in the README for the full statement.

## Reviewing security-relevant changes

Maintainers gate two complementary classes of change behind explicit security review and dedicated CHANGELOG callouts so adopters who have already hardened their workflow can re-audit before pulling a new SHA.

**Trust-boundary changes** — *what* data crosses what boundary:

- outbound HTTP destinations (any new host or external API call);
- data sent to OpenAI via the prompt (new fields, larger excerpts, new metadata);
- analytics, logging, or telemetry that leaves the GitHub Actions runner;
- `permissions:` required by the action (new scope, new token usage);
- artifact contents that change what callers must trust;
- default exit-code contract (a scenario the action previously exited 0 on now exits non-zero, or vice versa);
- transitive dependency SHA flips that touch any of the above (notably `openai/codex-action`).

**Containment-mechanism changes** — *how* those boundaries stay enforced:

- event trigger surface, especially adding or expanding `pull_request_target`, `workflow_run`, or `issue_comment` (the existing `pull_request` trigger is the safe baseline);
- secret scoping, passing, naming, or job-level exposure;
- model-execution sandboxing, including any `openai/codex-action` input that controls network access, filesystem access, or process execution under the model;
- `review-reference-file` and `review-reference-source` validation, resolution, or sourcing;
- workflow job-boundary moves between `prepare`, `review`, and `publish` that cross a permission or secret scope.

PRs in either class carry the matching label (`trust-boundary`, `security-review-required`, or both), get a dedicated CHANGELOG callout at release time, and require maintainer security-review sign-off recorded against the release gate. The full criteria, label rules, Dependabot enforcement, and CHANGELOG callout shapes live in [`CONTRIBUTING.md` → Security-review-required changes](../CONTRIBUTING.md#security-review-required-changes); this section is the auditor-facing summary.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public issue.
2. Use [GitHub's private vulnerability reporting](https://github.com/milanhorvatovic/codex-ai-code-review-action/security/advisories/new) to submit your report.
3. Include steps to reproduce, impact assessment, and suggested fix if possible.

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Considerations

This action processes untrusted input (PR diffs and metadata). It mitigates prompt injection via backtick neutralization, dynamic fencing, and untrusted-data labeling.

For consumers wiring this action into a workflow, the auditable checklist of required workflow-file controls — SHA pinning, `pull_request` trigger, same-repo gating, OpenAI key scoping, per-job permissions, retention defaults, fail-on-missing-chunks, and the `review-reference-file` rule — lives in [`docs/consumer-controls.md`](../docs/consumer-controls.md). Use that page for adoption-readiness audits; this file remains the home for the action's own runtime defenses.

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

### Dogfood (self-review) workflow

This repository runs the action against its own pull requests via [`.github/workflows/codex-review.yaml`](workflows/codex-review.yaml). The dogfood mirrors the [Production workflow example](../README.md#production-workflow-example) so the documented hardened pattern is exercised end to end on a real PR-shaped event before adopters copy it. Operationally:

- `OPENAI_API_KEY` is bound to the `codex-review` GitHub Environment as an environment secret, scoped to the `review` job only. No repo-scoped copy of the key is configured.
- Every job carries `github.event.pull_request.head.repo.full_name == github.repository`, so fork PRs are skipped before any secret-touching step.
- The `prepare` step's `allow-users` is bound to the maintainer to bound OpenAI cost while the dogfood is being proven out; this is revisited after one release cycle.
- The three self-action references (`prepare`, `review`, `publish`) are SHA-pinned and refreshed by [`scripts/refresh-self-pins.ts`](../scripts/refresh-self-pins.ts) after each release tag, keeping the dogfood and the README example aligned.

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

### Tag-creation gating

`release-on-merge.yaml` is split into a `validate` job and a `tag` job. `validate` runs without the App token (only `contents: read` on `pull_request.merge_commit_sha`) and executes `verify-dist`, `npm run lint`, `npm run typecheck`, `npm test`, the `verify-lockfile-version` composite, and the branch-ref / `package.json` / `CHANGELOG.md` consistency checks. `tag` declares `needs: validate`, mints the App token, and pushes `vX.Y.Z`; a defensive `git ls-remote --exit-code --tags origin "refs/tags/v${VERSION}"` check at the top of the tag-push step short-circuits with `exit 0` when the tag already exists, so re-runs do not flap. Both jobs carry the same merged-PR / release-branch guard for defense in depth, and the workflow-level `release-tag` concurrency group continues to serialize the validate→tag sequence and queue concurrent release PRs.

Keeping `validate` token-free means a future change to validation that processes PR-derived content cannot leak App credentials. `release.yaml` is unchanged and continues to run the same validation a second time on tag push as a redundant post-tag defense before the GitHub Release is published.
