import { describe, expect, it } from "vitest";

import {
  extractSectionContent,
  findSection,
  parseVersion,
  runCli,
} from "./extract-changelog-section.js";

const sampleChangelog = [
  "# Changelog",
  "",
  "All notable changes.",
  "",
  "## [2.1.0-rc.1] - 2026-05-01",
  "",
  "### Added",
  "",
  "- Pre-release feature",
  "",
  "## [2.0.0] - 2026-04-07",
  "",
  "### Changed",
  "",
  "- Breaking change",
  "- Another change",
  "",
  "### Removed",
  "",
  "- Old thing",
  "",
  "## [1.0.0] - 2026-04-06",
  "",
  "### Added",
  "",
  "- Initial release",
  "",
].join("\n");

describe("parseVersion", () => {
  it.each([
    "1.0.0",
    "2.0.0",
    "10.20.30",
    "0.0.0",
    "2.1.0-rc.1",
    "2.1.0-alpha",
    "2.1.0-beta.2",
    "2.1.0-0.3.7",
    "2.1.0-rc-1",
  ])("accepts %s", (input) => {
    expect(parseVersion(input)).toBe(input);
  });

  it("rejects the literal Unreleased", () => {
    expect(() => parseVersion("Unreleased")).toThrow(/Refusing to extract/);
  });

  it("rejects a leading v", () => {
    expect(() => parseVersion("v1.0.0")).toThrow(/Strip the leading 'v'/);
  });

  it("rejects build metadata", () => {
    expect(() => parseVersion("1.0.0+build.5")).toThrow(
      /Build metadata not supported/,
    );
  });

  it("rejects build metadata combined with pre-release", () => {
    expect(() => parseVersion("1.0.0-rc.1+build.5")).toThrow(
      /Build metadata not supported/,
    );
  });

  it("rejects a leading zero in a numeric pre-release identifier", () => {
    expect(() => parseVersion("1.0.0-rc.01")).toThrow(
      /Numeric pre-release identifiers may not have leading zeros/,
    );
  });

  it.each(["01.0.0", "1.02.0", "1.0.03"])(
    "rejects a leading zero in the base version (%s)",
    (input) => {
      expect(() => parseVersion(input)).toThrow(/Invalid version/);
    },
  );

  it.each(["1.0", "1.0.0.0", "1.a.0", "", "1.0.0-", "1.0.0-rc..1", "1.0.0-rc!"])(
    "rejects malformed input (%s)",
    (input) => {
      expect(() => parseVersion(input)).toThrow(/Invalid version/);
    },
  );
});

describe("findSection", () => {
  it("finds a section between two others", () => {
    const result = findSection(sampleChangelog, "2.0.0");
    expect(result.startLine).toBe(10);
    expect(result.endLine).toBe(21);
  });

  it("finds the first section in the file", () => {
    const result = findSection(sampleChangelog, "2.1.0-rc.1");
    expect(result.startLine).toBe(4);
    expect(result.endLine).toBe(10);
  });

  it("finds the last section, ending at EOF", () => {
    const result = findSection(sampleChangelog, "1.0.0");
    expect(result.startLine).toBe(21);
    expect(result.endLine).toBe(sampleChangelog.split("\n").length);
  });

  it("matches a heading without a date suffix", () => {
    const changelog = ["## [3.0.0]", "", "- entry", ""].join("\n");
    const result = findSection(changelog, "3.0.0");
    expect(result.startLine).toBe(0);
  });

  it("does not match a longer version prefix", () => {
    const changelog = ["## [2.0.0-rc.1] - 2026-04-01", "", "- rc entry", ""].join(
      "\n",
    );
    expect(() => findSection(changelog, "2.0.0")).toThrow(
      /Section ## \[2\.0\.0\] not found/,
    );
  });

  it("throws on missing section", () => {
    expect(() => findSection(sampleChangelog, "9.9.9")).toThrow(
      /Section ## \[9\.9\.9\] not found in CHANGELOG\.md/,
    );
  });

  it("throws on duplicate sections, listing line numbers", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [1.0.0] - 2026-01-01",
      "",
      "- one",
      "",
      "## [1.0.0] - 2026-02-01",
      "",
      "- two",
      "",
    ].join("\n");
    expect(() => findSection(changelog, "1.0.0")).toThrow(
      /Multiple ## \[1\.0\.0\] headings at lines 3, 7/,
    );
  });
});

describe("extractSectionContent", () => {
  it("returns the section body with leading and trailing blanks trimmed", () => {
    const content = extractSectionContent(sampleChangelog, "2.0.0");
    expect(content).toBe(
      ["### Changed", "", "- Breaking change", "- Another change", "", "### Removed", "", "- Old thing"].join(
        "\n",
      ),
    );
  });

  it("preserves internal blank lines between subsections", () => {
    const content = extractSectionContent(sampleChangelog, "2.0.0");
    expect(content).toContain("\n\n### Removed\n");
  });

  it("extracts the last section without a trailing heading", () => {
    const content = extractSectionContent(sampleChangelog, "1.0.0");
    expect(content).toBe(["### Added", "", "- Initial release"].join("\n"));
  });

  it("throws on an empty section", () => {
    const changelog = [
      "## [1.0.0] - 2026-01-01",
      "",
      "",
      "## [0.9.0] - 2025-12-01",
      "",
      "- prior",
      "",
    ].join("\n");
    expect(() => extractSectionContent(changelog, "1.0.0")).toThrow(
      /Section ## \[1\.0\.0\] is empty/,
    );
  });
});

describe("runCli", () => {
  type Stub = {
    files: Record<string, string>;
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
      stdoutWrite: (chunk: string) => {
        stub.stdout.push(chunk);
      },
      stderrWrite: (chunk: string) => {
        stub.stderr.push(chunk);
      },
    };
  }

  it("returns 0 and prints the section content on success", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["2.0.0"]))).toBe(0);
    expect(stub.stderr).toEqual([]);
    const out = stub.stdout.join("");
    expect(out.startsWith("### Changed\n")).toBe(true);
    expect(out.endsWith("- Old thing\n")).toBe(true);
  });

  it("returns 1 and prints usage when no version is passed", () => {
    const stub: Stub = { files: {}, stdout: [], stderr: [] };
    expect(runCli(makeDeps(stub, []))).toBe(1);
    expect(stub.stderr.join("")).toContain("Usage: extract-changelog-section");
  });

  it("returns 1 and prints usage when more than one argument is passed", () => {
    const stub: Stub = { files: {}, stdout: [], stderr: [] };
    expect(runCli(makeDeps(stub, ["1.0.0", "extra"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("Usage: extract-changelog-section");
  });

  it("returns 1 with the not-found error for an unknown version", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["9.9.9"]))).toBe(1);
    expect(stub.stderr.join("")).toBe(
      "Section ## [9.9.9] not found in CHANGELOG.md\n",
    );
  });

  it("returns 1 with the refusing-to-extract error on Unreleased", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["Unreleased"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("Refusing to extract");
  });

  it("returns 1 with the v-prefix error on a v-prefixed input", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["v2.0.0"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("Strip the leading 'v'");
  });

  it("returns 1 with the build-metadata error", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["1.0.0+build.5"]))).toBe(1);
    expect(stub.stderr.join("")).toContain("Build metadata not supported");
  });

  it("returns 1 with the leading-zero error", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["1.0.0-rc.01"]))).toBe(1);
    expect(stub.stderr.join("")).toContain(
      "Numeric pre-release identifiers may not have leading zeros",
    );
  });

  it("accepts pre-release input but reports not-found when no matching section exists", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["1.0.0-rc.1"]))).toBe(1);
    expect(stub.stderr.join("")).toBe(
      "Section ## [1.0.0-rc.1] not found in CHANGELOG.md\n",
    );
  });

  it("extracts a real pre-release section when present", () => {
    const stub: Stub = {
      files: { "CHANGELOG.md": sampleChangelog },
      stdout: [],
      stderr: [],
    };
    expect(runCli(makeDeps(stub, ["2.1.0-rc.1"]))).toBe(0);
    expect(stub.stdout.join("")).toBe(
      ["### Added", "", "- Pre-release feature", ""].join("\n"),
    );
  });
});
