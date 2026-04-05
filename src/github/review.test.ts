import { describe, expect, it } from "vitest";

import type { NormalizedFinding, ReviewOutput } from "../config/types.js";
import {
  buildInlineComment,
  buildReviewBody,
  computeSignature,
  normalizeFinding,
  parseAddedLinesByFile,
  parseStructuredReview,
  resolveModel,
} from "./review.js";

describe("parseAddedLinesByFile", () => {
  it("extracts added lines from a simple diff", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added line",
      " line2",
      " line3",
    ].join("\n");

    const result = parseAddedLinesByFile(diff);
    expect(result.get("file.ts")).toEqual(new Set([2]));
  });

  it("handles multiple files", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      " existing",
      "+new in a",
      " end",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,2 +1,3 @@",
      " existing",
      "+new in b",
      " end",
    ].join("\n");

    const result = parseAddedLinesByFile(diff);
    expect(result.get("a.ts")).toEqual(new Set([2]));
    expect(result.get("b.ts")).toEqual(new Set([2]));
  });

  it("handles multiple hunks in one file", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added1",
      " line2",
      " line3",
      "@@ -10,3 +11,4 @@",
      " line10",
      "+added2",
      " line11",
      " line12",
    ].join("\n");

    const result = parseAddedLinesByFile(diff);
    expect(result.get("file.ts")).toEqual(new Set([2, 12]));
  });

  it("skips deleted files", () => {
    const diff = [
      "diff --git a/deleted.ts b/deleted.ts",
      "--- a/deleted.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line1",
      "-line2",
    ].join("\n");

    const result = parseAddedLinesByFile(diff);
    expect(result.has("deleted.ts")).toBe(false);
  });

  it("returns empty map for empty diff", () => {
    expect(parseAddedLinesByFile("")).toEqual(new Map());
  });
});

describe("normalizeFinding", () => {
  const validRaw = {
    body: "Fix this",
    confidence_score: 0.8,
    line: 10,
    path: "src/main.ts",
    priority: 1,
    reasoning: "Because reasons",
    start_line: null,
    suggestion: null,
    title: "Bug found",
  };

  it("normalizes a valid finding", () => {
    const result = normalizeFinding(validRaw);
    expect(result).toEqual({
      body: "Fix this",
      confidenceScore: 0.8,
      line: 10,
      path: "src/main.ts",
      priority: 1,
      reasoning: "Because reasons",
      startLine: null,
      suggestion: null,
      title: "Bug found",
    });
  });

  it("returns null for null input", () => {
    expect(normalizeFinding(null)).toBeNull();
  });

  it("returns null for missing title", () => {
    expect(normalizeFinding({ ...validRaw, title: "" })).toBeNull();
  });

  it("returns null for invalid priority", () => {
    expect(normalizeFinding({ ...validRaw, priority: 5 })).toBeNull();
  });

  it("returns null for confidence out of range", () => {
    expect(normalizeFinding({ ...validRaw, confidence_score: 1.5 })).toBeNull();
  });

  it("returns null for negative line", () => {
    expect(normalizeFinding({ ...validRaw, line: -1 })).toBeNull();
  });

  it("returns null when start_line > line", () => {
    expect(normalizeFinding({ ...validRaw, start_line: 20 })).toBeNull();
  });

  it("normalizes path with b/ prefix", () => {
    const result = normalizeFinding({ ...validRaw, path: "b/src/main.ts" });
    expect(result?.path).toBe("src/main.ts");
  });

  it("normalizes path with ./ prefix", () => {
    const result = normalizeFinding({ ...validRaw, path: "./src/main.ts" });
    expect(result?.path).toBe("src/main.ts");
  });

  it("handles valid start_line", () => {
    const result = normalizeFinding({ ...validRaw, start_line: 5 });
    expect(result?.startLine).toBe(5);
  });
});

describe("buildInlineComment", () => {
  const baseFinding: NormalizedFinding = {
    body: "This is a problem",
    confidenceScore: 0.9,
    line: 10,
    path: "src/main.ts",
    priority: 1,
    reasoning: "Detailed reasoning here",
    startLine: null,
    suggestion: null,
    title: "Bug title",
  };

  it("uses WARNING alert for P1", () => {
    const comment = buildInlineComment(baseFinding, "abc123");
    expect(comment.body).toContain("[!WARNING]");
  });

  it("uses CAUTION alert for P0", () => {
    const comment = buildInlineComment({ ...baseFinding, priority: 0 }, "abc123");
    expect(comment.body).toContain("[!CAUTION]");
  });

  it("uses NOTE alert for P2", () => {
    const comment = buildInlineComment({ ...baseFinding, priority: 2 }, "abc123");
    expect(comment.body).toContain("[!NOTE]");
  });

  it("includes suggestion block when present", () => {
    const comment = buildInlineComment(
      { ...baseFinding, suggestion: "const x = 1;" },
      "abc123",
    );
    expect(comment.body).toContain("```suggestion");
    expect(comment.body).toContain("const x = 1;");
  });

  it("uses dynamic fence with suggestion info string when suggestion contains triple backticks", () => {
    const comment = buildInlineComment(
      { ...baseFinding, suggestion: "code with ``` inside" },
      "abc123",
    );
    expect(comment.body).toContain("````suggestion");
    expect(comment.body).toContain("code with ``` inside");
  });

  it("includes reasoning in details block for P1+", () => {
    const comment = buildInlineComment(baseFinding, "abc123");
    expect(comment.body).toContain("<details>");
    expect(comment.body).toContain("Detailed reasoning here");
  });

  it("excludes reasoning details for P0", () => {
    const comment = buildInlineComment({ ...baseFinding, priority: 0 }, "abc123");
    expect(comment.body).not.toContain("<details>");
  });

  it("includes signature marker", () => {
    const comment = buildInlineComment(baseFinding, "abc123def456");
    expect(comment.body).toContain("<!-- codex-inline:abc123def456 -->");
  });

  it("sets start_line when present and valid", () => {
    const comment = buildInlineComment(
      { ...baseFinding, startLine: 5 },
      "abc123",
    );
    expect(comment.start_line).toBe(5);
    expect(comment.start_side).toBe("RIGHT");
  });

  it("omits start_line when null", () => {
    const comment = buildInlineComment(baseFinding, "abc123");
    expect(comment.start_line).toBeUndefined();
  });
});

describe("computeSignature", () => {
  it("returns a 16-char hex string", () => {
    const finding: NormalizedFinding = {
      body: "body",
      confidenceScore: 0.9,
      line: 10,
      path: "src/main.ts",
      priority: 1,
      reasoning: "reason",
      startLine: null,
      suggestion: null,
      title: "title",
    };
    const sig = computeSignature(finding);
    expect(sig).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces consistent results for same input", () => {
    const finding: NormalizedFinding = {
      body: "body",
      confidenceScore: 0.9,
      line: 10,
      path: "src/main.ts",
      priority: 1,
      reasoning: "reason",
      startLine: null,
      suggestion: null,
      title: "title",
    };
    expect(computeSignature(finding)).toBe(computeSignature(finding));
  });
});

describe("buildReviewBody", () => {
  const baseParams = {
    changes: ["Added feature X"],
    commentCount: 3,
    files: [{ description: "Main entry", path: "src/main.ts" }] as ReviewOutput["files"],
    isFirstReview: true,
    model: "test-model",
    overallConfidenceScore: 0.9,
    overallCorrectness: "patch is correct",
    reviewEffort: "medium",
    runUrl: "https://example.com/run/1",
    skippedIncomplete: 0,
    skippedInvalidLocation: 1,
    skippedLowConfidence: 0,
    summaryText: "This PR adds a new feature",
    totalChangedFiles: 2,
  };

  it("includes review marker", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("<!-- codex-pr-review -->");
  });

  it("includes summary for first review", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("This PR adds a new feature");
  });

  it("includes verdict", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("Patch is correct");
    expect(body).toContain("confidence: 0.90");
  });

  it("includes changes list", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("- Added feature X");
  });

  it("includes file table", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("src/main.ts");
    expect(body).toContain("Main entry");
  });

  it("includes footer with model and effort", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("test-model");
    expect(body).toContain("effort: medium");
  });

  it("includes metadata for skipped findings", () => {
    const body = buildReviewBody(baseParams);
    expect(body).toContain("Skipped 1 finding(s) not on changed RIGHT-side lines.");
  });

  it("builds shorter body for subsequent reviews", () => {
    const body = buildReviewBody({ ...baseParams, isFirstReview: false });
    expect(body).not.toContain("**Changes:**");
    expect(body).not.toContain("Show a summary per file");
  });

  it("omits metadata section when no findings skipped", () => {
    const body = buildReviewBody({
      ...baseParams,
      skippedIncomplete: 0,
      skippedInvalidLocation: 0,
      skippedLowConfidence: 0,
    });
    expect(body).not.toContain("Review metadata");
  });

  it("shows all metadata types", () => {
    const body = buildReviewBody({
      ...baseParams,
      skippedIncomplete: 2,
      skippedInvalidLocation: 3,
      skippedLowConfidence: 1,
    });
    expect(body).toContain("Skipped 3 finding(s) not on changed RIGHT-side lines.");
    expect(body).toContain("Skipped 2 incomplete finding(s).");
    expect(body).toContain("Skipped 1 finding(s) below confidence threshold.");
  });

  it("omits verdict for unknown correctness", () => {
    const body = buildReviewBody({ ...baseParams, overallCorrectness: "unknown" });
    expect(body).not.toContain("Verdict");
  });

  it("handles empty files list", () => {
    const body = buildReviewBody({ ...baseParams, files: [] });
    expect(body).not.toContain("Show a summary per file");
  });

  it("handles empty changes list", () => {
    const body = buildReviewBody({ ...baseParams, changes: [] });
    expect(body).not.toContain("**Changes:**");
  });

  it("omits effort when empty", () => {
    const body = buildReviewBody({ ...baseParams, reviewEffort: "" });
    expect(body).not.toContain("effort:");
  });

  it("handles zero comment count", () => {
    const body = buildReviewBody({ ...baseParams, commentCount: 0 });
    expect(body).toContain("no new comments");
  });
});

describe("parseStructuredReview", () => {
  const validJson = JSON.stringify({
    changes: [],
    files: [],
    findings: [],
    model: "test",
    overall_confidence_score: 0.9,
    overall_correctness: "patch is correct",
    summary: "test",
  });

  it("parses raw JSON directly", () => {
    const result = parseStructuredReview(validJson);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe("test");
  });

  it("parses fenced code block", () => {
    const fenced = "```json\n" + validJson + "\n```";
    const result = parseStructuredReview(fenced);
    expect(result).not.toBeNull();
  });

  it("parses brace extraction", () => {
    const wrapped = "Here is the review:\n" + validJson + "\nDone.";
    const result = parseStructuredReview(wrapped);
    expect(result).not.toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseStructuredReview("not json at all")).toBeNull();
  });

  it("returns null for valid JSON without findings array", () => {
    expect(parseStructuredReview('{"key": "value"}')).toBeNull();
  });

  it("handles whitespace-padded input", () => {
    const result = parseStructuredReview("  " + validJson + "  ");
    expect(result).not.toBeNull();
  });
});

describe("resolveModel", () => {
  it("uses env model when provided", () => {
    expect(resolveModel(null, "o4-mini")).toBe("o4-mini");
  });

  it("falls back to self-reported model", () => {
    const parsed = { model: "codex-mini" } as ReviewOutput;
    expect(resolveModel(parsed, "")).toBe("codex-mini");
  });

  it("returns unknown when no model available", () => {
    expect(resolveModel(null, "")).toBe("unknown");
  });

  it("sanitizes model name", () => {
    expect(resolveModel(null, "model<script>")).toBe("model script");
  });

  it("truncates long model names", () => {
    const longName = "a".repeat(200);
    const result = resolveModel(null, longName);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

