import { describe, expect, it } from "vitest";

import {
  applyChangelogUpdate,
  bumpPackageJsonVersion,
  bumpPackageLockVersion,
  buildPrBody,
  categorizePullRequest,
  computeVersionBump,
  consolidateRcSections,
  existingBodyHasMaintainerSignoff,
  extractTrustBoundaryImpact,
  formatPullRequestEntry,
  parseTargetVersion,
  releaseLevelOf,
  renderChangelogEntry,
  resolveTargetVersion,
  runCli,
  selectLastNonPrereleaseTag,
  tagCommitTimestamp,
  type PullRequest,
} from "./prepare-release.js";

function makePr(overrides: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    number: overrides.number,
    title: overrides.title ?? `PR ${overrides.number}`,
    body: overrides.body ?? "",
    labels: overrides.labels ?? [{ name: "release: patch" }],
    url: overrides.url ?? `https://github.com/o/r/pull/${overrides.number}`,
  };
}

describe("parseTargetVersion", () => {
  it("accepts a base version", () => {
    expect(parseTargetVersion("2.1.0")).toBe("2.1.0");
  });

  it("accepts a pre-release", () => {
    expect(parseTargetVersion("2.1.0-rc.1")).toBe("2.1.0-rc.1");
  });

  it("rejects a leading v", () => {
    expect(() => parseTargetVersion("v2.1.0")).toThrow(/Strip the leading 'v'/);
  });
});

describe("releaseLevelOf", () => {
  it("returns the level when exactly one is present", () => {
    expect(releaseLevelOf(makePr({ number: 1, labels: [{ name: "release: minor" }] }))).toBe(
      "minor",
    );
  });

  it("throws when no release-level label is present", () => {
    expect(() =>
      releaseLevelOf(makePr({ number: 7, labels: [{ name: "enhancement" }] })),
    ).toThrow(/missing a release-level label/);
  });

  it("throws when multiple release-level labels are present", () => {
    expect(() =>
      releaseLevelOf(
        makePr({
          number: 7,
          labels: [{ name: "release: patch" }, { name: "release: minor" }],
        }),
      ),
    ).toThrow(/multiple release-level labels/);
  });
});

describe("computeVersionBump", () => {
  it("returns 'none' when every PR is skip", () => {
    const prs = [
      makePr({ number: 1, labels: [{ name: "release: skip" }] }),
      makePr({ number: 2, labels: [{ name: "release: skip" }] }),
    ];
    expect(computeVersionBump(prs)).toBe("none");
  });

  it("returns the highest bump", () => {
    const prs = [
      makePr({ number: 1, labels: [{ name: "release: patch" }] }),
      makePr({ number: 2, labels: [{ name: "release: minor" }] }),
      makePr({ number: 3, labels: [{ name: "release: patch" }] }),
    ];
    expect(computeVersionBump(prs)).toBe("minor");
  });

  it("recognizes major as the top of the order", () => {
    const prs = [
      makePr({ number: 1, labels: [{ name: "release: minor" }] }),
      makePr({ number: 2, labels: [{ name: "release: major" }] }),
    ];
    expect(computeVersionBump(prs)).toBe("major");
  });
});

describe("categorizePullRequest", () => {
  it("maps known category labels to sections", () => {
    expect(
      categorizePullRequest(
        makePr({ number: 1, labels: [{ name: "release: patch" }, { name: "bug" }] }),
      ),
    ).toEqual(["Fixed"]);
  });

  it("falls back to Changed when no category label matches", () => {
    expect(
      categorizePullRequest(
        makePr({ number: 1, labels: [{ name: "release: patch" }] }),
      ),
    ).toEqual(["Changed"]);
  });

  it("adds the trust-boundary section additively", () => {
    const sections = categorizePullRequest(
      makePr({
        number: 1,
        labels: [
          { name: "release: minor" },
          { name: "enhancement" },
          { name: "trust-boundary" },
        ],
      }),
    );
    expect(sections).toContain("Added");
    expect(sections).toContain("⚠️ Trust boundary change");
  });
});

describe("formatPullRequestEntry", () => {
  it("formats the entry with title, number, and url", () => {
    expect(
      formatPullRequestEntry(
        makePr({ number: 42, title: "Fix the thing", url: "https://example/pull/42" }),
      ),
    ).toBe("- Fix the thing ([#42](https://example/pull/42))");
  });
});

describe("extractTrustBoundaryImpact", () => {
  it("extracts a paragraph and strips comments", () => {
    const body = [
      "## Summary",
      "stuff",
      "",
      "## Trust boundary impact",
      "<!-- helper -->",
      "Adds outbound HTTP to api.example.com.",
      "",
      "## Test plan",
      "- run tests",
    ].join("\n");
    expect(extractTrustBoundaryImpact(body)).toBe(
      "Adds outbound HTTP to api.example.com.",
    );
  });

  it("collapses multi-line paragraphs to a single line", () => {
    const body = [
      "## Trust boundary impact",
      "Adds outbound HTTP",
      "to api.example.com.",
    ].join("\n");
    expect(extractTrustBoundaryImpact(body)).toBe(
      "Adds outbound HTTP to api.example.com.",
    );
  });

  it("throws when the heading is missing", () => {
    expect(() => extractTrustBoundaryImpact("## Summary\nfoo")).toThrow(
      /Missing '## Trust boundary impact' heading/,
    );
  });

  it("throws when the body is the template default 'None.'", () => {
    expect(() =>
      extractTrustBoundaryImpact("## Trust boundary impact\nNone.\n"),
    ).toThrow(/template default 'None\.'/);
  });

  it("throws when only HTML comments remain", () => {
    expect(() =>
      extractTrustBoundaryImpact("## Trust boundary impact\n<!-- placeholder -->\n"),
    ).toThrow(/empty after stripping HTML comments/);
  });
});

describe("renderChangelogEntry", () => {
  it("groups PRs by section in the locked order and sorts within sections", () => {
    const prs = [
      makePr({
        number: 5,
        title: "B feature",
        labels: [{ name: "release: minor" }, { name: "enhancement" }],
      }),
      makePr({
        number: 6,
        title: "A feature",
        labels: [{ name: "release: minor" }, { name: "enhancement" }],
      }),
      makePr({
        number: 7,
        title: "Fix bug",
        labels: [{ name: "release: patch" }, { name: "bug" }],
      }),
      makePr({
        number: 8,
        title: "Skipped",
        labels: [{ name: "release: skip" }],
      }),
      makePr({
        number: 9,
        title: "Plain change",
        labels: [{ name: "release: patch" }],
      }),
    ];
    const result = renderChangelogEntry(prs, "2.1.0", "2026-05-01");
    expect(result.startsWith("## [2.1.0] - 2026-05-01\n")).toBe(true);
    const idxAdded = result.indexOf("### Added");
    const idxChanged = result.indexOf("### Changed");
    const idxFixed = result.indexOf("### Fixed");
    expect(idxAdded).toBeGreaterThan(0);
    expect(idxAdded).toBeLessThan(idxChanged);
    expect(idxChanged).toBeLessThan(idxFixed);
    expect(result).not.toContain("Skipped");
    const addedBlock = result.slice(idxAdded, idxChanged);
    expect(addedBlock.indexOf("- A feature")).toBeLessThan(
      addedBlock.indexOf("- B feature"),
    );
  });

  it("renders trust-boundary impact paragraphs", () => {
    const prs = [
      makePr({
        number: 10,
        title: "Touch perms",
        labels: [
          { name: "release: minor" },
          { name: "enhancement" },
          { name: "trust-boundary" },
        ],
        body: "## Trust boundary impact\nAdds new permission scope.",
      }),
    ];
    const result = renderChangelogEntry(prs, "2.1.0", "2026-05-01");
    expect(result).toContain("### ⚠️ Trust boundary change");
    expect(result).toContain("Adds new permission scope");
  });

  it("emits a placeholder when nothing notable changed", () => {
    const empty = renderChangelogEntry([], "2.1.0", "2026-05-01");
    expect(empty).toContain("_No notable changes._");
  });
});

describe("consolidateRcSections", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [2.1.0-rc.2] - 2026-05-15",
    "",
    "- rc2 entry",
    "",
    "## [2.1.0-rc.1] - 2026-05-01",
    "",
    "- rc1 entry",
    "",
    "## [2.0.0] - 2026-04-07",
    "",
    "- prior entry",
    "",
  ].join("\n");

  it("removes RC sections that match the final version", () => {
    const result = consolidateRcSections(changelog, "2.1.0");
    expect(result).not.toContain("[2.1.0-rc.1]");
    expect(result).not.toContain("[2.1.0-rc.2]");
    expect(result).toContain("[2.0.0]");
  });

  it("preserves RC sections of unrelated versions", () => {
    const result = consolidateRcSections(changelog, "2.2.0");
    expect(result).toContain("[2.1.0-rc.1]");
    expect(result).toContain("[2.1.0-rc.2]");
  });
});

describe("applyChangelogUpdate", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [2.0.0] - 2026-04-07",
    "",
    "### Changed",
    "",
    "- prior",
    "",
  ].join("\n");

  it("inserts a new section above existing entries for a base release", () => {
    const prs = [
      makePr({
        number: 1,
        title: "feature",
        labels: [{ name: "release: minor" }, { name: "enhancement" }],
      }),
    ];
    const result = applyChangelogUpdate(changelog, "2.1.0", "2026-05-01", prs);
    const idxNew = result.indexOf("## [2.1.0]");
    const idxOld = result.indexOf("## [2.0.0]");
    expect(idxNew).toBeLessThan(idxOld);
  });

  it("does not consolidate RCs for a pre-release cut", () => {
    const withRc = applyChangelogUpdate(
      changelog,
      "2.1.0-rc.1",
      "2026-05-01",
      [
        makePr({
          number: 1,
          title: "rc feature",
          labels: [{ name: "release: minor" }, { name: "enhancement" }],
        }),
      ],
    );
    expect(withRc).toContain("[2.1.0-rc.1]");
    expect(withRc).toContain("[2.0.0]");
    const final = applyChangelogUpdate(
      withRc,
      "2.1.0",
      "2026-05-15",
      [
        makePr({
          number: 1,
          title: "rc feature",
          labels: [{ name: "release: minor" }, { name: "enhancement" }],
        }),
      ],
    );
    expect(final).toContain("[2.1.0]");
    expect(final).not.toContain("[2.1.0-rc.1]");
  });
});

describe("bumpPackageJsonVersion", () => {
  it("rewrites the version field and preserves trailing newline", () => {
    const content = `${JSON.stringify({ name: "x", version: "1.0.0" }, null, 2)}\n`;
    const result = bumpPackageJsonVersion(content, "1.1.0");
    expect(result.endsWith("\n")).toBe(true);
    expect(JSON.parse(result).version).toBe("1.1.0");
  });

  it("rejects an invalid target version", () => {
    expect(() =>
      bumpPackageJsonVersion(`${JSON.stringify({ version: "1.0.0" })}`, "v1.1.0"),
    ).toThrow(/Strip the leading 'v'/);
  });
});

describe("bumpPackageLockVersion", () => {
  function makeLock(overrides?: {
    version?: string | undefined;
    rootPackageVersion?: string | undefined;
    omitTopVersion?: boolean;
    omitRootPackage?: boolean;
    omitRootPackageVersion?: boolean;
    extraPackages?: Record<string, unknown>;
  }): string {
    const opts = overrides ?? {};
    const rootPackage: Record<string, unknown> = {
      name: "x",
      license: "MIT",
    };
    if (!opts.omitRootPackageVersion) {
      rootPackage.version = opts.rootPackageVersion ?? "1.0.0";
    }
    const packages: Record<string, unknown> = {};
    if (!opts.omitRootPackage) {
      packages[""] = rootPackage;
    }
    if (opts.extraPackages) {
      Object.assign(packages, opts.extraPackages);
    }
    const top: Record<string, unknown> = {
      name: "x",
      lockfileVersion: 3,
      requires: true,
      packages,
    };
    if (!opts.omitTopVersion) {
      top.version = opts.version ?? "1.0.0";
      const ordered: Record<string, unknown> = {
        name: top.name,
        version: top.version,
        lockfileVersion: top.lockfileVersion,
        requires: top.requires,
        packages: top.packages,
      };
      return `${JSON.stringify(ordered, null, 2)}\n`;
    }
    return `${JSON.stringify(top, null, 2)}\n`;
  }

  it("rewrites the top-level version and packages[''].version", () => {
    const result = bumpPackageLockVersion(makeLock(), "1.1.0");
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe("1.1.0");
    expect(parsed.packages[""].version).toBe("1.1.0");
  });

  it("preserves a trailing newline when the input has one", () => {
    const result = bumpPackageLockVersion(makeLock(), "1.1.0");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("preserves no-trailing-newline when the input has none", () => {
    const content = makeLock().replace(/\n$/, "");
    const result = bumpPackageLockVersion(content, "1.1.0");
    expect(result.endsWith("\n")).toBe(false);
  });

  it("leaves extra packages entries (e.g. node_modules/foo) untouched", () => {
    const content = makeLock({
      extraPackages: {
        "node_modules/foo": { version: "9.9.9" },
        "node_modules/bar": { version: "0.0.1" },
      },
    });
    const result = bumpPackageLockVersion(content, "1.1.0");
    const parsed = JSON.parse(result);
    expect(parsed.packages["node_modules/foo"].version).toBe("9.9.9");
    expect(parsed.packages["node_modules/bar"].version).toBe("0.0.1");
  });

  it("rejects an invalid target version", () => {
    expect(() => bumpPackageLockVersion(makeLock(), "v1.1.0")).toThrow(
      /Strip the leading 'v'/,
    );
  });

  it("throws when the top-level version field is absent", () => {
    expect(() => bumpPackageLockVersion(makeLock({ omitTopVersion: true }), "1.1.0")).toThrow(
      /no top-level 'version' field/,
    );
  });

  it("throws when packages[''] is absent", () => {
    expect(() => bumpPackageLockVersion(makeLock({ omitRootPackage: true }), "1.1.0")).toThrow(
      /no 'packages\[""\]' entry/,
    );
  });

  it("throws when packages[''].version is absent", () => {
    expect(() =>
      bumpPackageLockVersion(makeLock({ omitRootPackageVersion: true }), "1.1.0"),
    ).toThrow(/no 'packages\[""\]\.version' field/);
  });
});

describe("tagCommitTimestamp", () => {
  it("returns the trimmed git log output", () => {
    const calls: string[][] = [];
    const result = tagCommitTimestamp(
      (args) => {
        calls.push(args);
        return "2026-04-07T09:13:43+00:00\n";
      },
      "v2.0.0",
    );
    expect(result).toBe("2026-04-07T09:13:43+00:00");
    expect(calls).toEqual([["log", "-1", "--format=%cI", "v2.0.0^{commit}"]]);
  });

  it("throws when git returns an empty timestamp", () => {
    expect(() => tagCommitTimestamp(() => "\n", "v2.0.0")).toThrow(
      /no commit timestamp for tag v2\.0\.0/,
    );
  });
});

describe("selectLastNonPrereleaseTag", () => {
  it("returns the first non-pre-release row", () => {
    expect(
      selectLastNonPrereleaseTag([
        { tagName: "v2.1.0-rc.2", publishedAt: "2026-05-15", isPrerelease: true },
        { tagName: "v2.1.0-rc.1", publishedAt: "2026-05-01", isPrerelease: true },
        { tagName: "v2.0.0", publishedAt: "2026-04-07", isPrerelease: false },
        { tagName: "v1.0.4", publishedAt: "2026-04-06", isPrerelease: false },
      ]),
    ).toEqual({ tagName: "v2.0.0", publishedAt: "2026-04-07" });
  });

  it("returns undefined when no non-pre-release exists", () => {
    expect(
      selectLastNonPrereleaseTag([
        { tagName: "v0.1.0-rc.1", publishedAt: "2026-01-01", isPrerelease: true },
      ]),
    ).toBeUndefined();
  });
});

describe("resolveTargetVersion", () => {
  it("computes from labels when no explicit version is passed", () => {
    expect(
      resolveTargetVersion({
        explicit: undefined,
        baseVersion: "2.0.0",
        prs: [makePr({ number: 1, labels: [{ name: "release: minor" }] })],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toBe("2.1.0");
  });

  it("uses explicit version verbatim", () => {
    expect(
      resolveTargetVersion({
        explicit: "2.1.0-rc.1",
        baseVersion: "2.0.0",
        prs: [],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toBe("2.1.0-rc.1");
  });

  it("rejects an explicit non-pre-release version that already exists as a tag", () => {
    expect(() =>
      resolveTargetVersion({
        explicit: "2.0.0",
        baseVersion: "2.0.0",
        prs: [],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toThrow(/Tag v2\.0\.0 already exists/);
  });

  it("allows an explicit pre-release even when its base tag exists", () => {
    expect(
      resolveTargetVersion({
        explicit: "2.0.0-rc.1",
        baseVersion: "2.0.0",
        prs: [],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toBe("2.0.0-rc.1");
  });

  it("aborts when computed bump is none", () => {
    expect(() =>
      resolveTargetVersion({
        explicit: undefined,
        baseVersion: "2.0.0",
        prs: [makePr({ number: 1, labels: [{ name: "release: skip" }] })],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toThrow(/all merged PRs since the last release are 'release: skip'/i);
  });

  it("rejects a computed version that already exists as a tag", () => {
    expect(() =>
      resolveTargetVersion({
        explicit: undefined,
        baseVersion: "2.0.0",
        prs: [makePr({ number: 1, labels: [{ name: "release: minor" }] })],
        existingTags: new Set(["v2.0.0", "v2.1.0"]),
      }),
    ).toThrow(/Computed next version v2\.1\.0 already exists as a tag/);
  });

  it("refuses to compute a version when baseVersion is a pre-release (RC->final must be explicit)", () => {
    expect(() =>
      resolveTargetVersion({
        explicit: undefined,
        baseVersion: "2.1.0-rc.1",
        prs: [makePr({ number: 1, labels: [{ name: "release: minor" }] })],
        existingTags: new Set(["v2.0.0"]),
      }),
    ).toThrow(/Base version 2\.1\.0-rc\.1 is a pre-release; pass --version explicitly/);
  });
});

describe("buildPrBody", () => {
  it("includes counts, since-line, and pre-release flag", () => {
    const body = buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [
        makePr({ number: 1, title: "Feature", labels: [{ name: "release: minor" }] }),
        makePr({ number: 2, title: "Skip", labels: [{ name: "release: skip" }] }),
      ],
      baseTag: "v2.0.0",
    });
    expect(body).toContain("Since v2.0.0.");
    expect(body).toContain("**PRs included (1)");
    expect(body).toContain("**PRs excluded with `release: skip` (1)");
    expect(body).toContain("**Pre-release:** no");
  });

  it("renders the pre-release note when applicable", () => {
    const body = buildPrBody({
      version: "2.1.0-rc.1",
      isPrerelease: true,
      prs: [],
      baseTag: undefined,
    });
    expect(body).toContain("Since repository inception.");
    expect(body).toContain("**Pre-release:** yes");
  });

  it("includes the release-gate sign-off checklist split into pre-merge and post-tag", () => {
    const body = buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [],
      baseTag: "v2.0.0",
    });
    expect(body).toContain("## Release gate sign-off");
    expect(body).toContain("docs/release-gate.md");
    expect(body).toContain("**Pre-merge:**");
    expect(body).toContain("**Post-tag:**");
    expect(body).toContain("- [ ] Required validation block runs cleanly");
    expect(body).toContain("`npm audit` advisories are triaged");
    expect(body).toContain("- [ ] Dist reproducibility check is clean");
    expect(body).toContain("- [ ] Manual security regression checks");
    expect(body).toContain("- [ ] Conditional `review-reference-source: base` checks");
    expect(body).toContain("- [ ] Release-specific items table");
    expect(body).toContain("- [ ] Trust-boundary CHANGELOG callout");
    expect(body).toContain("contributing a release level (i.e. not `release: skip`)");
    expect(body).toContain("- [ ] Gate evidence zip attached to the GitHub Release");

    const preMergeIndex = body.indexOf("**Pre-merge:**");
    const postTagIndex = body.indexOf("**Post-tag:**");
    const evidenceZipIndex = body.indexOf("Gate evidence zip");
    expect(postTagIndex).toBeGreaterThan(preMergeIndex);
    expect(evidenceZipIndex).toBeGreaterThan(postTagIndex);
  });
});

describe("existingBodyHasMaintainerSignoff", () => {
  it("returns false for null, undefined, or empty bodies", () => {
    expect(existingBodyHasMaintainerSignoff(null)).toBe(false);
    expect(existingBodyHasMaintainerSignoff(undefined)).toBe(false);
    expect(existingBodyHasMaintainerSignoff("")).toBe(false);
  });

  it("returns false for a freshly generated bot body (template labels live inside backticks)", () => {
    const body = buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [],
      baseTag: "v2.0.0",
    });
    expect(existingBodyHasMaintainerSignoff(body)).toBe(false);
  });

  it("returns true once the maintainer adds a Verified by line", () => {
    const body = `${buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [],
      baseTag: "v2.0.0",
    })}\n\nVerified by: Maintainer — 2026-05-04`;
    expect(existingBodyHasMaintainerSignoff(body)).toBe(true);
  });

  it("returns true once the maintainer adds a Waived line", () => {
    const body = `${buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [],
      baseTag: "v2.0.0",
    })}\n\nWaived: deferred to v2.2 per #97`;
    expect(existingBodyHasMaintainerSignoff(body)).toBe(true);
  });

  it("ignores Verified by / Waived occurrences inside fenced code blocks", () => {
    const body = "```\nVerified by: example — 2026-01-01\n```\n";
    expect(existingBodyHasMaintainerSignoff(body)).toBe(false);
  });
});

describe("runCli (dry-run integration)", () => {
  it("prints unified diffs and writes nothing in --dry-run", () => {
    const calls: string[] = [];
    const writes: Array<{ path: string; content: string }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    const ghRoutes: Record<string, string> = {
      "release list --limit 100 --json tagName,publishedAt,isPrerelease": JSON.stringify([
        { tagName: "v2.0.0", publishedAt: "2026-04-07T00:00:00Z", isPrerelease: false },
      ]),
      "pr list --state merged --base main --search merged:>2026-04-07T00:00:00Z base:main --json number,title,body,labels,url --limit 1000":
        JSON.stringify([
          {
            number: 100,
            title: "Add feature",
            body: "",
            labels: [{ name: "release: minor" }, { name: "enhancement" }],
            url: "https://github.com/o/r/pull/100",
          },
        ]),
    };

    const exit = runCli({
      argv: ["--dry-run"],
      env: {},
      readFile: (path) => {
        if (path === "package.json")
          return `${JSON.stringify({ name: "x", version: "2.0.0" }, null, 2)}\n`;
        if (path === "package-lock.json")
          return `${JSON.stringify(
            {
              name: "x",
              version: "2.0.0",
              lockfileVersion: 3,
              requires: true,
              packages: { "": { name: "x", version: "2.0.0" } },
            },
            null,
            2,
          )}\n`;
        if (path === "CHANGELOG.md")
          return "# Changelog\n\n## [2.0.0] - 2026-04-07\n\n- prior\n";
        throw new Error(`unexpected read: ${path}`);
      },
      writeFile: (path, content) => {
        writes.push({ path, content });
      },
      runGh: (args) => {
        calls.push(`gh ${args.join(" ")}`);
        const key = args.join(" ");
        const value = ghRoutes[key];
        if (value === undefined) throw new Error(`unrouted gh: ${key}`);
        return value;
      },
      runGit: (args) => {
        calls.push(`git ${args.join(" ")}`);
        if (args[0] === "ls-remote" && args[1] === "--tags") {
          return "abc\trefs/tags/v2.0.0\n";
        }
        if (args[0] === "log" && args.includes("--format=%cI")) {
          return "2026-04-07T00:00:00Z\n";
        }
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: (chunk) => {
        stdout.push(chunk);
      },
      stderrWrite: (chunk) => {
        stderr.push(chunk);
      },
    });

    expect(exit).toBe(0);
    expect(writes).toHaveLength(0);
    expect(stderr.join("")).toBe("");
    const out = stdout.join("");
    expect(out).toContain('"version": "2.1.0"');
    expect(out).toContain('"lockfileVersion": 3');
    expect(out).toContain("package-lock.json");
    expect(out).toContain("## [2.1.0] - 2026-05-01");
    expect(out).toContain("Target version: 2.1.0 (release)");
  });

  it("returns 1 with a clear error when a PR lacks a release-level label", () => {
    const stderr: string[] = [];
    const exit = runCli({
      argv: ["--dry-run"],
      env: {},
      readFile: (path) => {
        if (path === "package.json") return JSON.stringify({ version: "2.0.0" });
        return "# Changelog\n";
      },
      runGh: (args) => {
        if (args[0] === "release") {
          return JSON.stringify([
            { tagName: "v2.0.0", publishedAt: "2026-04-07T00:00:00Z", isPrerelease: false },
          ]);
        }
        return JSON.stringify([
          {
            number: 99,
            title: "Untagged PR",
            body: "",
            labels: [{ name: "enhancement" }],
            url: "https://github.com/o/r/pull/99",
          },
        ]);
      },
      runGit: (args) => {
        if (args[0] === "ls-remote" && args[1] === "--tags") {
          return "abc\trefs/tags/v2.0.0\n";
        }
        if (args[0] === "log" && args.includes("--format=%cI")) {
          return "2026-04-07T00:00:00Z\n";
        }
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: () => undefined,
      stderrWrite: (chunk) => stderr.push(chunk),
    });
    expect(exit).toBe(1);
    expect(stderr.join("")).toMatch(/missing a release-level label/);
  });
});
