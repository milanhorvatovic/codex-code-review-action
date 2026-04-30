import { describe, expect, it } from "vitest";

import {
  refreshReadme,
  removeIssue44Paragraph,
  rewriteAllSelfPins,
  rewriteSelfPin,
  rewriteShaTagNote,
  runCli,
  uncommentFailOnMissingChunks,
} from "./refresh-self-pins.js";

const NEW_SHA = "1111111111111111111111111111111111111111";
const OLD_SHA = "af72a5bd7330432cee97137b04d04edebde80149";

describe("rewriteSelfPin", () => {
  it("rewrites a top-level self-reference", () => {
    const line = `      uses: milanhorvatovic/codex-ai-code-review-action@${OLD_SHA} # v2.0.0`;
    expect(rewriteSelfPin(line, "2.1.0", NEW_SHA)).toBe(
      `      uses: milanhorvatovic/codex-ai-code-review-action@${NEW_SHA} # v2.1.0`,
    );
  });

  it("rewrites a sub-action self-reference", () => {
    const line = `      uses: milanhorvatovic/codex-ai-code-review-action/prepare@${OLD_SHA} # v2.0.0`;
    expect(rewriteSelfPin(line, "2.1.0", NEW_SHA)).toBe(
      `      uses: milanhorvatovic/codex-ai-code-review-action/prepare@${NEW_SHA} # v2.1.0`,
    );
  });

  it("appends a tag comment when none was present", () => {
    const line = `      uses: milanhorvatovic/codex-ai-code-review-action@${OLD_SHA}`;
    expect(rewriteSelfPin(line, "2.1.0", NEW_SHA)).toBe(
      `      uses: milanhorvatovic/codex-ai-code-review-action@${NEW_SHA} # v2.1.0`,
    );
  });

  it("leaves third-party action references untouched", () => {
    const line = `      uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`;
    expect(rewriteSelfPin(line, "2.1.0", NEW_SHA)).toBe(line);
  });

  it("leaves @v2-style floating tags untouched", () => {
    const line = `      uses: milanhorvatovic/codex-ai-code-review-action@v2`;
    expect(rewriteSelfPin(line, "2.1.0", NEW_SHA)).toBe(line);
  });

  it("rejects a non-40-hex SHA", () => {
    expect(() => rewriteSelfPin("noop", "2.1.0", "abcd1234")).toThrow(
      /SHA must be a 40-character hex string/,
    );
  });
});

describe("rewriteAllSelfPins", () => {
  it("rewrites every self-reference and leaves others untouched", () => {
    const content = [
      `      uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`,
      `      uses: milanhorvatovic/codex-ai-code-review-action/prepare@${OLD_SHA} # v2.0.0`,
      `      uses: milanhorvatovic/codex-ai-code-review-action/review@${OLD_SHA} # v2.0.0`,
      `      uses: milanhorvatovic/codex-ai-code-review-action/publish@${OLD_SHA} # v2.0.0`,
    ].join("\n");
    const result = rewriteAllSelfPins(content, "2.1.0", NEW_SHA);
    expect(result.split("\n")[0]).toContain("actions/checkout@");
    expect((result.match(new RegExp(NEW_SHA, "g")) ?? []).length).toBe(3);
    expect(result).not.toContain(OLD_SHA);
  });
});

describe("uncommentFailOnMissingChunks", () => {
  it("uncomments the line and strips the scaffolding comment", () => {
    const content = [
      `          retain-findings: false # explicit for auditors; matches the action default`,
      `          # fail-on-missing-chunks: "true" # available in the next tagged release; uncomment after bumping the SHAs above`,
    ].join("\n");
    const result = uncommentFailOnMissingChunks(content);
    expect(result.split("\n")[1]).toBe(`          fail-on-missing-chunks: "true"`);
  });

  it("leaves the file unchanged when the commented form is absent", () => {
    const content = `          fail-on-missing-chunks: "true"`;
    expect(uncommentFailOnMissingChunks(content)).toBe(content);
  });
});

describe("removeIssue44Paragraph", () => {
  it("removes the paragraph and one surrounding blank line", () => {
    const content = [
      "previous content",
      "",
      "When you adopt a release that contains [issue #44](https://example), bump the SHAs.",
      "",
      "next content",
      "",
    ].join("\n");
    const result = removeIssue44Paragraph(content);
    expect(result).not.toContain("issue #44");
    expect(result).toContain("previous content");
    expect(result).toContain("next content");
    expect(result).not.toContain("\n\n\n");
  });

  it("returns the input unchanged when the paragraph is absent", () => {
    const content = "no issue 44 mention here\n";
    expect(removeIssue44Paragraph(content)).toBe(content);
  });

  it("removes the paragraph when it is the last text in the file (no trailing newline)", () => {
    const content = [
      "previous content",
      "",
      "When you adopt a release that contains [issue #44](https://example), bump the SHAs.",
    ].join("\n");
    const result = removeIssue44Paragraph(content);
    expect(result).not.toContain("issue #44");
    expect(result).toContain("previous content");
    expect(result).not.toContain("\n\n\n");
  });

  it("removes the paragraph when it is the only text in the file", () => {
    const content =
      "When you adopt a release that contains [issue #44](https://example), bump the SHAs.";
    expect(removeIssue44Paragraph(content)).toBe("");
  });
});

describe("rewriteShaTagNote", () => {
  it("updates the inline 'SHA corresponds to tag vX.Y.Z' note", () => {
    const content = "        # SHA corresponds to tag v2.0.0 — update when adopting a new release.";
    expect(rewriteShaTagNote(content, "2.1.0")).toBe(
      "        # SHA corresponds to tag v2.1.0 — update when adopting a new release.",
    );
  });

  it("leaves unrelated comments untouched", () => {
    const content = "        # explicit for auditors; matches the action default";
    expect(rewriteShaTagNote(content, "2.1.0")).toBe(content);
  });
});

describe("refreshReadme", () => {
  it("applies SHA refresh, uncomments fail-on-missing-chunks, and strips the issue-44 paragraph in one pass", () => {
    const content = [
      "# Project",
      "",
      `      uses: milanhorvatovic/codex-ai-code-review-action/publish@${OLD_SHA} # v2.0.0`,
      `        with:`,
      `          retain-findings: false # explicit`,
      `          # fail-on-missing-chunks: "true" # available in the next tagged release; uncomment after bumping the SHAs above`,
      "```",
      "",
      "When you adopt a release that contains [issue #44](https://example), bump the SHAs.",
      "",
      "## Architecture",
      "",
    ].join("\n");
    const result = refreshReadme(content, "2.1.0", NEW_SHA);
    expect(result).toContain(`@${NEW_SHA} # v2.1.0`);
    expect(result).toContain(`fail-on-missing-chunks: "true"`);
    expect(result).not.toContain("available in the next tagged release");
    expect(result).not.toContain("issue #44");
    expect(result).toContain("## Architecture");
  });
});

describe("runCli", () => {
  type Stub = {
    files: Record<string, string>;
    writes: Array<{ path: string; content: string }>;
    stdout: string[];
    stderr: string[];
  };

  function makeDeps(stub: Stub, argv: string[]) {
    return {
      argv,
      readSource: (path: string) => {
        const content = stub.files[path];
        if (content === undefined) throw new Error(`no fixture for ${path}`);
        return content;
      },
      writeSource: (path: string, content: string) => {
        stub.writes.push({ path, content });
      },
      stdoutWrite: (chunk: string) => {
        stub.stdout.push(chunk);
      },
      stderrWrite: (chunk: string) => {
        stub.stderr.push(chunk);
      },
    };
  }

  it("returns 0 and writes README.md on success", () => {
    const stub: Stub = {
      files: {
        "README.md": `      uses: milanhorvatovic/codex-ai-code-review-action@${OLD_SHA} # v2.0.0`,
      },
      writes: [],
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["2.1.0", NEW_SHA]))).toBe(0);
    expect(stub.writes).toHaveLength(1);
    expect(stub.writes[0]?.content).toContain(`@${NEW_SHA} # v2.1.0`);
  });

  it("returns 0 without writing when no edits are required", () => {
    const stub: Stub = {
      files: {
        "README.md": `      uses: milanhorvatovic/codex-ai-code-review-action@${NEW_SHA} # v2.1.0`,
      },
      writes: [],
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["2.1.0", NEW_SHA]))).toBe(0);
    expect(stub.writes).toHaveLength(0);
    expect(stub.stdout.join("")).toContain("already up to date");
  });

  it("returns 1 and prints usage when arguments are missing", () => {
    const stub: Stub = { files: {}, writes: [], stdout: [], stderr: [] };
    expect(runCli(makeDeps(stub, ["2.1.0"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("Usage:");
  });

  it("returns 1 on an invalid SHA", () => {
    const stub: Stub = {
      files: { "README.md": "no pins here" },
      writes: [],
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["2.1.0", "abcd"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("40-character hex");
  });
});
