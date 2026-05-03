import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertWorkflow, formatReport } from "./invariants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_WORKFLOW = resolve(
  HERE,
  "..",
  "__fixtures__",
  "repos",
  "codex-review-action",
  ".github",
  "workflows",
  "codex-review.yaml",
);

function readFixture(): string {
  return readFileSync(FIXTURE_WORKFLOW, "utf-8");
}

describe("assertWorkflow against the dogfood fixture", () => {
  it("passes CC-01..CC-07 and CC-09 on the v2.1.0-pre dogfood workflow", () => {
    const report = assertWorkflow(readFixture(), { actionVersion: "v2.1.0-pre" });
    const byId = new Map(report.outcomes.map((o) => [o.id, o]));
    expect(byId.get("CC-01")?.ok).toBe(true);
    expect(byId.get("CC-02")?.ok).toBe(true);
    expect(byId.get("CC-03")?.ok).toBe(true);
    expect(byId.get("CC-04")?.ok).toBe(true);
    expect(byId.get("CC-05")?.ok).toBe(true);
    expect(byId.get("CC-06")?.ok).toBe(true);
    expect(byId.get("CC-07")?.ok).toBe(true);
    expect(byId.get("CC-09")?.ok).toBe(true);
    expect(byId.get("CC-EXTRA-01-bare-action")?.ok).toBe(true);
  });

  it("CC-08 passes when the workflow is treated as v2.1.0+", () => {
    const report = assertWorkflow(readFixture(), { actionVersion: "v2.1.0" });
    const cc08 = report.outcomes.find((o) => o.id === "CC-08");
    expect(cc08?.ok).toBe(true);
  });

  it("CC-08 is skipped (passes) on a pre-v2.1.0 workflow", () => {
    const report = assertWorkflow(readFixture(), { actionVersion: "v2.0.0" });
    const cc08 = report.outcomes.find((o) => o.id === "CC-08");
    expect(cc08?.ok).toBe(true);
    expect(cc08?.detail).toMatch(/skipped/);
  });
});

describe("assertWorkflow failure cases", () => {
  const baseWorkflow = `name: Codex code review

on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  prepare:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111

  review:
    needs: prepare
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: codex-review
    permissions:
      contents: read
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/review@1111111111111111111111111111111111111111
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}

  publish:
    needs: [prepare, review]
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: milanhorvatovic/codex-ai-code-review-action/publish@1111111111111111111111111111111111111111
        with:
          retain-findings: "false"
          fail-on-missing-chunks: "true"
`;

  it("CC-01 fails when sub-actions disagree on SHA", () => {
    const broken = baseWorkflow.replace(
      "/review@1111111111111111111111111111111111111111",
      "/review@2222222222222222222222222222222222222222",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-01")?.ok).toBe(false);
  });

  it("CC-02 fails when the workflow uses pull_request_target", () => {
    const broken = baseWorkflow.replace("pull_request:", "pull_request_target:");
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-02")?.ok).toBe(false);
  });

  it("CC-03 fails when one job omits the same-repo gate", () => {
    const broken = baseWorkflow.replace(
      /publish:\n\s+needs: \[prepare, review\]\n\s+if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
      "publish:\n    needs: [prepare, review]\n    if: always()",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-03")?.ok).toBe(false);
  });

  it("CC-04 fails when prepare references the OpenAI key", () => {
    const broken = baseWorkflow.replace(
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n        env:\n          KEY: ${{ secrets.OPENAI_API_KEY }}",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-04")?.ok).toBe(false);
  });

  it("CC-05 fails when prepare requests pull-requests: write", () => {
    const broken = baseWorkflow.replace(
      "  prepare:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read",
      "  prepare:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      pull-requests: write",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-05")?.ok).toBe(false);
  });

  it("CC-07 fails when retain-findings: 'true' lacks a consent comment", () => {
    const broken = baseWorkflow.replace(`retain-findings: "false"`, `retain-findings: "true"`);
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-07")?.ok).toBe(false);
  });

  it("CC-07 passes when retain-findings: 'true' has a 'retention approved' comment", () => {
    const broken = baseWorkflow.replace(
      `retain-findings: "false"`,
      `retain-findings: "true" # retention approved by audit team`,
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-07")?.ok).toBe(true);
  });

  it("CC-09 fails when review-reference-file is wired without consent", () => {
    const broken = baseWorkflow.replace(
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n        with:\n          review-reference-file: .github/codex/review-reference.md",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-09")?.ok).toBe(false);
  });

  it("CC-09 passes when review-reference-file is wired with a 'workspace-mode accepted' comment", () => {
    const broken = baseWorkflow.replace(
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
      "      - uses: milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111\n        # workspace-mode accepted by maintainer\n        with:\n          review-reference-file: .github/codex/review-reference.md",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-09")?.ok).toBe(true);
  });

  it("CC-EXTRA-01 fails when the bare action is referenced", () => {
    const broken = baseWorkflow.replace(
      "milanhorvatovic/codex-ai-code-review-action/prepare@1111111111111111111111111111111111111111",
      "milanhorvatovic/codex-ai-code-review-action@1111111111111111111111111111111111111111",
    );
    const report = assertWorkflow(broken);
    expect(report.outcomes.find((o) => o.id === "CC-EXTRA-01-bare-action")?.ok).toBe(false);
  });
});

describe("formatReport", () => {
  it("renders one line per outcome", () => {
    const report = assertWorkflow(readFixture(), { actionVersion: "v2.1.0" });
    const formatted = formatReport(report);
    expect(formatted.split("\n").length).toBe(report.outcomes.length);
    expect(formatted).toContain("CC-01");
  });
});
