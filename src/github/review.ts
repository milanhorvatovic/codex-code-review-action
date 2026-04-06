import * as crypto from "node:crypto";

import * as core from "@actions/core";
import * as github from "@actions/github";

import { isReviewOutput } from "../config/types.js";
import type { NormalizedFinding, ReviewOutput } from "../config/types.js";

const GITHUB_MAX_BODY_CHARS = 65_536;
const MAX_INLINE_BODY_CHARS = 65_000;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_CHANGE_ITEMS = 50;
const MAX_FILES_IN_TABLE = 100;
const MAX_REVIEW_BODY_CHARS = 60_000;
const MAX_FALLBACK_CHARS = 12_000;
const REVIEW_MARKER = "<!-- codex-pr-review -->";

interface ReviewComment {
  body: string;
  line: number;
  path: string;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
}

export interface PublishParams {
  diffText: string;
  githubToken: string;
  maxComments: number;
  minConfidence: number;
  model: string;
  reviewEffort: string;
  reviewOutput: ReviewOutput;
  runUrl: string;
}

// ── Diff parsing ────────────────────────────────────────────────────

export function parseAddedLinesByFile(diffText: string): Map<string, Set<number>> {
  const addedByFile = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let newLine: number | null = null;

  for (const rawLine of diffText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (line.startsWith("diff --git ")) {
      currentFile = null;
      newLine = null;
      continue;
    }

    if (line.startsWith("+++ ") && newLine === null) {
      const nextPath = line.slice(4).trim();
      if (nextPath === "/dev/null") {
        currentFile = null;
        continue;
      }
      currentFile = nextPath.startsWith("b/") ? nextPath.slice(2) : nextPath;
      if (!addedByFile.has(currentFile)) {
        addedByFile.set(currentFile, new Set());
      }
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }

    if (!currentFile || newLine === null) {
      continue;
    }

    if (line.startsWith("+")) {
      addedByFile.get(currentFile)?.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      continue;
    }

    if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  return addedByFile;
}

// ── Finding normalization ───────────────────────────────────────────

export function normalizeFinding(finding: unknown): NormalizedFinding | null {
  if (typeof finding !== "object" || finding === null) {
    return null;
  }
  const raw = finding as Record<string, unknown>;

  const title = String(raw.title ?? "").trim();
  const path = normalizePath(raw.path);
  const line = Number(raw.line);
  const priority = Number(raw.priority);
  const confidenceScore = Number(raw.confidence_score);
  const body = String(raw.body ?? "").trim();
  const reasoning = String(raw.reasoning ?? "").trim();

  const rawStartLine = Number(raw.start_line);
  const startLine =
    Number.isInteger(rawStartLine) && rawStartLine > 0 ? rawStartLine : null;

  const rawSuggestion = raw.suggestion != null ? String(raw.suggestion) : "";
  const suggestion = rawSuggestion.length > 0 ? rawSuggestion : null;

  const validRange = startLine === null || startLine <= line;
  const isValid =
    title !== "" &&
    path !== "" &&
    Number.isInteger(line) &&
    line > 0 &&
    body !== "" &&
    Number.isInteger(priority) &&
    priority >= 0 &&
    priority <= 3 &&
    Number.isFinite(confidenceScore) &&
    confidenceScore >= 0 &&
    confidenceScore <= 1 &&
    validRange;

  if (!isValid) {
    return null;
  }

  return {
    body,
    confidenceScore,
    line,
    path,
    priority,
    reasoning,
    startLine,
    suggestion,
    title,
  };
}

function normalizePath(pathValue: unknown): string {
  return String(pathValue ?? "")
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^\.\/+/, "")
    .replace(/^(?:a|b)\//, "");
}

// ── Comment building ────────────────────────────────────────────────

export function buildInlineComment(
  finding: NormalizedFinding,
  signature: string,
): ReviewComment {
  const alertType: Record<number, string> = {
    0: "CAUTION",
    1: "WARNING",
    2: "NOTE",
    3: "NOTE",
  };
  const alert = alertType[finding.priority] ?? "NOTE";

  let suggestionBlock = "";
  if (finding.suggestion) {
    if (/`{3,}/.test(finding.suggestion)) {
      const fence = buildSafeFence(finding.suggestion);
      suggestionBlock = `\n\n${fence}suggestion\n${finding.suggestion}\n${fence}`;
    } else {
      suggestionBlock = `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
    }
  }

  const reasoningBlock =
    finding.reasoning && finding.priority > 0
      ? `\n\n<details>\n<summary>Reasoning</summary>\n\n${finding.reasoning}\n\n</details>`
      : "";

  let commentBody = `> [!${alert}]\n> **${finding.title}**\n\n${finding.body}${reasoningBlock}${suggestionBlock}\n\n<!-- codex-inline:${signature} -->`;

  if (commentBody.length > MAX_INLINE_BODY_CHARS) {
    commentBody = `> [!${alert}]\n> **${finding.title}**\n\n${finding.body}\n\n...(reasoning/suggestion truncated to fit GitHub limits)\n\n<!-- codex-inline:${signature} -->`;
    if (commentBody.length > MAX_INLINE_BODY_CHARS) {
      const truncSuffix = `\n\n...(truncated)\n\n<!-- codex-inline:${signature} -->`;
      commentBody =
        commentBody.slice(0, Math.max(0, MAX_INLINE_BODY_CHARS - truncSuffix.length)) +
        truncSuffix;
    }
  }

  const comment: ReviewComment = {
    body: commentBody,
    line: finding.line,
    path: finding.path,
    side: "RIGHT",
  };

  if (
    finding.startLine !== null &&
    finding.startLine > 0 &&
    finding.startLine < finding.line
  ) {
    comment.start_line = finding.startLine;
    comment.start_side = "RIGHT";
  }

  return comment;
}

export function computeSignature(finding: NormalizedFinding): string {
  return crypto
    .createHash("sha256")
    .update(`${finding.path}|${finding.line}|${finding.title}|${finding.priority}`)
    .digest("hex")
    .slice(0, 16);
}

// ── Review body building ────────────────────────────────────────────

interface ReviewBodyParams {
  changes: string[];
  commentCount: number;
  files: ReviewOutput["files"];
  isFirstReview: boolean;
  model: string;
  overallConfidenceScore: number;
  overallCorrectness: string;
  reviewEffort: string;
  runUrl: string;
  skippedIncomplete: number;
  skippedInvalidLocation: number;
  skippedLowConfidence: number;
  summaryText: string;
  totalChangedFiles: number;
}

export function buildReviewBody(params: ReviewBodyParams): string {
  const body = params.isFirstReview
    ? buildFirstReviewBody(params)
    : buildSubsequentReviewBody(params);

  const metadata = buildMetadataSection(params);
  const footer = buildFooter(params.model, params.reviewEffort, params.runUrl);
  const full = `${REVIEW_MARKER}\n\n${body}${metadata}${footer}`;

  return capReviewBody(full);
}

function buildFirstReviewBody(params: ReviewBodyParams): string {
  const sections = ["## Pull request overview"];

  if (params.summaryText) {
    const summary =
      params.summaryText.length > MAX_SUMMARY_CHARS
        ? `${params.summaryText.slice(0, MAX_SUMMARY_CHARS)}\n\n...(summary truncated)`
        : params.summaryText;
    sections.push(summary);
  }

  const verdict = buildVerdictSection(
    params.overallCorrectness,
    params.overallConfidenceScore,
  );
  if (verdict) sections.push(verdict);

  if (params.changes.length > 0) {
    const limited = params.changes.slice(0, MAX_CHANGE_ITEMS);
    const lines = limited.map((c) => `- ${c}`);
    if (params.changes.length > MAX_CHANGE_ITEMS) {
      lines.push(`- ...and ${params.changes.length - MAX_CHANGE_ITEMS} more change(s)`);
    }
    sections.push(`**Changes:**\n${lines.join("\n")}`);
  }

  const reviewedLine = buildReviewedLine(params.commentCount, params.totalChangedFiles);
  const fileTable = buildFileTable(params.files);
  const reviewedSection = fileTable
    ? `### Reviewed changes\n\n${reviewedLine}\n\n<details>\n<summary>Show a summary per file</summary>\n\n${fileTable}\n\n</details>`
    : `### Reviewed changes\n\n${reviewedLine}`;
  sections.push(reviewedSection);

  let body = sections.join("\n\n");
  if (body.length > MAX_REVIEW_BODY_CHARS) {
    body = `${body.slice(0, MAX_REVIEW_BODY_CHARS)}\n\n...(review truncated to fit GitHub limits)`;
  }
  return body;
}

function buildSubsequentReviewBody(params: ReviewBodyParams): string {
  const reviewedLine = buildReviewedLine(params.commentCount, params.totalChangedFiles);
  const sections = ["## Pull request overview", reviewedLine];
  const verdict = buildVerdictSection(
    params.overallCorrectness,
    params.overallConfidenceScore,
  );
  if (verdict) sections.push(verdict);
  return sections.join("\n\n");
}

function buildVerdictSection(correctness: string, confidence: number): string {
  const allowed = new Set(["patch is correct", "patch is incorrect"]);
  if (!allowed.has(correctness)) return "";
  const clamped = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : null;
  const confidenceStr = clamped !== null ? ` (confidence: ${clamped.toFixed(2)})` : "";
  const verdict = correctness.charAt(0).toUpperCase() + correctness.slice(1);
  return `> **Verdict:** ${verdict}${confidenceStr}`;
}

function buildReviewedLine(commentCount: number, totalChangedFiles: number): string {
  const commentLabel =
    commentCount > 0 ? `${commentCount} comment(s)` : "no new comments";
  return `Codex reviewed ${totalChangedFiles} changed file(s) in this pull request and generated ${commentLabel}.`;
}

function buildFileTable(files: ReviewOutput["files"]): string {
  if (files.length === 0) return "";
  const limited = files.slice(0, MAX_FILES_IN_TABLE);
  const rows = limited.map(
    (f) => `| \`${normalizePath(f.path)}\` | ${escapeTableCell(f.description)} |`,
  );
  if (files.length > MAX_FILES_IN_TABLE) {
    rows.push(`| ... | ${files.length - MAX_FILES_IN_TABLE} more file(s) not shown |`);
  }
  return `| File | Description |\n| ---- | ----------- |\n${rows.join("\n")}`;
}

function escapeTableCell(text: unknown): string {
  return String(text ?? "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function buildMetadataSection(params: ReviewBodyParams): string {
  const notes = [
    params.skippedInvalidLocation > 0
      ? `Skipped ${params.skippedInvalidLocation} finding(s) not on changed RIGHT-side lines.`
      : null,
    params.skippedIncomplete > 0
      ? `Skipped ${params.skippedIncomplete} incomplete finding(s).`
      : null,
    params.skippedLowConfidence > 0
      ? `Skipped ${params.skippedLowConfidence} finding(s) below confidence threshold.`
      : null,
  ].filter(Boolean);

  return notes.length > 0
    ? `\n\n<details>\n<summary>Review metadata</summary>\n\n${notes.join("\n")}\n\n</details>`
    : "";
}

function buildFooter(model: string, effort: string, runUrl: string): string {
  const effortSuffix = effort ? ` (effort: ${effort})` : "";
  const reviewLink = runUrl
    ? `[Codex Review](${runUrl})`
    : "Codex Review";
  return `\n\n---\n*Generated by ${reviewLink} using ${model}${effortSuffix}*`;
}

function capReviewBody(body: string): string {
  if (body.length <= GITHUB_MAX_BODY_CHARS) return body;
  const suffix = "\n\n...(review truncated to fit GitHub limits)";
  return body.slice(0, GITHUB_MAX_BODY_CHARS - suffix.length) + suffix;
}

function buildSafeFence(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const maxRun = runs.length > 0 ? Math.max(...runs.map((r) => r.length)) : 0;
  return "`".repeat(Math.max(3, maxRun + 1));
}

// ── JSON parsing (3-tier fallback) ──────────────────────────────────

export function parseStructuredReview(raw: string): ReviewOutput | null {
  const trimmed = raw.trim();

  const direct = tryParseJson(trimmed);
  if (isReviewOutput(direct)) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (isReviewOutput(parsed)) return parsed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const parsed = tryParseJson(trimmed.slice(firstBrace, lastBrace + 1));
    if (isReviewOutput(parsed)) return parsed;
  }

  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Resolve model name ──────────────────────────────────────────────

export function resolveModel(parsed: ReviewOutput | null, envModel: string): string {
  const selfReported = String(parsed?.model ?? "").trim();
  const raw = envModel.trim() || selfReported || "unknown";
  const matches = raw.match(/[A-Za-z0-9._: -]+/g);
  return matches && matches.length > 0 ? matches.join(" ").slice(0, 80) : "unknown";
}

// ── Main publish function ───────────────────────────────────────────

export async function publishReview(params: PublishParams): Promise<boolean> {
  const octokit = github.getOctokit(params.githubToken);
  const { owner, repo } = github.context.repo;
  const pr = github.context.payload.pull_request;
  if (!pr) {
    throw new Error("No pull request payload found.");
  }
  const prNumber = Number(pr.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid pull request number: ${String(pr.number)}`);
  }
  const prHeadSha = String(pr.head?.sha ?? "");

  const output = params.reviewOutput;
  const allFindings = output.findings.map(normalizeFinding);
  const validFindings = allFindings.filter(
    (f): f is NormalizedFinding => f !== null,
  );
  const skippedIncomplete = allFindings.length - validFindings.length;

  const summaryText = output.summary.trim();
  const changes = output.changes.map((c) => String(c).trim()).filter(Boolean);
  const files = output.files;
  const overallCorrectness = output.overall_correctness;
  const overallConfidenceScore = output.overall_confidence_score;
  const model = resolveModel(output, params.model);

  const forceRawFallback =
    output.findings.length > 0 && validFindings.length === 0;

  validFindings.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.confidenceScore - a.confidenceScore;
  });

  const addedByFile = parseAddedLinesByFile(params.diffText);
  const totalChangedFiles = (params.diffText.match(/^diff --git /gm) ?? []).length;

  const reviewComments: ReviewComment[] = [];
  let skippedInvalidLocation = 0;
  let skippedLowConfidence = 0;

  const existingReviewComments = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    { owner, per_page: 100, pull_number: prNumber, repo },
  );
  const existingInlineMarkers = new Set(
    existingReviewComments
      .filter((comment) => comment.user?.type === "Bot")
      .map((comment) => {
        const match = comment.body?.match(/<!-- codex-inline:([a-f0-9]{16}) -->/);
        return match ? match[1] : null;
      })
      .filter((v): v is string => v !== null),
  );

  for (const finding of validFindings) {
    if (finding.confidenceScore < params.minConfidence) {
      skippedLowConfidence += 1;
      continue;
    }

    const addedLines = addedByFile.get(finding.path);
    if (!addedLines?.has(finding.line)) {
      skippedInvalidLocation += 1;
      continue;
    }

    if (reviewComments.length >= params.maxComments) {
      break;
    }

    const signature = computeSignature(finding);
    if (existingInlineMarkers.has(signature)) {
      continue;
    }

    const comment = buildInlineComment(finding, signature);
    if (
      comment.start_line !== undefined &&
      !addedLines?.has(comment.start_line)
    ) {
      delete comment.start_line;
      delete comment.start_side;
    }
    reviewComments.push(comment);
  }

  const existingReviews = await octokit.paginate(
    octokit.rest.pulls.listReviews,
    { owner, per_page: 100, pull_number: prNumber, repo },
  );
  const isFirstReview = !existingReviews.some(
    (review) =>
      review.user?.type === "Bot" && review.body?.includes(REVIEW_MARKER),
  );

  const bodyParams: ReviewBodyParams = {
    changes,
    commentCount: reviewComments.length,
    files,
    isFirstReview,
    model,
    overallConfidenceScore,
    overallCorrectness,
    reviewEffort: params.reviewEffort,
    runUrl: params.runUrl,
    skippedIncomplete,
    skippedInvalidLocation,
    skippedLowConfidence,
    summaryText,
    totalChangedFiles,
  };

  let reviewBody: string;
  if (forceRawFallback) {
    reviewBody = buildFallbackBody(JSON.stringify(output, null, 2));
  } else {
    reviewBody = buildReviewBody(bodyParams);
  }

  try {
    await octokit.rest.pulls.createReview({
      body: reviewBody,
      ...(reviewComments.length > 0 ? { comments: reviewComments } : {}),
      commit_id: prHeadSha,
      event: "COMMENT",
      owner,
      pull_number: prNumber,
      repo,
    });
    core.info(`Published review with ${reviewComments.length} inline comment(s)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to create review with inline comments: ${message}`);

    if (reviewComments.length > 0) {
      try {
        bodyParams.commentCount = 0;
        const fallbackBody = forceRawFallback
          ? buildFallbackBody(JSON.stringify(output, null, 2))
          : buildReviewBody(bodyParams);

        await octokit.rest.pulls.createReview({
          body: fallbackBody,
          commit_id: prHeadSha,
          event: "COMMENT",
          owner,
          pull_number: prNumber,
          repo,
        });
        core.info("Published review without inline comments (fallback)");
        return true;
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        core.warning(`Failed to create fallback review: ${retryMessage}`);
      }
    }
  }

  return false;
}

function buildFallbackBody(rawReview: string): string {
  const raw = rawReview.trim();
  if (!raw) {
    return `${REVIEW_MARKER}\n\n## Pull request overview\n\nCodex returned an empty response.`;
  }
  const limited =
    raw.length > MAX_FALLBACK_CHARS
      ? `${raw.slice(0, MAX_FALLBACK_CHARS)}\n...(truncated)`
      : raw;
  const fence = buildSafeFence(limited);
  return `${REVIEW_MARKER}\n\n## Pull request overview\n\nCould not parse structured Codex output. Raw response:\n\n${fence}\n${limited}\n${fence}`;
}
