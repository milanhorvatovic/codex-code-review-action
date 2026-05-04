# Contributing

Thank you for considering contributing to Codex AI Code Review Action!

## Prerequisites

- Node.js 24 (see `mise.toml` for the exact version)
- npm

## Getting started

```bash
git clone https://github.com/milanhorvatovic/codex-ai-code-review-action.git
cd codex-ai-code-review-action
npm install
```

## Development commands

| Command | Description |
|---------|-------------|
| `npm run build` | Bundle all JavaScript actions into `dist/` with esbuild |
| `npm run lint` | Lint source code with ESLint |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run tests once (CI mode) |
| `npm run test:watch` | Run tests in watch mode |
| `npm test -- --coverage` | Run tests with coverage report |
| `npm run extract:changelog -- <version>` | Print the matching `## [<version>]` section from `CHANGELOG.md` (used by the release workflow to populate Release notes) |
| `npm run verify:doc-pins` | Verify Markdown references match the canonical third-party Action pins in YAML (also runs in CI) |
| `npm run verify:prose-style` | Verify all prose uses US English (also runs in CI) |

## Committing dist/

The `dist/` directory is committed to the repository so that GitHub Actions can run the bundled JavaScript directly. Always rebuild before committing:

```bash
npm run build
```

CI verifies that `dist/` is up-to-date — your PR will fail if the bundles are stale.

## Test coverage

Coverage thresholds are enforced in `vitest.config.ts`:

| Metric | Threshold |
|--------|-----------|
| Lines | 80% |
| Statements | 80% |
| Functions | 80% |
| Branches | 75% |

New code should include tests. Aim to maintain or improve coverage.

## Pull request guidelines

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure all checks pass: `npm run lint && npm run typecheck && npm test`
4. Rebuild dist: `npm run build`
5. Open a PR targeting `main`

This repository dogfoods the action on its own pull requests via [`.github/workflows/codex-review.yaml`](.github/workflows/codex-review.yaml). Same-repo PRs from accounts on the workflow's `allow-users` allowlist receive an automated Codex review posted by the `publish` job; PRs from other authors and from forks are skipped before the workflow consumes any OpenAI credit. The review is advisory and does not block merging — human review remains authoritative.

### Conventions

- Commits: `Co-authored-by` trailers are not added. Commit message bodies are not wrapped at a fixed column.
- Branches: Use feature branches off `main` and a PR per change. `main` is protected; do not push directly. Branch names are topic-only with a type prefix (e.g. `docs/<topic>`, `feat/<topic>`, `fix/<topic>`); reference issues in the PR title or body, not the branch name.
- File extensions: YAML files in this repo use `.yaml`, not `.yml`. Match this convention when adding new YAML.
- JSON key ordering: Keep keys alphabetically sorted unless an existing file establishes a different order.
- Merge strategy: Squash-merge via `gh pr merge --squash` (matching the Dependabot auto-merge workflow at `.github/workflows/dependabot-auto-merge.yaml`).
- Documentation prose: Follows the [Documentation tone and style](#documentation-tone-and-style) section below.
- PR titles: informally follow Conventional Commits (`type(scope): subject`). The title is for human readability; release intent is set by the `release: *` label, not parsed from the title.

### Release label

Every PR carries exactly one of:

- `release: major` — major version bump (breaking change)
- `release: minor` — minor version bump (new feature)
- `release: patch` — patch version bump (fix or documentation only)
- `release: skip`  — excluded from the next release (chore, infra, internal-only, release-prep)

The required check `verify-pr-release-label` enforces this on every PR. Reviewers apply or correct the label as part of approval. Dependabot PRs auto-carry `release: patch`; trust-boundary Dependabot bumps additionally receive `trust-boundary` from maintainers during review (both labels coexist).

Release-preparation PRs themselves carry `release: skip` — the release IS the bump, so the PR is not contributing a level.

### Squash-body policy

When merging via squash, replace the auto-generated commit-list body with a hand-written summary paragraph. The PR title, labels, and CHANGELOG entry are the durable record; the squash body is for `git log -p` readers. Release tooling reads PR metadata (title, labels), not commit messages — do not encode release semantics in the squash body.

## Documentation tone and style

Applies to every prose-bearing file in the repository. The verifier scans the file types curated in `FILE_PATTERNS` and `EXTRA_FILES` at the top of [`scripts/verify-prose-style.ts`](scripts/verify-prose-style.ts) — currently Markdown, YAML, TypeScript, JSON, `.mjs`, `.sh`, `.toml`, `.gitignore`, and `.github/CODEOWNERS`. Bundled artifacts under `dist/` and the verbatim `LICENSE` text are deliberately not scanned. The verifier inspects prose, code comments, string literals, and identifiers alike: each line is split on every character outside `[A-Za-z]` (punctuation, digits, whitespace, accented or other non-ASCII letters) into raw ASCII-letter tokens, and each raw token is then split on camelCase, PascalCase, and adjacent-uppercase boundaries before matching. ASCII-only tokenization is sufficient because the UK English patterns themselves contain only ASCII characters. UK forms anywhere inside compound identifiers — camelCase, PascalCase, all-caps constants joined by underscores, or upper-prefix-then-camel patterns — are caught the same as UK forms in prose. Concrete examples live in [`scripts/verify-prose-style.test.ts`](scripts/verify-prose-style.test.ts). In practice this codebase already uses US conventions for identifiers, so the rule and the verifier agree. To extend coverage to a new file type, add a glob to `FILE_PATTERNS` (or an explicit path to `EXTRA_FILES`).

- **Language.** Use US English spellings (e.g. `organization`, `behavior`, `prioritize`, `canceling`, `defense`, `neutralization`, `labeling`, `analyze`). Verbatim quotes of external UI labels, third-party documentation, or external proper nouns may keep their original spelling; when the exception isn't obvious from context, note it inline.
- **Tone.** Write neutrally and precisely. Describe behavior in terms of inputs, outputs, trust boundaries, and concrete examples — not customer or vendor names, internal personas, or marketing language. Avoid company-specific references unless the context (a quoted GitHub setting, an upstream Action repository, etc.) requires the exact name.
- **Voice.** Prefer direct, present-tense statements about what the action does. Avoid hedging ("may", "could potentially") when the behavior is deterministic, and avoid imperative tone toward maintainers ("you must") when describing invariants the code already enforces.
- **Formatting.** No artificial line wrapping at a fixed column; let each paragraph flow naturally. Match the repository's existing heading depth and bullet style. The same rule applies to commit message bodies.
- **No historical exceptions.** The conventions apply to all prose in the repository at all times, including `CHANGELOG.md` entries for already-released versions. When drift is discovered in a historical entry, fix it in place — release notes are technical documentation, not an immutable transcript.

To audit the repository for drift, run:

```bash
npm run verify:prose-style
```

This invokes `scripts/verify-prose-style.ts`, which scans every text-bearing tracked file, reports any UK English form with `file:line:column` precision, and exits non-zero on drift. The same script runs in CI on every pull request and push to `main` via [`.github/workflows/verify-prose-style.yaml`](.github/workflows/verify-prose-style.yaml). Each `UK_PATTERNS` entry is an anchored regex matching a complete UK word (e.g. `organis(?:e|es|ed|ing|ation|ations|ational|er|ers|able)`), so US English nouns that share a UK verb stem — `criticism`, `optimism`, `terrorism`, `organism`, `programmer`, `programmed`, `emphasis`, and so on — are not flagged. When a new UK form needs coverage, add an anchored pattern to `UK_PATTERNS` and a test case in `scripts/verify-prose-style.test.ts`. The `ALLOWED_WORDS` set is reserved for proper nouns whose canonical spelling collides with a UK English word (brand, party, or place names); add lowercased entries when one appears in repository prose.

## Workflow linting

The files under `.github/workflows/` are linted with [`actionlint`](https://github.com/rhysd/actionlint) (with `shellcheck` integration on `run:` blocks) on every pull request and push to `main` via [`.github/workflows/actionlint.yaml`](.github/workflows/actionlint.yaml). The workflow runs the SHA-pinned `rhysd/actionlint` Docker image, which bundles `shellcheck` and `pyflakes`. actionlint covers workflow YAML structure, expression syntax, context references, runner/`uses:` references, matrix shapes, and embedded shell scripts. Composite action files (the top-level `action.yaml`, `prepare/action.yaml`, `publish/action.yaml`, `review/action.yaml`, and `.github/actions/*/action.yaml`) are out of scope because actionlint targets workflow files, not composite action metadata; SHA-pinning across all of them is enforced by [`.github/workflows/verify-action-pins.yaml`](.github/workflows/verify-action-pins.yaml).

To run the same lint locally, pick whichever path fits your platform:

- **mise (recommended; matches the CI versions and works on macOS, Linux, and Windows via WSL).** `mise.toml` already pins `actionlint` and `shellcheck` alongside Node, so `mise install` provisions both. After that, `actionlint` runs from `$PATH`.
- **Docker (no host install; identical to CI).** Use the same digest pinned in [`.github/workflows/actionlint.yaml`](.github/workflows/actionlint.yaml) so the image is byte-identical to the one CI uses, not a tag that can be retargeted upstream:

  ```bash
  docker run --rm -v "$PWD:/repo" --workdir /repo \
    rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 \
    -color
  ```

- **Native package managers.** macOS: `brew install actionlint shellcheck`. Linux: install `shellcheck` from your distro and `actionlint` from the [upstream releases](https://github.com/rhysd/actionlint/releases). Windows: `scoop install actionlint shellcheck`.

## Trust-boundary changes

Changes that affect data destinations, forwarding, telemetry, auth scopes, or what callers must trust require explicit release-note treatment so adopters who have already hardened their workflow can re-review.

A change is trust-boundary-affecting if it:

- adds or changes an outbound HTTP destination (any `fetch`, `axios`, Octokit client targeting a new host, or subprocess that calls an external API);
- changes what data is sent to OpenAI (e.g. new fields in the prompt, larger diff excerpts, new metadata);
- adds any analytics, logging, or telemetry that leaves the GitHub Actions runner;
- changes the permissions required by the action (new `permissions:` scope, new token usage);
- alters the artifact contents in a way that changes what callers must trust;
- updates a transitive dependency that itself changes any of the above (e.g. updating the `openai/codex-action` SHA pin in `review/action.yaml`).

When in doubt, treat the change as trust-boundary-affecting.

PRs with such changes must:

- be labeled `trust-boundary`;
- include a "Trust boundary impact" paragraph in the PR description (see [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md));
- get a dedicated CHANGELOG callout at release time (see [Release process](#release-process) step 2b).

This applies to every PR regardless of author — maintainer, outside contributor, or AI-assisted — including Dependabot PRs that bump a transitive SHA falling under the criteria above. Maintainers apply the label on Dependabot's behalf during review.

### Dependabot enforcement

The auto-merge workflow at [`.github/workflows/dependabot-auto-merge.yaml`](.github/workflows/dependabot-auto-merge.yaml) carries three layers of enforcement:

- **Exclude-by-name guard** in the auto-merge step's `if:` expression: `!contains(steps.metadata.outputs.dependency-names, 'openai/codex-action')` — auto-merge is never enabled for any (possibly grouped) Dependabot PR that includes `openai/codex-action`. Extend this clause when a new trust-boundary dependency is added to the repo.
- **Label guard** — fast-path `if:` clause `!contains(github.event.pull_request.labels.*.name, 'trust-boundary')` plus runtime re-checks inside the auto-merge step. The `if:` evaluates against the event payload captured at workflow start, which can be stale by the time the step runs; the runtime pre-check (`gh pr view --json labels`) bails out if the label is now present, and a runtime post-check after `gh pr merge --auto` reverts the enable if the label was applied during the brief enable window. Both checks together close the TOCTOU race that the `if:` alone cannot.
- **Reactive disable job** triggered on the `labeled` pull_request event: if a maintainer applies the `trust-boundary` label *after* auto-merge has already been enabled and committed (i.e., outside the runtime post-check window above), the `disable-auto-merge-on-trust-boundary` job runs `gh pr merge --disable-auto` to revoke it.

All three coexist intentionally. The exclude list is the declarative defense (fail-closed for known dependencies); the label guard's runtime checks close the TOCTOU race during the auto-merge step itself; the reactive disable job catches PRs labeled later in the PR's lifecycle. Removing any layer weakens the policy.

#### Auto-approval

The default-branch ruleset on `main` requires one approving code-owner review before merge. `GITHUB_TOKEN` cannot approve PRs and Dependabot cannot approve its own PRs, so without an additional approver auto-merge would never complete. To close that gap, the auto-merge job posts an approving review *before* enabling auto-merge, gated by the same three trust-boundary guards above (semver-major bumps, the `openai/codex-action` exclude, and the `trust-boundary` label).

The approval is posted using a fine-grained PAT belonging to a code-owner, stored as the Dependabot secret **`DEPENDABOT_APPROVE_TOKEN`**. The PAT must be:

- Scoped to this repository.
- Granted `Pull requests: write` permission (sufficient to submit a review).
- Owned by a user listed in [`.github/CODEOWNERS`](.github/CODEOWNERS), so the review counts toward the code-owner requirement.

Configure under **Settings → Secrets and variables → Dependabot → New secret**. Workflows triggered by Dependabot do not have access to Actions secrets, so the value must live under the Dependabot scope.

When the secret is unset, the approval step emits a warning and exits cleanly — auto-merge is still enabled, but the PR waits for a manual approving review.

Auto-approval reviews carry the marker body `Auto-approved by the Dependabot Auto-Merge workflow (...)` so they are easy to identify in the PR review list. If a maintainer later applies the `trust-boundary` label, the reactive disable job revokes auto-merge but does not dismiss the bot review; the ruleset's `dismiss_stale_reviews_on_push: true` will clear it on the next push, and the maintainer can dismiss it manually before re-evaluating.

## Release process

The release gate checklist at [`docs/release-gate.md`](docs/release-gate.md) is the maintainer-side rollup that every `v<X.Y.Z>` tag must satisfy before the tag is pushed. The steps below cite it where it applies.

### Automated release (default)

1. Trigger `prepare-release.yaml` via the GitHub UI (`Actions → Prepare Release → Run workflow`). Optionally pass an explicit `version` (e.g. `2.1.0` or `2.1.0-rc.1`); leave empty to compute from the `release: <level>` labels of merged PRs since the last non-pre-release tag.
2. The workflow opens a PR titled `release: v<X.Y.Z>` against `main` containing the `package.json` bump, the matching `package-lock.json` bump (top-level `version` and `packages[""].version` only — no dependency tree resolution), and the new `CHANGELOG.md` entry, all in the same commit. Review it like any other PR. Re-running the workflow for the same target version updates the existing release branch and PR in place; the bot refuses to force-push if any non-bot commits are present on the release branch. The PR body includes a release-gate sign-off checklist that points back at [`docs/release-gate.md`](docs/release-gate.md); the checklist text is hard-coded in `buildPrBody` (`scripts/prepare-release.ts`), so when the gate's section structure changes update both files in the same PR.
   - **2b. Complete the release gate (pre-merge items).** Walk [`docs/release-gate.md`](docs/release-gate.md) against the merge candidate: run the validation block, the dist-reproducibility check, and the manual security regression checks; resolve every pre-merge gate item to either a `Verified by:` line or a `Waived:` line with a tracked follow-up. Fill the rollup into the release PR description so reviewers see the sign-off before approving the squash-merge. The post-tag gate item (evidence-zip upload) is handled in step 4b after the GitHub Release is created.
3. Squash-merge the release PR. The `release-on-merge.yaml` workflow validates the merge commit (lint, typecheck, tests, `verify-dist`, and consistency between the branch ref, `package.json`, `package-lock.json`, and the top `CHANGELOG.md` section), then tags it with `v<X.Y.Z>` and pushes the tag automatically. If validation fails, no tag is created.
4. The tag push triggers `release.yaml`, which creates the GitHub Release with notes extracted from `CHANGELOG.md`, force-updates the major version tag (skipped for pre-releases), and opens a follow-up PR refreshing SHA-pinned self-references in `README.md` and `.github/workflows/codex-review.yaml` to point at the new tag's SHA (skipped for pre-releases).
   - **4b. Attach the gate evidence zip.** Package the filled gate (`gate.md`), captured validation output (`validation.log`, `dist-diff.txt`, `audit.json`), and any manual-check notes (`manual-checks.md`) into `release-gate-v<X.Y.Z>.zip`, then upload it to the GitHub Release: `gh release upload v<X.Y.Z> release-gate-v<X.Y.Z>.zip --clobber`. The `--clobber` flag overwrites an existing asset of the same name so retries (partial-upload recovery, evidence regeneration) stay idempotent. See [Archiving the gate](docs/release-gate.md#archiving-the-gate).
5. Squash-merge the self-pin refresh PR.

**Pre-releases (RCs).** To evaluate a build before the final cut, run `prepare-release.yaml` with the `version` input set to `2.1.0-rc.N` (or pass `--version 2.1.0-rc.N` to `npm run prepare:release` if using the manual fallback below). Each RC gets its own `## [2.1.0-rc.N]` CHANGELOG section; the final non-RC cut emits a single `## [2.1.0]` section containing the full set of changes since the last non-pre-release tag and removes the orphan RC sections in the same commit. The major tag (`v2`) does not move for RCs, and consumers should not pin to RC tags.

### Manual release (fallback)

Use this path when `prepare-release.yaml` is broken or an urgent hotfix needs cutting from a fresh local clone. Both flows produce identical output (a `v<X.Y.Z>` tag pointing at a commit on `main` with the right `package.json` version + `CHANGELOG.md` entry).

1. Update `version` in `package.json`, then bump `package-lock.json` to the same version at both the top-level `version` and `packages[""].version`. Do not run `npm install --package-lock-only` or `npm version` for this — they re-resolve the dependency tree and would cause silent transitive bumps in a release-prep commit. A `jq`-based or hand edit of just those two lines is correct. The `tests.yaml` workflow rejects any PR where the two files disagree.
2. Update `CHANGELOG.md` with the release date and any new entries.
   - **2b. Trust-boundary callout.** If the release contains any PRs labeled `trust-boundary`, add a dedicated subsection to the CHANGELOG entry:

     ```markdown
     ### ⚠️ Trust boundary change

     - <what changed> — <why> — <what callers should re-review>
     ```

     Applies to releases cut after this section lands; historical entries are not rewritten.
3. Rebuild dist: `npm run build`.
   - **3b. Sync cross-doc SHA and version references.** When the canonical pin in `action.yaml`, `prepare/action.yaml`, `publish/action.yaml`, or `review/action.yaml` changes — or when any release bumps a third-party Action — update every other reference to that pin in the same release: `README.md` (including the "Adopting in enterprise environments" section), examples, and any other docs. The unified-pins rule (one SHA + tag per third-party Action across the entire repo) is enforced by CI on every PR and push to `main` by `.github/workflows/verify-action-pins.yaml`. The `ratchet-lint` job rejects any `uses:` that is not pinned to a full commit SHA, and the `verify-doc-pins` job (running `npm run verify:doc-pins`) fails when any tracked Markdown file references a third-party Action with a SHA or tag that drifts from the canonical pin in YAML. If either job fails, fix the listed files; do not bypass the check. The release-time sweep is now "verify CI passes" rather than a manual grep.
   - **3c. Complete the release gate (pre-merge items).** Before merging the release commit, walk [`docs/release-gate.md`](docs/release-gate.md) against the candidate commit: run the validation block, the dist-reproducibility check, and the manual security regression checks; resolve every pre-merge gate item to either `Verified by:` or `Waived:` with a tracked follow-up. The post-tag gate item (evidence-zip upload) is handled in step 6b after the GitHub Release is created.
4. Commit and merge to `main`.
5. Tag and push the release: `git tag vx.y.z && git push origin vx.y.z`.
6. The release workflow automatically creates a GitHub Release whose notes are extracted verbatim from the matching `## [<version>]` section in `CHANGELOG.md`, updates the major version tag (skipped for pre-releases), and opens a follow-up PR refreshing SHA-pinned self-references in `README.md` and `.github/workflows/codex-review.yaml` to point at the new tag's SHA (skipped for pre-releases). Pre-release tags (e.g. `v2.1.0-rc.1`) are accepted: the extraction script resolves the corresponding `## [2.1.0-rc.1]` CHANGELOG section, and the resulting Release page is marked as a pre-release.
   - **6b. Attach the gate evidence zip.** Package the filled gate plus captured validation output and manual-check notes into `release-gate-v<X.Y.Z>.zip` and upload to the GitHub Release: `gh release upload v<X.Y.Z> release-gate-v<X.Y.Z>.zip --clobber`. The `--clobber` flag overwrites an existing asset of the same name so retries stay idempotent. See [Archiving the gate](docs/release-gate.md#archiving-the-gate).

> **Tip:** Preview the release notes locally before pushing the tag:
>
> ```bash
> npm run extract:changelog -- x.y.z
> ```
>
> The release workflow runs on the tag push and creates the GitHub Release from the same `CHANGELOG.md` section.
>
> If the workflow is unavailable and you need to create the release by hand, extract the notes and pass them explicitly — do **not** use `--generate-notes`, which bypasses the CHANGELOG:
>
> ```bash
> npx tsx scripts/extract-changelog-section.ts x.y.z > /tmp/notes.md
> gh release create vx.y.z --notes-file /tmp/notes.md
> ```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
