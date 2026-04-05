# codex-review-action
AI-powered code review GitHub Action using OpenAI Codex. Two-job design with security isolation: read-only review job (diff chunking, prompt assembly, structured findings) and    write-access publish job (inline PR comments, per-file summaries, verdict). Fully configurable prompts, models, confidence thresholds, and user allowlists.
