import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runAdopt } from "./run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = resolve(HERE, "..", "..", "__fixtures__", "repos", "codex-review-action");
const SHA = "0fc55cdd3d5cf9841c9ba58822354f67b6c63293";
const TAG = "v2.1.0";

describe("runAdopt against the codex-review-action fixture", () => {
  it("emits a workflow that passes every CC invariant on v2.1.0", () => {
    const out = runAdopt({
      allowUsers: "milanhorvatovic",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      projectName: "codex-ai-code-review-action",
      targetRepo: FIXTURE_REPO,
    });
    expect(out.invariantsReport).toContain("CC-01");
    expect(out.invariantsReport).not.toMatch(/^✗/m);
  });

  it("includes the resolved tag in the workflow's pin comments", () => {
    const out = runAdopt({
      allowUsers: "alice",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      targetRepo: FIXTURE_REPO,
    });
    expect(out.workflow).toMatch(/prepare@0fc55cdd3d5cf9841c9ba58822354f67b6c63293 # v2\.1\.0/);
    expect(out.workflow).toMatch(/review@0fc55cdd3d5cf9841c9ba58822354f67b6c63293 # v2\.1\.0/);
    expect(out.workflow).toMatch(/publish@0fc55cdd3d5cf9841c9ba58822354f67b6c63293 # v2\.1\.0/);
  });

  it("does NOT wire review-reference-file in the emitted workflow (option 2 default)", () => {
    const out = runAdopt({
      allowUsers: "alice",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      targetRepo: FIXTURE_REPO,
    });
    expect(out.workflow).not.toMatch(/review-reference-file:/);
  });

  it("emits a starter reference file with the consent guidance comment", () => {
    const out = runAdopt({
      allowUsers: "alice",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      targetRepo: FIXTURE_REPO,
    });
    expect(out.referenceFile.toLowerCase()).toContain("not wired into the workflow");
    expect(out.referenceFile).toMatch(/### JavaScript \/ TypeScript/);
  });

  it("emits an ADOPTION report mapping decisions to CC-NN", () => {
    const out = runAdopt({
      allowUsers: "alice",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      targetRepo: FIXTURE_REPO,
    });
    expect(out.adoptionReport).toContain("# Adoption report");
    for (const id of ["CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08", "CC-09"]) {
      expect(out.adoptionReport).toContain(id);
    }
  });

  it("returns three planned writes targeting the consumer working tree", () => {
    const out = runAdopt({
      allowUsers: "alice",
      dryRun: true,
      pin: { sha: SHA, tag: TAG },
      targetRepo: FIXTURE_REPO,
    });
    const paths = out.writes.map((w) => w.path).sort();
    expect(paths).toEqual([
      ".github/codex/review-reference.md",
      ".github/workflows/codex-review.yaml",
      "ADOPTION.md",
    ]);
  });
});
