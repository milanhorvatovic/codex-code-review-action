import { describe, expect, it } from "vitest";

import { isReviewOutput } from "./types.js";

describe("isReviewOutput", () => {
  const valid = {
    changes: ["Added feature"],
    files: [{ description: "Main file", path: "src/main.ts" }],
    findings: [],
    model: "test-model",
    overall_confidence_score: 0.9,
    overall_correctness: "patch is correct",
    summary: "All good",
  };

  it("returns true for a valid ReviewOutput", () => {
    expect(isReviewOutput(valid)).toBe(true);
  });

  it("returns true for 'patch is incorrect' verdict", () => {
    expect(isReviewOutput({ ...valid, overall_correctness: "patch is incorrect" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isReviewOutput(null)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isReviewOutput([])).toBe(false);
  });

  it("returns false for missing summary", () => {
    expect(isReviewOutput({ ...valid, summary: undefined })).toBe(false);
  });

  it("returns false for missing findings", () => {
    expect(isReviewOutput({ ...valid, findings: undefined })).toBe(false);
  });

  it("returns false for non-array findings", () => {
    expect(isReviewOutput({ ...valid, findings: "not-array" })).toBe(false);
  });

  it("returns false for invalid overall_correctness", () => {
    expect(isReviewOutput({ ...valid, overall_correctness: "unknown" })).toBe(false);
  });

  it("returns false for non-finite confidence score", () => {
    expect(isReviewOutput({ ...valid, overall_confidence_score: Infinity })).toBe(false);
  });

  it("returns false for missing model", () => {
    expect(isReviewOutput({ ...valid, model: undefined })).toBe(false);
  });
});
