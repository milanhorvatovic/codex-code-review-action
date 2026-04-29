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

### Conventions

- Commits: `Co-authored-by` trailers are not added. Commit message bodies are not wrapped at a fixed column.
- Branches: Use feature branches off `main` and a PR per change. `main` is protected; do not push directly. Branch names are topic-only with a type prefix (e.g. `docs/<topic>`, `feat/<topic>`, `fix/<topic>`); reference issues in the PR title or body, not the branch name.
- File extensions: YAML files in this repo use `.yaml`, not `.yml`. Match this convention when adding new YAML.
- JSON key ordering: Keep keys alphabetically sorted unless an existing file establishes a different order.
- Merge strategy: Squash-merge via `gh pr merge --squash` (matching the Dependabot auto-merge workflow at `.github/workflows/dependabot-auto-merge.yaml`).
- Documentation prose: Follows the [Documentation tone and style](#documentation-tone-and-style) section below.

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

## Release process

1. Update `version` in `package.json`
2. Update `CHANGELOG.md` with the release date and any new entries
   - **2b. Trust-boundary callout.** If the release contains any PRs labeled `trust-boundary`, add a dedicated subsection to the CHANGELOG entry:

     ```markdown
     ### ⚠️ Trust boundary change

     - <what changed> — <why> — <what callers should re-review>
     ```

     Applies to releases cut after this section lands; historical entries are not rewritten.
3. Rebuild dist: `npm run build`
   - **3b. Sync cross-doc SHA and version references.** When the canonical pin in `action.yaml`, `prepare/action.yaml`, `publish/action.yaml`, or `review/action.yaml` changes — or when any release bumps a third-party Action — update every other reference to that pin in the same release: `README.md` (including the "Adopting in enterprise environments" section), examples, and any other docs. The unified-pins rule (one SHA + tag per third-party Action across the entire repo) is enforced by CI on every PR and push to `main` by `.github/workflows/verify-action-pins.yaml`. The `ratchet-lint` job rejects any `uses:` that is not pinned to a full commit SHA, and the `verify-doc-pins` job (running `npm run verify:doc-pins`) fails when any tracked Markdown file references a third-party Action with a SHA or tag that drifts from the canonical pin in YAML. If either job fails, fix the listed files; do not bypass the check. The release-time sweep is now "verify CI passes" rather than a manual grep.
4. Commit and merge to `main`
5. Tag and push the release: `git tag vx.y.z && git push origin vx.y.z`
6. The release workflow automatically creates a GitHub Release whose notes are extracted verbatim from the matching `## [<version>]` section in `CHANGELOG.md` (including pre-release versions like `2.1.0-rc.1`), and updates the major version tag (e.g. `v1`)

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
