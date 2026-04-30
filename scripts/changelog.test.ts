import { describe, expect, it } from "vitest";

import {
  bumpVersion,
  findAllSections,
  insertSection,
  isPrereleaseVersion,
  isRcOf,
  parseSemver,
  removeSections,
} from "./changelog.js";

describe("parseSemver", () => {
  it("parses a base version", () => {
    expect(parseSemver("2.1.0")).toEqual({
      major: 2,
      minor: 1,
      patch: 0,
      prerelease: [],
    });
  });

  it("parses a pre-release version", () => {
    expect(parseSemver("2.1.0-rc.1")).toEqual({
      major: 2,
      minor: 1,
      patch: 0,
      prerelease: ["rc", "1"],
    });
  });

  it("rejects malformed input via parseVersion", () => {
    expect(() => parseSemver("v2.1.0")).toThrow(/Strip the leading 'v'/);
  });
});

describe("isPrereleaseVersion", () => {
  it("returns true for a pre-release", () => {
    expect(isPrereleaseVersion("2.1.0-rc.1")).toBe(true);
  });

  it("returns false for a base version", () => {
    expect(isPrereleaseVersion("2.1.0")).toBe(false);
  });
});

describe("bumpVersion", () => {
  it("bumps major and resets minor and patch", () => {
    expect(bumpVersion("2.1.3", "major")).toBe("3.0.0");
  });

  it("bumps minor and resets patch", () => {
    expect(bumpVersion("2.1.3", "minor")).toBe("2.2.0");
  });

  it("bumps patch", () => {
    expect(bumpVersion("2.1.3", "patch")).toBe("2.1.4");
  });

  it("ignores any pre-release identifier on the input", () => {
    expect(bumpVersion("2.1.0-rc.1", "minor")).toBe("2.2.0");
  });
});

describe("findAllSections", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [2.1.0] - 2026-05-01",
    "",
    "- new",
    "",
    "## [2.0.0] - 2026-04-07",
    "",
    "- old",
    "",
  ].join("\n");

  it("returns one entry per section heading with span boundaries", () => {
    expect(findAllSections(changelog)).toEqual([
      { version: "2.1.0", startIndex: 2, endIndex: 6 },
      { version: "2.0.0", startIndex: 6, endIndex: 10 },
    ]);
  });

  it("returns an empty array when no sections exist", () => {
    expect(findAllSections("# Changelog\n\nNo entries yet.\n")).toEqual([]);
  });
});

describe("removeSections", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [2.1.0-rc.1] - 2026-05-01",
    "",
    "- rc1",
    "",
    "## [2.0.0] - 2026-04-07",
    "",
    "- final",
    "",
  ].join("\n");

  it("removes sections matching the predicate", () => {
    const result = removeSections(changelog, (v) => v.includes("-"));
    expect(result).not.toContain("[2.1.0-rc.1]");
    expect(result).toContain("[2.0.0]");
    expect(result).toContain("- final");
  });

  it("returns the input unchanged when no section matches", () => {
    const result = removeSections(changelog, () => false);
    expect(result).toBe(changelog);
  });
});

describe("insertSection", () => {
  const intro = ["# Changelog", "", "All notable changes.", ""].join("\n");

  it("inserts before the first existing section", () => {
    const changelog = [intro, "## [2.0.0] - 2026-04-07", "", "- old", ""].join("\n");
    const block = ["## [2.1.0] - 2026-05-01", "", "### Added", "", "- new"].join("\n");
    const result = insertSection(changelog, block);
    expect(result).toContain("## [2.1.0] - 2026-05-01");
    const idxNew = result.indexOf("## [2.1.0]");
    const idxOld = result.indexOf("## [2.0.0]");
    expect(idxNew).toBeLessThan(idxOld);
  });

  it("appends to the intro when no sections exist", () => {
    const block = ["## [1.0.0] - 2026-04-01", "", "- first"].join("\n");
    const result = insertSection(intro, block);
    expect(result.startsWith("# Changelog")).toBe(true);
    expect(result).toContain("## [1.0.0]");
  });

  it("preserves a single blank-line separator between block and following section", () => {
    const changelog = [intro, "## [2.0.0] - 2026-04-07", "", "- old", ""].join("\n");
    const block = ["## [2.1.0] - 2026-05-01", "", "- new"].join("\n");
    const result = insertSection(changelog, block);
    expect(result).toContain("- new\n\n## [2.0.0]");
  });
});

describe("isRcOf", () => {
  it("returns true when the rc base matches the final version", () => {
    expect(isRcOf("2.1.0-rc.1", "2.1.0")).toBe(true);
    expect(isRcOf("2.1.0-rc.2", "2.1.0")).toBe(true);
  });

  it("returns false when the base differs", () => {
    expect(isRcOf("2.1.0-rc.1", "2.2.0")).toBe(false);
    expect(isRcOf("2.0.0-rc.1", "2.1.0")).toBe(false);
  });

  it("returns false when the rc argument is not a pre-release", () => {
    expect(isRcOf("2.1.0", "2.1.0")).toBe(false);
  });

  it("returns false when the final argument is itself a pre-release", () => {
    expect(isRcOf("2.1.0-rc.1", "2.1.0-rc.2")).toBe(false);
  });
});
