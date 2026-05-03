# Review reference

Detailed guidance for the Codex code review prompt. Read this file when reviewing a pull request and apply the relevant sections based on the file types in the diff.

## Focus areas

Evaluate the pull request diff for:

1. **Correctness** — behavioral bugs, regressions, logic errors
2. **Security** — injection, secret exposure, unsafe input handling
3. **Performance** — unnecessary allocations, O(n^2) where O(n) suffices
4. **Maintainability** — readability, naming, duplication, unnecessary complexity
5. **Test coverage** — risky changes without corresponding tests

## Code analysis depth

Go beyond surface-level pattern matching. For each changed function or block:

1. **Trace data flow** — follow values from input (environment variables, function parameters, parsed JSON fields) through parsing, transformation, and use. Check what happens when parsing produces `NaN`, `undefined`, `null`, or unexpected types.
2. **Check execution order** — verify that validation happens before the validated value is used. Look for cases where data is sorted, compared, or passed to other functions before being checked for validity.
3. **Verify edge cases** — consider empty arrays, zero-length strings, negative numbers, boundary values, and missing optional fields. Check whether defensive code covers all the paths it claims to.
4. **Connect schema to runtime** — when a schema, comment, or type annotation says a value has a specific range or format, check whether the runtime code actually enforces that constraint. Flag gaps between documented contracts and actual behavior.
5. **Check error propagation** — when a function can fail, verify that callers handle the failure. Look for swallowed errors, missing return checks, and catch blocks that hide problems.

## Confidence scoring

Assign a `confidence_score` (0.0 to 1.0) to each finding reflecting how certain you are that it is a real, actionable issue:

- **0.9-1.0** — certain: the code is demonstrably wrong or violates a documented rule
- **0.7-0.9** — high: very likely an issue based on context, but depends on intent
- **0.5-0.7** — moderate: plausible issue, but could be intentional or context-dependent
- **0.3-0.5** — low: possible concern, may be a false positive
- **Below 0.3** — speculative: flag only if the potential impact is severe

Do not default all scores to the same value. Differentiate based on the evidence available in the diff and referenced files.

## File-type review guidance

Apply the appropriate checklist for each file type changed in the diff.

### Python (`**/*.py`)

- Verify function signatures have type hints where appropriate
- Check that file I/O calls include explicit encoding (e.g. `encoding="utf-8"`)
- Look for bare `except:` clauses that swallow all exceptions
- Verify `os.path` or `pathlib` is used for path manipulation, not string concatenation
- Check that mutable default arguments are not used (e.g. `def f(x=[])`)
- Verify context managers (`with`) are used for resource management

### JavaScript / TypeScript (`**/*.js`, `**/*.ts`, `**/*.tsx`)

- Trace all `Number()`, `parseInt()`, `parseFloat()` calls — check what happens when the input is `undefined`, `null`, or a non-numeric string (`NaN` propagation)
- Verify that environment variables read via `process.env` are validated before use
- Check that array operations handle empty arrays gracefully
- Look for implicit type coercions that could cause silent failures
- Check for missing `await` on async function calls
- Verify error handling in Promise chains and async/await blocks

### Shell scripts (`**/*.sh`)

- Verify `set -euo pipefail` is at the top of every script
- Check that required environment variables are validated with `${VAR:?}` before use
- Look for unquoted variable expansions that could cause word splitting or globbing
- Verify error paths exit cleanly and write structured output to `$GITHUB_OUTPUT` when applicable
- Check for command injection risks in any variable interpolation

### Go (`**/*.go`)

- Check that all errors are handled (not assigned to `_`)
- Verify goroutines have proper synchronization and cleanup
- Look for defer statements in loops (resource leak risk)
- Check that interfaces are satisfied at compile time where appropriate
- Verify context propagation through function call chains

### Rust (`**/*.rs`)

- Check for proper error handling with `Result` and `Option` types
- Look for unnecessary `unwrap()` or `expect()` calls in non-test code
- Verify lifetime annotations are correct and minimal
- Check for potential panics in production code paths

### Java / Kotlin (`**/*.java`, `**/*.kt`)

- Check for null safety issues (NullPointerException risks)
- Verify resource management (try-with-resources, AutoCloseable)
- Look for thread safety issues in shared state
- Check exception handling — avoid catching overly broad exceptions

### YAML / Configuration (`**/*.yaml`, `**/*.yml`, `**/*.toml`, `**/*.json`)

- Verify all actions/dependencies are pinned to specific versions or commit SHAs
- Check that job permissions follow least-privilege principles
- Verify environment variables are passed correctly between steps and jobs
- Check for secrets or tokens that could be exposed in logs

### Markdown (`**/*.md`)

- Check that file cross-references point to files that exist in the repository
- Verify consistent terminology — one term per concept, no synonym mixing
- Check for broken links and image references

### Dockerfile / Container (`Dockerfile*`, `**/*.dockerfile`)

- Check for use of specific image tags instead of `latest`
- Verify multi-stage builds minimize final image size
- Look for secrets or credentials in build arguments or environment variables
- Check that `COPY` instructions don't include unnecessary files

## Few-shot examples

These examples show the expected quality bar for findings. Each demonstrates the reasoning -> priority -> confidence -> body -> suggestion structure.

### Example 1: P1 — NaN propagation through data flow (JavaScript)

```json
{
  "title": "MIN_CONFIDENCE NaN silently disables filtering",
  "priority": 1,
  "confidence_score": 0.92,
  "path": ".github/scripts/publish-review.js",
  "line": 103,
  "start_line": null,
  "reasoning": "Number(process.env.MIN_CONFIDENCE || '0') is used to parse the confidence threshold. If MIN_CONFIDENCE is set to a non-numeric string like 'high', Number('high') returns NaN. The comparison finding.confidenceScore < NaN is always false, which means no findings are ever filtered — the opposite of the intended behavior. The || '0' fallback only covers undefined/empty, not invalid strings.",
  "body": "`MIN_CONFIDENCE` is parsed with `Number()` but not validated. A non-numeric value produces `NaN`, and `x < NaN` is always `false`, silently disabling confidence filtering. Validate with `Number.isFinite()` and clamp to 0-1.",
  "suggestion": "  const rawMinConfidence = Number(process.env.MIN_CONFIDENCE);\n  const minConfidence = Number.isFinite(rawMinConfidence)\n    ? Math.min(1, Math.max(0, rawMinConfidence))\n    : 0;"
}
```

**Why this is a good finding:** It traces data from input (`process.env`) through parsing (`Number()`) to use (comparison), identifies the specific failure mode (`NaN`), explains the concrete impact (filtering disabled), and provides a working fix.

### Example 2: P1 — Untrusted input breaks prompt structure (Shell)

```json
{
  "title": "PR body can break diff fence via triple backticks",
  "priority": 1,
  "confidence_score": 0.88,
  "path": ".github/scripts/build-codex-prompt.sh",
  "line": 48,
  "start_line": null,
  "reasoning": "PR_BODY is embedded verbatim into the prompt between the metadata section and the diff fence. A PR description containing triple backticks would close the diff fence prematurely, corrupting the prompt structure. Since PR descriptions are untrusted input from any PR author, this is a realistic attack surface.",
  "body": "PR metadata is embedded verbatim. A PR description containing triple backticks can break the diff code fence and corrupt the prompt structure. Sanitize by escaping triple backticks and truncating to a bounded length.",
  "suggestion": null
}
```

**Why this is a good finding:** It identifies a trust boundary (untrusted PR body -> prompt structure), explains the mechanism (backticks closing the fence), and notes the realistic attack surface.

### Example 3: P2 — Prompt/schema contract mismatch (Markdown)

```json
{
  "title": "start_line described as optional but required in schema",
  "priority": 2,
  "confidence_score": 0.77,
  "path": ".github/codex/review-prompt.md",
  "line": 53,
  "start_line": null,
  "reasoning": "The prompt says 'start_line is optional' but the JSON schema lists start_line in the required array with type ['integer', 'null']. If the model follows the prompt literally and omits start_line, schema validation rejects the output. This creates intermittent review publishing failures depending on which instruction the model prioritizes.",
  "body": "The prompt says `start_line` is optional, but the schema requires it (as nullable). This contract mismatch can cause schema validation to reject findings. Update the prompt to say `start_line` is required and should be set to `null` when not applicable.",
  "suggestion": null
}
```

**Why this is a good finding:** It connects two files (prompt and schema), identifies the specific contradiction, and explains the concrete failure mode (review output rejected).

## Recurring finding patterns

These patterns have been repeatedly flagged. When reviewing a diff that touches related code, check whether the fix is already applied or the pattern has regressed.

### NaN propagation from Number()

`Number()` on `undefined`, `null`, or non-numeric strings returns `NaN`. Comparisons against `NaN` are always `false`, silently disabling guards. Verify every `Number()` call is followed by a `Number.isFinite()` or `Number.isInteger()` check before use in comparisons or arithmetic.

### Environment variable validation

Shell scripts must validate required variables with `${VAR:?}` at the top. JavaScript must check `process.env` values before parsing — an unset variable is `undefined`, and `Number(undefined)` is `NaN`. Validate both presence and type.

### Sort comparator correctness

Array `.sort()` with a numeric comparator breaks when values include `NaN` — the comparison `a - NaN` returns `NaN`, which violates the comparator contract and produces unstable ordering. Filter or validate before sorting.

### Buffer and truncation arithmetic

When truncating strings to fit size limits, subtract the suffix/wrapper length before slicing. A common mistake: `text.slice(0, limit)` followed by appending a suffix that pushes the total over the limit.

### Exit code semantics

Scripts that validate inputs and exit must use fail-closed semantics: exit 1 on failure, exit 0 only on success. A try/catch that swallows an error and exits 0 is fail-open.

### Code fence injection

Untrusted content embedded in code-fenced prompt sections can break the fence if it contains backtick sequences. Use dynamic fence computation that picks a delimiter longer than any backtick run in the content, and sanitize untrusted text by neutralizing triple-backtick sequences.

## Known limitations — do not flag these

- **Schema does not use `minimum`/`maximum` for numeric ranges.** OpenAI's structured output API rejects schemas containing these keywords. Range enforcement is handled at runtime via `isValidFinding()`.
- **PR metadata is embedded in the prompt as a fenced text block.** This is the standard approach. The metadata is structurally isolated and labeled as untrusted data.
