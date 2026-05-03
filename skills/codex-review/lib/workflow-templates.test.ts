import { describe, expect, it } from "vitest";

import { assertWorkflow } from "./invariants.js";
import { renderHardenedWorkflow } from "./workflow-templates.js";

const SHA = "1111111111111111111111111111111111111111";
const TAG = "v2.1.0";

describe("renderHardenedWorkflow", () => {
  it("rejects a malformed SHA", () => {
    expect(() => renderHardenedWorkflow({ allowUsers: "alice", pinSha: "abc", pinTag: TAG })).toThrow(/40-character/);
  });

  it("rejects a malformed tag", () => {
    expect(() => renderHardenedWorkflow({ allowUsers: "alice", pinSha: SHA, pinTag: "latest" })).toThrow(/vX\.Y\.Z/);
  });

  it("emits a workflow that passes every consumer-controls invariant on v2.1.0", () => {
    const yamlText = renderHardenedWorkflow({ allowUsers: "alice,bob", pinSha: SHA, pinTag: TAG });
    const report = assertWorkflow(yamlText, { actionVersion: TAG });
    if (!report.ok) console.error(report.outcomes);
    expect(report.ok).toBe(true);
  });

  it("preserves the trailing tag comment on every uses: line", () => {
    const yamlText = renderHardenedWorkflow({ allowUsers: "alice", pinSha: SHA, pinTag: TAG });
    const matches = yamlText.match(/milanhorvatovic\/codex-ai-code-review-action\/(prepare|review|publish)@[0-9a-f]{40} # v2\.1\.0/g);
    expect(matches?.length).toBe(3);
  });

  it("falls back to an empty allow-users when none is supplied", () => {
    const yamlText = renderHardenedWorkflow({ allowUsers: "  ", pinSha: SHA, pinTag: TAG });
    expect(yamlText).toMatch(/allow-users: ""/);
  });
});
