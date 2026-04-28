import { describe, expect, it } from "vitest";

import {
  buildCanonicalMap,
  findDocDrift,
  formatDrift,
  PIN_PATTERN,
  runCli,
  SELF_REPO,
  type DocMismatch,
} from "./verify-doc-pins.js";

const yamlFixture = {
  path: "review/action.yaml",
  content: [
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2",
    "    - uses: ./prepare",
    "    - uses: openai/codex-action@c300d2798ce5b59a7667c806b5e3a3d2c397ed2f # v1.7",
    "    - uses: github/codeql-action/init@7fc6561ed893d15cec696e062df840b21db27eb0 # v4.35.2",
    "    - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "",
  ].join("\n"),
};

describe("PIN_PATTERN", () => {
  it("captures owner, repo, optional subpath, sha, and optional tag", () => {
    PIN_PATTERN.lastIndex = 0;
    const match = PIN_PATTERN.exec(
      "uses: github/codeql-action/init@7fc6561ed893d15cec696e062df840b21db27eb0 # v4.35.2",
    );
    PIN_PATTERN.lastIndex = 0;
    expect(match?.groups).toMatchObject({
      owner: "github",
      repo: "codeql-action",
      sub: "init",
      sha: "7fc6561ed893d15cec696e062df840b21db27eb0",
      tag: "v4.35.2",
    });
  });
});

describe("buildCanonicalMap", () => {
  it("extracts external uses, skips local refs, and captures missing tag as undefined", () => {
    const { map, disagreements } = buildCanonicalMap([yamlFixture]);
    expect(disagreements).toEqual([]);
    expect(map.get("actions/checkout")).toMatchObject({
      sha: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      tag: "v6.0.2",
    });
    expect(map.get("openai/codex-action")).toMatchObject({
      sha: "c300d2798ce5b59a7667c806b5e3a3d2c397ed2f",
      tag: "v1.7",
    });
    expect(map.get("github/codeql-action")).toMatchObject({
      sha: "7fc6561ed893d15cec696e062df840b21db27eb0",
      tag: "v4.35.2",
    });
    expect(map.get("actions/upload-artifact")).toMatchObject({
      sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      tag: undefined,
    });
  });

  it("ignores self-references", () => {
    const yaml = {
      path: "wrapper/action.yaml",
      content: `    - uses: ${SELF_REPO}/prepare@af72a5bd7330432cee97137b04d04edebde80149 # v2.0.0\n`,
    };
    const { map } = buildCanonicalMap([yaml]);
    expect(map.has(SELF_REPO)).toBe(false);
  });

  it("flags YAML disagreement when two files pin the same action to different SHAs", () => {
    const yamlA = {
      path: "a.yaml",
      content:
        "    - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1.0.0\n",
    };
    const yamlB = {
      path: "b.yaml",
      content:
        "    - uses: actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v2.0.0\n",
    };
    const { disagreements } = buildCanonicalMap([yamlA, yamlB]);
    expect(disagreements).toHaveLength(1);
    const disagreement = disagreements[0];
    expect(disagreement?.key).toBe("actions/checkout");
    expect(disagreement?.occurrences).toHaveLength(2);
    expect(disagreement?.occurrences.map((o) => o.path)).toEqual(["a.yaml", "b.yaml"]);
  });
});

describe("findDocDrift", () => {
  const canonical = buildCanonicalMap([yamlFixture]).map;

  it("returns no drift when SHA and tag match", () => {
    const md = {
      path: "README.md",
      content: "Use `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2` here.\n",
    };
    expect(findDocDrift(canonical, [md])).toEqual([]);
  });

  it("flags mismatched SHA", () => {
    const md = {
      path: "README.md",
      content: "stale: actions/checkout@1111111111111111111111111111111111111111 # v6.0.2\n",
    };
    const drifts = findDocDrift(canonical, [md]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject<Partial<DocMismatch>>({
      file: "README.md",
      key: "actions/checkout",
      foundSha: "1111111111111111111111111111111111111111",
      expectedSha: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    });
  });

  it("flags mismatched tag even when SHA matches", () => {
    const md = {
      path: "README.md",
      content:
        "drifted tag: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v5.0.0\n",
    };
    const drifts = findDocDrift(canonical, [md]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.foundTag).toBe("v5.0.0");
    expect(drifts[0]?.expectedTag).toBe("v6.0.2");
  });

  it("ignores self-references", () => {
    const md = {
      path: "README.md",
      content: `${SELF_REPO}/prepare@af72a5bd7330432cee97137b04d04edebde80149 # v2.0.0\n`,
    };
    expect(findDocDrift(canonical, [md])).toEqual([]);
  });

  it("ignores actions absent from the canonical map", () => {
    const md = {
      path: "README.md",
      content: "third-party: foo/bar@2222222222222222222222222222222222222222 # v1\n",
    };
    expect(findDocDrift(canonical, [md])).toEqual([]);
  });

  it("respects the allowlist marker on the previous non-blank line", () => {
    const md = {
      path: "CHANGELOG.md",
      content: [
        "Historic note:",
        "<!-- pin-check: ignore -->",
        "",
        "actions/checkout@1111111111111111111111111111111111111111 # v5.0.0",
        "",
      ].join("\n"),
    };
    expect(findDocDrift(canonical, [md])).toEqual([]);
  });

  it("matches subpath references against the owner/repo canonical key", () => {
    const md = {
      path: "README.md",
      content:
        "github/codeql-action/init@7fc6561ed893d15cec696e062df840b21db27eb0 # v4.35.2\n",
    };
    expect(findDocDrift(canonical, [md])).toEqual([]);
  });

  it("flags subpath references when the SHA drifts", () => {
    const md = {
      path: "README.md",
      content:
        "github/codeql-action/analyze@1111111111111111111111111111111111111111 # v4.35.2\n",
    };
    const drifts = findDocDrift(canonical, [md]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.key).toBe("github/codeql-action");
  });
});

describe("formatDrift", () => {
  it("formats doc-mismatch with truncated SHAs and canonical pointer", () => {
    const drift: DocMismatch = {
      kind: "doc-mismatch",
      file: "README.md",
      line: 401,
      key: "openai/codex-action",
      foundSha: "086169432f1d2ab2f4057540b1754d550f6a1189",
      foundTag: "v1.4",
      expectedSha: "c300d2798ce5b59a7667c806b5e3a3d2c397ed2f",
      expectedTag: "v1.7",
      canonicalLocation: { path: "review/action.yaml", line: 35 },
    };
    expect(formatDrift(drift)).toBe(
      "README.md:401: openai/codex-action — found @086169... # v1.4, expected @c300d2... # v1.7 (canonical: review/action.yaml:35)",
    );
  });

  it("formats yaml-disagreement with all occurrences", () => {
    const formatted = formatDrift({
      kind: "yaml-disagreement",
      key: "actions/checkout",
      occurrences: [
        { path: "a.yaml", line: 1, sha: "a".repeat(40), tag: "v1.0.0" },
        { path: "b.yaml", line: 2, sha: "b".repeat(40), tag: "v2.0.0" },
      ],
    });
    expect(formatted).toContain("canonical-pin disagreement for actions/checkout");
    expect(formatted).toContain("a.yaml:1: @aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1.0.0");
    expect(formatted).toContain("b.yaml:2: @bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v2.0.0");
  });
});

describe("runCli", () => {
  type Stub = {
    files: Record<string, string>;
    calls: string[][];
    stderr: string[];
  };

  function makeDeps(stub: Stub) {
    return {
      gitLsFiles: (...patterns: string[]) => {
        stub.calls.push(patterns);
        const ext = patterns[0]?.replace(/^\*\./, "") ?? "";
        return Object.keys(stub.files).filter((p) => p.endsWith(`.${ext}`));
      },
      readSource: (path: string) => {
        const content = stub.files[path];
        if (content === undefined) throw new Error(`no fixture for ${path}`);
        return content;
      },
      stderrWrite: (chunk: string) => {
        stub.stderr.push(chunk);
      },
    };
  }

  const cleanYaml =
    "    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2\n";

  it("queries git ls-files for *.yaml and *.md in that order", () => {
    const stub: Stub = { files: {}, calls: [], stderr: [] };
    runCli(makeDeps(stub));
    expect(stub.calls).toEqual([["*.yaml"], ["*.md"]]);
  });

  it("returns 0 when YAML and Markdown are consistent", () => {
    const stub: Stub = {
      files: {
        "review/action.yaml": cleanYaml,
        "README.md":
          "Use `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`.\n",
      },
      calls: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub))).toBe(0);
    expect(stub.stderr).toEqual([]);
  });

  it("returns 1 and prints drift when Markdown disagrees with YAML", () => {
    const stub: Stub = {
      files: {
        "review/action.yaml": cleanYaml,
        "README.md":
          "actions/checkout@1111111111111111111111111111111111111111 # v6.0.2\n",
      },
      calls: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub))).toBe(1);
    expect(stub.stderr.join("")).toContain("README.md:1: actions/checkout");
  });

  it("returns 1 and prints disagreement when two YAML files conflict", () => {
    const stub: Stub = {
      files: {
        "a.yaml":
          "    - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1.0.0\n",
        "b.yaml":
          "    - uses: actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v2.0.0\n",
      },
      calls: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub))).toBe(1);
    expect(stub.stderr.join("")).toContain(
      "canonical-pin disagreement for actions/checkout",
    );
  });

  it("reports YAML disagreement and skips doc check when both fail", () => {
    const stub: Stub = {
      files: {
        "a.yaml":
          "    - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1.0.0\n",
        "b.yaml":
          "    - uses: actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v2.0.0\n",
        "README.md":
          "actions/checkout@cccccccccccccccccccccccccccccccccccccccc # v3.0.0\n",
      },
      calls: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub))).toBe(1);
    const errOutput = stub.stderr.join("");
    expect(errOutput).toContain("canonical-pin disagreement for actions/checkout");
    expect(errOutput).not.toContain("README.md:");
  });
});
