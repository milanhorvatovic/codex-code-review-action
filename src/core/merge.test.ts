import { describe, expect, it } from "vitest";

import type { ReviewOutput } from "../config/types.js";

import { mergeChunkReviews } from "./merge.js";

function makeChunk(overrides: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    changes: ["change A"],
    effort: null,
    files: [{ description: "file desc", path: "src/a.ts" }],
    findings: [
      {
        body: "finding body",
        confidence_score: 0.9,
        line: 10,
        path: "src/a.ts",
        priority: 1,
        reasoning: "reasoning",
        start_line: null,
        suggestion: null,
        title: "finding title",
      },
    ],
    model: "gpt-4",
    overall_confidence_score: 0.85,
    overall_correctness: "patch is correct",
    summary: "Summary A",
    ...overrides,
  };
}

describe("mergeChunkReviews", () => {
  it("single chunk passes through unchanged", () => {
    const chunk = makeChunk();
    const result = mergeChunkReviews([chunk]);
    expect(result).toEqual(chunk);
  });

  it("merges two chunks: summaries joined, findings concatenated, files merged", () => {
    const chunk1 = makeChunk();
    const chunk2 = makeChunk({
      changes: ["change B"],
      files: [{ description: "file desc B", path: "src/b.ts" }],
      findings: [
        {
          body: "finding body B",
          confidence_score: 0.8,
          line: 20,
          path: "src/b.ts",
          priority: 2,
          reasoning: "reasoning B",
          start_line: null,
          suggestion: null,
          title: "finding title B",
        },
      ],
      summary: "Summary B",
    });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.summary).toBe("Summary A Summary B");
    expect(result.findings).toHaveLength(2);
    expect(result.files).toHaveLength(2);
    expect(result.changes).toEqual(["change A", "change B"]);
  });

  it("deduplicates changes by text", () => {
    const chunk1 = makeChunk({ changes: ["same change", "unique A"] });
    const chunk2 = makeChunk({ changes: ["same change", "unique B"] });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.changes).toEqual(["same change", "unique A", "unique B"]);
  });

  it("deduplicates files by path", () => {
    const chunk1 = makeChunk({
      files: [{ description: "desc 1", path: "src/shared.ts" }],
    });
    const chunk2 = makeChunk({
      files: [{ description: "desc 2", path: "src/shared.ts" }],
    });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].description).toBe("desc 1");
  });

  it("worst verdict wins (one correct + one incorrect = incorrect)", () => {
    const chunk1 = makeChunk({ overall_correctness: "patch is correct" });
    const chunk2 = makeChunk({ overall_correctness: "patch is incorrect" });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.overall_correctness).toBe("patch is incorrect");
  });

  it("all correct = correct", () => {
    const chunk1 = makeChunk({ overall_correctness: "patch is correct" });
    const chunk2 = makeChunk({ overall_correctness: "patch is correct" });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.overall_correctness).toBe("patch is correct");
  });

  it("lowest confidence score selected", () => {
    const chunk1 = makeChunk({ overall_confidence_score: 0.9 });
    const chunk2 = makeChunk({ overall_confidence_score: 0.6 });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.overall_confidence_score).toBe(0.6);
  });

  it("empty chunks array throws error", () => {
    expect(() => mergeChunkReviews([])).toThrow("No valid chunk outputs to merge");
  });

  it("expected count mismatch throws error", () => {
    const chunk = makeChunk();
    expect(() => mergeChunkReviews([chunk], 3)).toThrow(
      "Chunk count mismatch: expected 3, got 1",
    );
  });

  it("model taken from first non-empty chunk", () => {
    const chunk1 = makeChunk({ model: "" });
    const chunk2 = makeChunk({ model: "gpt-4o" });
    const chunk3 = makeChunk({ model: "gpt-3.5" });

    const result = mergeChunkReviews([chunk1, chunk2, chunk3]);
    expect(result.model).toBe("gpt-4o");
  });

  it("effort taken from first non-null chunk", () => {
    const chunk1 = makeChunk({ effort: null });
    const chunk2 = makeChunk({ effort: "high" });
    const chunk3 = makeChunk({ effort: "low" });

    const result = mergeChunkReviews([chunk1, chunk2, chunk3]);
    expect(result.effort).toBe("high");
  });

  it("effort remains null when all chunks have null effort", () => {
    const chunk1 = makeChunk({ effort: null });
    const chunk2 = makeChunk({ effort: null });

    const result = mergeChunkReviews([chunk1, chunk2]);
    expect(result.effort).toBeNull();
  });
});
