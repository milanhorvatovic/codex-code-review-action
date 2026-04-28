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
- Markdown: No artificial line wrapping at a fixed column. Let each paragraph flow naturally.
- Merge strategy: Squash-merge via `gh pr merge --squash` (matching the Dependabot auto-merge workflow at `.github/workflows/dependabot-auto-merge.yaml`).

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
   - **3b. Sync cross-doc SHA and version references.** When the canonical pin in `action.yaml`, `prepare/action.yaml`, `publish/action.yaml`, or `review/action.yaml` changes — or when any release bumps a third-party Action — update every other reference to that pin in the same release: `README.md` (including the "Adopting in enterprise environments" section), examples, and any other docs. The unified-pins rule (one SHA + tag per third-party Action across the entire repo) is enforced at release time. Verify with a quick repo-wide grep for the previous SHA before tagging. Automating this sweep with a CI check is tracked in [#68](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/68); until that lands, the sweep is manual.
4. Commit and merge to `main`
5. Tag and push the release: `git tag vx.y.z && git push origin vx.y.z`
6. The release workflow automatically creates a GitHub Release, generates release notes, and updates the major version tag (e.g. `v1`)

> **Tip:** You can also create the tag and release in one step using the GitHub CLI:
>
> ```bash
> gh release create vx.y.z --generate-notes
> ```
>
> The release workflow will still run on the tag push to verify the build, run tests, and update the major version tag.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
