# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0-rc.1] - 2026-05-01

### Added

- ci: lint workflows with actionlint ([#86](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/86))
- feat: automate release preparation via PR-driven workflow ([#85](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/85))

### Changed

- Bump vite to 8.0.5 to fix 3 Dependabot security alerts ([#28](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/28))
- chore: unify and bump third-party action pins to latest ([#67](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/67))
- docs: add enterprise fork/internal-mirror adoption path ([#63](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/63))
- docs: add guidance for pinning action refs ([#55](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/55))
- docs: add hardened production workflow example ([#62](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/62))
- docs: add minimal quick start hardening disclaimer ([#53](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/53))
- docs: add public-repo vs private-repo security guidance ([#64](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/64))
- docs: add Responsibility boundary subsection to Security guidance ([#65](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/65))
- docs: add Trust model section and refresh SECURITY.md ([#60](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/60))
- docs: rename Quick start to Minimal quick start; add markdown-link-check config ([#57](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/57))
- docs: standardize on US English and add documentation tone/style guide ([#72](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/72))
- docs: warn against pull_request_target ([#54](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/54))
- Extract verify-dist & setup-node-deps composites; split Verify Dist workflow; restore dist/ ([#58](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/58))
- feat(publish): Incomplete review banner + fail-on-missing-chunks input ([#61](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/61))

### Security

- docs: document release-automation App identity in SECURITY.md ([#84](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/84))

### Dependencies

- chore: bump fast-xml-parser from 5.5.10 to 5.7.2 in the npm_and_yarn group across 1 directory ([#34](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/34))
- chore: bump github/codeql-action from 7fc6561ed893d15cec696e062df840b21db27eb0 to 95e58e9a2cdfd71adc6e0353d5c52f41a045d225 in the github-actions group across 1 directory ([#81](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/81))
- chore: bump the dev-dependencies group across 1 directory with 7 updates ([#33](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/33))
- chore: bump the github-actions group across 1 directory with 4 updates ([#32](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/32))
- chore: bump the production-dependencies group across 1 directory with 2 updates ([#49](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/49))
- chore: bump typescript-eslint from 8.59.0 to 8.59.1 in the dev-dependencies group across 1 directory ([#82](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/82))

### Documentation

- docs: add release-discipline for trust-boundary changes ([#69](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/69))
- docs: document release-automation App identity in SECURITY.md ([#84](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/84))

### Process

- docs: add release-discipline for trust-boundary changes ([#69](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/69))
- docs: document release-automation App identity in SECURITY.md ([#84](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/84))
- feat: automate release preparation via PR-driven workflow ([#85](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/85))

### ⚠️ Trust boundary change

- docs: add release-discipline for trust-boundary changes ([#69](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/69)) — This PR adds trust-boundary policy, a label, Dependabot guards, and CHANGELOG callout discipline. It does **not** change any data destinations, telemetry, permissions, or artifact contents at the code level — the existing trust boundaries are unchanged. The PR is tagged `trust-boundary` because it modifies maintainer-side review obligations around future trust-boundary changes (which is itself a trust-boundary-relevant policy change worth signaling to adopters).
- feat: automate release preparation via PR-driven workflow ([#85](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/85)) — Labeled `trust-boundary`. The new workflows mint and use a GitHub App installation token (`codex-review-action-release-bot[bot]`, already documented in SECURITY.md per #84) to push tags, force-update the floating major tag, push release/refresh branches, and open PRs. This re-uses the existing App identity for new purposes — no new permission scopes, no new outbound destinations beyond `api.github.com`, no change to what the action itself sends. Introduces one new third-party Action: `actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3 # v3.1.1`. Pinned identically across `prepare-release.yaml`, `release-on-merge.yaml`, and `release.yaml`. `verify-action-pins` (ratchet + `verify:doc-pins`) enforces consistency on every PR. What re-reviewers should check: the App-token chain (mint → checkout → `gh` calls) in each workflow; the force-push guards in `prepare-release.ts` (refuses to overwrite non-bot commits on the release branch); the prerelease guards on the major-tag-move and self-pin-refresh-PR steps.

## [2.0.0] - 2026-04-07

### Changed

- **Breaking:** Replaced direct OpenAI API calls with [`openai/codex-action`](https://github.com/openai/codex-action) for reviews
- **Breaking:** Replaced the Node-based `review` sub-action with a split design: new `prepare` builds diffs, splits chunks, and writes prompt files, while `review` remains as a composite wrapper around `openai/codex-action`
- **Breaking:** Architecture changed from 2-job (review → publish) to 3-job (prepare → review matrix → publish) workflow
- **Breaking:** Renamed `allowed-users` input to `allow-users` to align with `openai/codex-action` naming
- Chunk reviews now run in parallel via GitHub Actions matrix strategy (resolves #20)
- Publish action now handles chunk merging, retain-findings artifact upload, and exposes `findings-count` and `verdict` outputs
- Model defaults are handled by the Codex CLI — no more 400 errors when `model` is omitted (fixes #24)
- Added `effort` input to the review action for controlling reasoning effort
- Added `effort` field to the review output schema so the publish action can display the reasoning effort used in the review footer
- Removed `openai` npm dependency

### Removed

- Node-based `review` implementation that called the OpenAI API directly (the `review` sub-action now remains as a composite wrapper around `openai/codex-action`)
- Direct OpenAI SDK integration (`src/openai/client.ts`) and the `openai` npm dependency

## [1.0.4] - 2026-04-06

### Fixed

- Action runtime updated from `node22` to `node24` — `node22` is not supported by GitHub Actions runners
- Node version aligned to 24.14.1 across build target, CI workflows, and local tooling

## [1.0.3] - 2026-04-06

### Changed

- Repository renamed from `codex-code-review-action` to `codex-ai-code-review-action`
- All internal references updated to match the new repository name

## [1.0.2] - 2026-04-06

### Changed

- Root action renamed from "Codex Review" to "Codex AI Code Review" for Marketplace URL

## [1.0.1] - 2026-04-06

### Fixed

- Root action description shortened to meet GitHub Marketplace 125-character limit

## [1.0.0] - 2026-04-06

### Added

- Two-action architecture with security isolation: read-only `review` job and write-access `publish` job
- OpenAI Codex integration with structured JSON output via the Responses API
- Diff chunking at file boundaries with configurable `max-chunk-bytes`
- Multi-chunk review merging with deduplication of findings, files, and changes
- Inline PR comments on changed lines with automatic diff-line mapping
- Configurable confidence threshold (`min-confidence`) and comment cap (`max-comments`)
- User allowlist to restrict which PR authors trigger reviews
- Custom review reference file support for per-repository review rules
- Prompt injection defenses (backtick neutralization, dynamic fencing, untrusted-data labeling)
- Long-lived artifact upload for audit/analytics via `retain-findings`
- Per-file summary and overall correctness verdict in PR review body
- Automatic truncation to GitHub API limits (65K body, 65K inline comment)
- Fallback to body-only review when inline comment posting fails
- CodeQL security scanning workflow
- Dependabot configuration with auto-merge for patch/minor updates
- CI pipeline with linting, type checking, test coverage, and dist verification
- Security policy (`.github/SECURITY.md`)
- Package metadata (`author`, `repository`, `bugs`, `homepage`) in `package.json`
- Root composite `action.yaml` for GitHub Marketplace listing
- Automated release process via tag-triggered workflow
