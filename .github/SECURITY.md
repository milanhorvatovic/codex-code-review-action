# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public issue.
2. Use [GitHub's private vulnerability reporting](https://github.com/milanhorvatovic/codex-code-review-action/security/advisories/new) to submit your report.
3. Include steps to reproduce, impact assessment, and suggested fix if possible.

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Considerations

This action processes untrusted input (PR diffs and metadata). It mitigates prompt injection via backtick neutralisation, dynamic fencing, and untrusted-data labelling. The two-action architecture isolates read-only review from write-access publishing.

If you believe any of these defences can be bypassed, please report it using the process above.
