import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFindings } from "../findings-loader.js";
import { lowConfidenceDiagnosis } from "./low-confidence.js";
import { noisyP3Diagnosis } from "./noisy-p3.js";
import { truncationDiagnosis } from "./truncation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "__fixtures__", "findings-examples");

function load(name: string): ReturnType<typeof parseFindings> {
  return parseFindings(readFileSync(resolve(FIXTURES, name), "utf-8"));
}

describe("lowConfidenceDiagnosis", () => {
  it("triggers on the low-confidence-verdict fixture", () => {
    const out = lowConfidenceDiagnosis(load("low-confidence-verdict.json"));
    expect(out.triggered).toBe(true);
    expect(out.recommendations[0]?.target).toBe("reference-file");
    expect(out.recommendations[0]?.diff).toContain("Calibration");
  });

  it("does not trigger when overall confidence is high", () => {
    const out = lowConfidenceDiagnosis(load("noisy-p3.json"));
    expect(out.triggered).toBe(false);
  });
});

describe("noisyP3Diagnosis", () => {
  it("triggers when there are more than six P3 findings", () => {
    const out = noisyP3Diagnosis(load("noisy-p3.json"));
    expect(out.triggered).toBe(true);
    expect(out.recommendations[0]?.target).toBe("workflow");
    expect(out.recommendations[0]?.diff).toMatch(/min-confidence:/);
  });

  it("does not trigger on a quiet diff", () => {
    const out = noisyP3Diagnosis(load("low-confidence-verdict.json"));
    expect(out.triggered).toBe(false);
  });
});

describe("truncationDiagnosis", () => {
  it("triggers when the summary contains 'Incomplete review'", () => {
    const out = truncationDiagnosis(load("truncation.json"));
    expect(out.triggered).toBe(true);
    expect(out.recommendations[0]?.diff).toMatch(/max-chunk-bytes/);
  });

  it("does not trigger on a clean summary", () => {
    const out = truncationDiagnosis(load("noisy-p3.json"));
    expect(out.triggered).toBe(false);
  });
});
