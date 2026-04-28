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

## Release process

1. Update `version` in `package.json`
2. Update `CHANGELOG.md` with the release date and any new entries
3. Rebuild dist: `npm run build`
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
