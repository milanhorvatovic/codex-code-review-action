import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runTune, TuneError } from "./run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "__fixtures__", "findings-examples");

describe("runTune", () => {
  it("fires the low-confidence diagnosis on the low-confidence-verdict fixture", () => {
    const out = runTune({ findingsPath: resolve(FIXTURES, "low-confidence-verdict.json") });
    const fired = out.diagnoses.filter((d) => d.triggered).map((d) => d.kind);
    expect(fired).toContain("low-confidence");
    expect(out.report).toContain("Recommendation: low-confidence");
    expect(out.report).toContain("```diff");
  });

  it("fires the noisy-p3 diagnosis on the noisy-p3 fixture", () => {
    const out = runTune({ findingsPath: resolve(FIXTURES, "noisy-p3.json") });
    const fired = out.diagnoses.filter((d) => d.triggered).map((d) => d.kind);
    expect(fired).toContain("noisy-p3");
    expect(out.report).toMatch(/min-confidence:/);
  });

  it("fires the truncation diagnosis on the truncation fixture", () => {
    const out = runTune({ findingsPath: resolve(FIXTURES, "truncation.json") });
    const fired = out.diagnoses.filter((d) => d.triggered).map((d) => d.kind);
    expect(fired).toContain("truncation");
    expect(out.report).toMatch(/max-chunk-bytes/);
  });

  it("reports a clean verdict when no diagnoses fire", () => {
    const cleanFindings = JSON.stringify({
      changes: ["small refactor"],
      effort: "low",
      files: [{ description: "rename", path: "x.ts" }],
      findings: [],
      model: "gpt-5",
      overall_confidence_score: 0.97,
      overall_correctness: "patch is correct",
      summary: "Tidy refactor; no concerns.",
    });
    const out = runTune({ findingsText: cleanFindings });
    expect(out.report).toContain("No diagnoses fired");
  });

  it("rejects an invocation without findings-path or findings-text", () => {
    expect(() => runTune({})).toThrow(TuneError);
  });
});
