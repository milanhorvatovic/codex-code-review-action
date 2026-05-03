import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FindingsValidationError, parseFindings } from "./findings-loader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "__fixtures__", "findings-examples");

describe("parseFindings", () => {
  it("accepts the low-confidence-verdict fixture", () => {
    const text = readFileSync(resolve(FIXTURES, "low-confidence-verdict.json"), "utf-8");
    const parsed = parseFindings(text);
    expect(parsed.overall_correctness).toBe("patch is correct");
    expect(parsed.findings.length).toBe(2);
  });

  it("accepts the noisy-p3 fixture", () => {
    const text = readFileSync(resolve(FIXTURES, "noisy-p3.json"), "utf-8");
    const parsed = parseFindings(text);
    expect(parsed.findings.every((f) => f.priority === 3)).toBe(true);
  });

  it("accepts the truncation fixture", () => {
    const text = readFileSync(resolve(FIXTURES, "truncation.json"), "utf-8");
    const parsed = parseFindings(text);
    expect(parsed.summary.toLowerCase()).toContain("incomplete review");
  });

  it("rejects out-of-range confidence_score", () => {
    expect(() =>
      parseFindings(
        JSON.stringify({
          changes: [],
          effort: null,
          files: [],
          findings: [
            {
              body: "x",
              confidence_score: 1.5,
              line: 1,
              path: "x",
              priority: 1,
              reasoning: "x",
              start_line: null,
              suggestion: null,
              title: "x",
            },
          ],
          model: "x",
          overall_confidence_score: 0.5,
          overall_correctness: "patch is correct",
          summary: "x",
        }),
      ),
    ).toThrow(FindingsValidationError);
  });

  it("rejects an unknown overall_correctness value", () => {
    expect(() =>
      parseFindings(
        JSON.stringify({
          changes: [],
          effort: null,
          files: [],
          findings: [],
          model: "x",
          overall_confidence_score: 0.5,
          overall_correctness: "unknown",
          summary: "x",
        }),
      ),
    ).toThrow(/overall_correctness/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseFindings("{not json")).toThrow(/not valid JSON/);
  });
});
