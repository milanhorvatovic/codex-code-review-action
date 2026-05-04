import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyChangelogUpdate,
  buildAutoHeaderSection,
  buildSignoffSection,
  bumpPackageJsonVersion,
  bumpPackageLockVersion,
  buildPrBody,
  categorizePullRequest,
  computeVersionBump,
  consolidateRcSections,
  existingBodyHasMaintainerEdits,
  existingBodyHasMaintainerSignoff,
  extractTrustBoundaryImpact,
  findSignoffSectionStart,
  formatPullRequestEntry,
  parseGitRemoteUrl,
  parseTargetVersion,
  planPrBodyRefresh,
  releaseLevelOf,
  renderChangelogEntry,
  resolveDefaultBranchFromGit,
  resolveGateDocUrl,
  resolveTargetVersion,
  runCli,
  selectLastNonPrereleaseTag,
  SIGNOFF_SECTION_HEADER,
  SIGNOFF_TEMPLATE_VERSION_MARKER,
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

describe("gate doc / PR body checklist drift", () => {
  // Categories that BOTH `docs/release-gate.md` and `buildSignoffSection` must
  // cover. If a future edit adds or removes a category from one without
  // updating the other, this test fails. The list is the contract; updating
  // it is part of any change that adds/removes a gate category.
  // Substrings present in BOTH the doc's section and the corresponding PR
  // body bullet. The doc uses prose section headings; the PR body uses
  // checklist items that mention the same concept. The shared substring is
  // the contract.
  const GATE_CATEGORIES = [
    "Required validation",
    "Dist reproducibility",
    "Manual security regression checks",
    "review-reference-source: base", // Conditional base-mode checks
    "Release-specific items",
    "Trust-boundary",
    "Archiving the gate",
  ] as const;

  const gateDocPath = fileURLToPath(
    new URL("../docs/release-gate.md", import.meta.url),
  );
  const gateDoc = readFileSync(gateDocPath, "utf-8");
  const signoff = buildSignoffSection("https://example.test/release-gate.md");

  for (const category of GATE_CATEGORIES) {
    it(`docs/release-gate.md and buildSignoffSection both reference "${category}"`, () => {
      expect(
        gateDoc,
        `docs/release-gate.md is missing a reference to "${category}"; if the category was renamed or removed, update GATE_CATEGORIES too.`,
      ).toContain(category);
      expect(
        signoff,
        `buildSignoffSection is missing a reference to "${category}"; if the category was renamed or removed, update GATE_CATEGORIES too.`,
      ).toContain(category);
    });
  }
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
    expect(body).toContain("- [ ] Prompt-artifact leakage check");
    expect(body).toContain("uses the resolved custom reference content for each prompt");
    expect(body).toContain("gh run download <run-id> --name codex-prepare");
    expect(body).toContain("`allow-users`");
    expect(body).toContain("widen `allow-users`");
    expect(body).toContain("- [ ] Conditional `review-reference-source: base` checks");
    expect(body).toContain("- [ ] Release-specific items table is filled below this checklist");
    expect(body).toContain("- [ ] Trust-boundary CHANGELOG callout");
    expect(body).toContain("contributing a release level (i.e. not `release: skip`)");
    expect(body).toContain("- [ ] Gate evidence zip attached to the GitHub Release");
    expect(body).toContain("### Release-specific items");
    expect(body).toContain("| # | Item | Owning work | State |");

    const preMergeIndex = body.indexOf("**Pre-merge:**");
    const postTagIndex = body.indexOf("**Post-tag:**");
    const evidenceZipIndex = body.indexOf("Gate evidence zip");
    const tableIndex = body.indexOf("| # | Item | Owning work | State |");
    expect(postTagIndex).toBeGreaterThan(preMergeIndex);
    expect(evidenceZipIndex).toBeGreaterThan(postTagIndex);
    expect(tableIndex).toBeGreaterThan(evidenceZipIndex);
  });
});

describe("resolveGateDocUrl", () => {
  it("uses GITHUB_REPOSITORY when set so forks/internal mirrors point at their own docs", () => {
    expect(resolveGateDocUrl({ GITHUB_REPOSITORY: "fork-owner/fork-repo" })).toBe(
      "https://github.com/fork-owner/fork-repo/blob/main/docs/release-gate.md",
    );
  });

  it("uses GITHUB_SERVER_URL when set so GitHub Enterprise Server runs produce host-correct links", () => {
    expect(
      resolveGateDocUrl({
        GITHUB_SERVER_URL: "https://ghe.example.com",
        GITHUB_REPOSITORY: "team/repo",
      }),
    ).toBe("https://ghe.example.com/team/repo/blob/main/docs/release-gate.md");
  });

  it("falls back to upstream host and repository when both env vars are unset", () => {
    expect(resolveGateDocUrl({})).toBe(
      "https://github.com/milanhorvatovic/codex-ai-code-review-action/blob/main/docs/release-gate.md",
    );
  });

  it("uses the git-fallback host and repo before the hard-coded upstream when env is unset", () => {
    expect(
      resolveGateDocUrl({}, { host: "https://github.fork.example", repo: "team/fork-repo" }),
    ).toBe("https://github.fork.example/team/fork-repo/blob/main/docs/release-gate.md");
  });

  it("env vars still win over the git-fallback (env is the canonical signal under Actions)", () => {
    expect(
      resolveGateDocUrl(
        { GITHUB_SERVER_URL: "https://ghe.example.com", GITHUB_REPOSITORY: "ghe/repo" },
        { host: "https://other.example", repo: "ignored/ignored" },
      ),
    ).toBe("https://ghe.example.com/ghe/repo/blob/main/docs/release-gate.md");
  });

  it("ignores GITHUB_REF_NAME (workflow run ref, not repo default branch) and falls back to git-default or main", () => {
    // GITHUB_REF_NAME under workflow_dispatch is the dispatch ref (often
    // a release branch), not the repository default. Pinning the audit
    // link to it would 404 after the branch is deleted post-merge.
    expect(
      resolveGateDocUrl({
        GITHUB_REPOSITORY: "team/repo",
        GITHUB_REF_NAME: "release/v2.1.0",
      }),
    ).toBe("https://github.com/team/repo/blob/main/docs/release-gate.md");
  });

  it("uses git-fallback defaultBranch when set", () => {
    expect(
      resolveGateDocUrl({}, {
        host: "https://github.com",
        repo: "team/repo",
        defaultBranch: "trunk",
      }),
    ).toBe("https://github.com/team/repo/blob/trunk/docs/release-gate.md");
  });

  it("falls back to main when neither branchOverride nor git-fallback specifies a branch", () => {
    expect(
      resolveGateDocUrl({}, { host: "https://github.com", repo: "team/repo" }),
    ).toBe("https://github.com/team/repo/blob/main/docs/release-gate.md");
  });

  it("branchOverride wins over git-fallback so callers can opt into a non-default branch", () => {
    expect(
      resolveGateDocUrl(
        { GITHUB_REPOSITORY: "team/repo" },
        { host: "https://github.com", repo: "team/repo", defaultBranch: "trunk" },
        "feature-branch",
      ),
    ).toBe("https://github.com/team/repo/blob/feature-branch/docs/release-gate.md");
  });
});

describe("resolveDefaultBranchFromGit", () => {
  it("uses git symbolic-ref refs/remotes/origin/HEAD when available", () => {
    const calls: string[][] = [];
    const runGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "symbolic-ref") return "refs/remotes/origin/main\n";
      throw new Error(`unrouted git: ${args.join(" ")}`);
    };
    expect(resolveDefaultBranchFromGit(runGit)).toBe("main");
    expect(calls).toHaveLength(1);
  });

  it("falls back to git ls-remote --symref when origin/HEAD is not set locally", () => {
    const calls: string[][] = [];
    const runGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "symbolic-ref") {
        // origin/HEAD missing on shallow/fresh clones — git exits non-zero.
        throw new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref");
      }
      if (args[0] === "ls-remote" && args.includes("--symref")) {
        return "ref: refs/heads/trunk\tHEAD\nabc123\tHEAD\n";
      }
      throw new Error(`unrouted git: ${args.join(" ")}`);
    };
    expect(resolveDefaultBranchFromGit(runGit)).toBe("trunk");
    expect(calls.map((c) => c[0])).toEqual(["symbolic-ref", "ls-remote"]);
  });

  it("returns undefined when both lookups fail (no origin remote, network failure, etc.)", () => {
    const runGit = () => {
      throw new Error("git: no origin remote configured");
    };
    expect(resolveDefaultBranchFromGit(runGit)).toBeUndefined();
  });

  it("returns undefined when symbolic-ref returns empty (defensive against silent failure)", () => {
    const runGit = (args: string[]) => {
      if (args[0] === "symbolic-ref") return "";
      if (args[0] === "ls-remote") return "";
      throw new Error(`unrouted git: ${args.join(" ")}`);
    };
    expect(resolveDefaultBranchFromGit(runGit)).toBeUndefined();
  });
});

describe("parseGitRemoteUrl", () => {
  it("parses scp-style SSH origin URL into host and repo", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
    expect(parseGitRemoteUrl("git@ghe.example.com:team/proj")).toEqual({
      host: "https://ghe.example.com",
      repo: "team/proj",
    });
  });

  it("parses scp-style SSH with non-default usernames (custom SSH config aliases)", () => {
    expect(parseGitRemoteUrl("alice@ghe.example.com:team/repo.git")).toEqual({
      host: "https://ghe.example.com",
      repo: "team/repo",
    });
    expect(parseGitRemoteUrl("deploy-bot@github.com:owner/repo")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
  });

  it("parses URL-style ssh:// origin URL into host and repo", () => {
    expect(parseGitRemoteUrl("ssh://git@github.com/owner/repo.git")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
    expect(parseGitRemoteUrl("ssh://git@ghe.example.com:2222/team/proj")).toEqual({
      host: "https://ghe.example.com",
      repo: "team/proj",
    });
    expect(parseGitRemoteUrl("ssh://ghe.example.com/team/proj.git")).toEqual({
      host: "https://ghe.example.com",
      repo: "team/proj",
    });
  });

  it("parses an HTTPS origin URL into host and repo (with or without .git suffix)", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo.git")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
    expect(parseGitRemoteUrl("https://github.com/owner/repo")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
  });

  it("preserves http:// scheme for internal mirrors (does not force https)", () => {
    expect(parseGitRemoteUrl("http://ghe.internal/team/repo.git")).toEqual({
      host: "http://ghe.internal",
      repo: "team/repo",
    });
  });

  it("strips a basic-auth prefix from HTTPS URLs", () => {
    expect(parseGitRemoteUrl("https://user:token@github.com/owner/repo.git")).toEqual({
      host: "https://github.com",
      repo: "owner/repo",
    });
  });

  it("returns null for empty or unrecognized URLs", () => {
    expect(parseGitRemoteUrl("")).toBeNull();
    expect(parseGitRemoteUrl("file:///local/path")).toBeNull();
    expect(parseGitRemoteUrl("not-a-url")).toBeNull();
  });
});

describe("buildSignoffSection (with explicit gateDocUrl)", () => {
  it("substitutes the provided URL for every cross-reference", () => {
    const url = "https://github.com/test-owner/test-repo/blob/main/docs/release-gate.md";
    const section = buildSignoffSection(url);
    expect(section).toContain(`(${url})`);
    expect(section).toContain(`(${url}#required-validation)`);
    expect(section).toContain(`(${url}#release-specific-items)`);
    expect(section).toContain(`(${url}#archiving-the-gate)`);
    expect(section).not.toContain("milanhorvatovic/codex-ai-code-review-action");
  });
});

describe("findSignoffSectionStart", () => {
  it("returns -1 when the heading is absent", () => {
    expect(findSignoffSectionStart("body without the heading")).toBe(-1);
  });

  it("matches the heading on its own Markdown line", () => {
    const body = `intro\n\n${SIGNOFF_SECTION_HEADER}\n\ncontent`;
    const idx = findSignoffSectionStart(body);
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx).startsWith(SIGNOFF_SECTION_HEADER)).toBe(true);
  });

  it("matches the heading even when the body uses CRLF line endings (Windows editor paste)", () => {
    const body = `intro\r\n\r\n${SIGNOFF_SECTION_HEADER}\r\n\r\ncontent`;
    const idx = findSignoffSectionStart(body);
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx).startsWith(SIGNOFF_SECTION_HEADER)).toBe(true);
  });

  it("matches the heading even with trailing whitespace (GFM treats `## Heading  ` as the same heading)", () => {
    const body = `intro\n\n${SIGNOFF_SECTION_HEADER}   \n\ncontent`;
    const idx = findSignoffSectionStart(body);
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx).startsWith(SIGNOFF_SECTION_HEADER)).toBe(true);
  });

  it("matches the heading with trailing whitespace and CRLF (combined)", () => {
    const body = `intro\r\n\r\n${SIGNOFF_SECTION_HEADER}\t \r\n\r\ncontent`;
    const idx = findSignoffSectionStart(body);
    expect(idx).toBeGreaterThan(-1);
  });

  it("ignores occurrences of the heading text inside a PR title in the auto-header (line-anchored)", () => {
    const body = [
      "Release prepared by `scripts/prepare-release.ts` for v2.1.0.",
      "",
      "**PRs included (1):**",
      "",
      "- #100 `release: minor` — Refactor ## Release gate sign-off helper",
      "",
      "Merge this PR to trigger `release-on-merge.yaml`.",
      "",
      SIGNOFF_SECTION_HEADER,
      "",
      "real signoff content",
    ].join("\n");
    const idx = findSignoffSectionStart(body);
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx).startsWith(`${SIGNOFF_SECTION_HEADER}\n`)).toBe(true);
    expect(body.slice(idx)).toContain("real signoff content");
    expect(body.slice(idx)).not.toContain("Refactor ## Release gate sign-off helper");
  });
});

describe("planPrBodyRefresh", () => {
  const args = {
    version: "2.1.0",
    isPrerelease: false,
    prs: [makePr({ number: 1, title: "F", labels: [{ name: "release: minor" }] })],
    baseTag: "v2.0.0",
  };
  const fullFresh = `${buildAutoHeaderSection(args)}\n\n${buildSignoffSection()}`;

  it("returns mode=fresh with the full template when the existing body is missing", () => {
    expect(planPrBodyRefresh(args, null)).toEqual({ mode: "fresh", body: fullFresh });
    expect(planPrBodyRefresh(args, undefined)).toEqual({ mode: "fresh", body: fullFresh });
    expect(planPrBodyRefresh(args, "")).toEqual({ mode: "fresh", body: fullFresh });
  });

  it("returns mode=fresh when the existing body's signoff section is byte-identical to the bot template (reruns pick up template updates)", () => {
    const unmodified = `Some stale auto-header.\n\n${buildSignoffSection()}`;
    expect(planPrBodyRefresh(args, unmodified)).toEqual({ mode: "fresh", body: fullFresh });
  });

  it("returns mode=merge when the maintainer adds free-form notes below the signoff section", () => {
    const withNotes = [
      buildAutoHeaderSection(args),
      "",
      buildSignoffSection(),
      "",
      "Note: skipped X because of flaky CI; see #999.",
    ].join("\n");
    const plan = planPrBodyRefresh(args, withNotes);
    expect(plan.mode).toBe("merge");
    if (plan.mode !== "merge") throw new Error("unreachable");
    expect(plan.body).toContain("Note: skipped X because of flaky CI; see #999.");
  });

  it("returns mode=merge when the maintainer modifies a checklist line on the current template (version marker preserved)", () => {
    const modified = [
      "Some stale auto-header.",
      "",
      SIGNOFF_SECTION_HEADER,
      SIGNOFF_TEMPLATE_VERSION_MARKER,
      "",
      "- [ ] Required validation block runs cleanly.", // truncated vs current template
    ].join("\n");
    const plan = planPrBodyRefresh(args, modified);
    expect(plan.mode).toBe("merge");
  });

  it("returns mode=fresh when the body's signoff section comes from an older bot (no version marker, no maintainer signal)", () => {
    const olderBot = [
      "Some stale auto-header.",
      "",
      SIGNOFF_SECTION_HEADER,
      "",
      "- [ ] Some old checklist line removed in the current template",
    ].join("\n");
    const plan = planPrBodyRefresh(args, olderBot);
    expect(plan.mode).toBe("fresh");
    if (plan.mode !== "fresh") throw new Error("unreachable");
    expect(plan.body).toBe(fullFresh);
  });

  it("returns mode=merge when sign-off is present and the marker is intact", () => {
    const filledSignoff = [
      SIGNOFF_SECTION_HEADER,
      "",
      "Verified by: Maintainer — 2026-05-04",
      "",
      "Custom note from the maintainer.",
    ].join("\n");
    const previousBody = `Stale auto-header from a previous run.\n\n${filledSignoff}`;
    const plan = planPrBodyRefresh(args, previousBody);
    expect(plan.mode).toBe("merge");
    if (plan.mode !== "merge") throw new Error("unreachable");
    expect(plan.body.startsWith(buildAutoHeaderSection(args))).toBe(true);
    expect(plan.body).toContain("Verified by: Maintainer — 2026-05-04");
    expect(plan.body).toContain("Custom note from the maintainer.");
    expect(plan.body).not.toContain("Stale auto-header");
  });

  it("regenerates the auto-header on every merge so reruns reflect newly merged PRs", () => {
    const argsWithMore = {
      ...args,
      prs: [
        makePr({ number: 1, title: "F1", labels: [{ name: "release: minor" }] }),
        makePr({ number: 2, title: "F2", labels: [{ name: "release: patch" }] }),
      ],
    };
    const filledSignoff = `${SIGNOFF_SECTION_HEADER}\n\nVerified by: Maintainer — 2026-05-04`;
    const previousBody = `${buildAutoHeaderSection(args)}\n\n${filledSignoff}`;
    const plan = planPrBodyRefresh(argsWithMore, previousBody);
    expect(plan.mode).toBe("merge");
    if (plan.mode !== "merge") throw new Error("unreachable");
    expect(plan.body).toContain("**PRs included (2)");
    expect(plan.body).toContain("Verified by: Maintainer — 2026-05-04");
  });

  it("returns mode=skip when sign-off is present but the marker heading is missing (defensive)", () => {
    const previousBody = [
      "Some legacy auto-header.",
      "",
      "## Renamed Heading",
      "",
      "Verified by: Maintainer — 2026-05-04",
    ].join("\n");
    const plan = planPrBodyRefresh(args, previousBody);
    expect(plan.mode).toBe("skip");
    if (plan.mode !== "skip") throw new Error("unreachable");
    expect(plan.reason).toContain("`## Release gate sign-off` marker");
  });
});

describe("existingBodyHasMaintainerEdits", () => {
  const args = {
    version: "2.1.0",
    isPrerelease: false,
    prs: [makePr({ number: 1, title: "F", labels: [{ name: "release: minor" }] })],
    baseTag: "v2.0.0",
  };

  it("returns false for null/empty bodies", () => {
    expect(existingBodyHasMaintainerEdits(null)).toBe(false);
    expect(existingBodyHasMaintainerEdits(undefined)).toBe(false);
    expect(existingBodyHasMaintainerEdits("")).toBe(false);
  });

  it("returns false for a body whose signoff section is byte-identical to the fresh template", () => {
    const body = `${buildAutoHeaderSection(args)}\n\n${buildSignoffSection()}`;
    expect(existingBodyHasMaintainerEdits(body)).toBe(false);
  });

  it("delegates to existingBodyHasMaintainerSignoff when the regex signal is present", () => {
    expect(existingBodyHasMaintainerEdits("Verified by: Maintainer — 2026-05-04")).toBe(true);
    expect(existingBodyHasMaintainerEdits("- [x] Required validation block runs cleanly")).toBe(
      true,
    );
  });

  it("treats a body whose signoff section was generated with a different gateDocUrl as untouched (URL changes alone don't count as edits)", () => {
    const oldUrl = "https://github.com/old-owner/old-repo/blob/main/docs/release-gate.md";
    const newUrl = "https://github.com/new-owner/new-repo/blob/release/v2.1.0/docs/release-gate.md";
    const oldBody = `${buildAutoHeaderSection(args)}\n\n${buildSignoffSection(oldUrl)}`;
    expect(existingBodyHasMaintainerEdits(oldBody, newUrl)).toBe(false);
  });

  it("returns true when the signoff section has a non-template line (added note, modified row)", () => {
    const withNote = [
      buildAutoHeaderSection(args),
      "",
      buildSignoffSection(),
      "",
      "Maintainer note: skipped audit triage; see #999.",
    ].join("\n");
    expect(existingBodyHasMaintainerEdits(withNote)).toBe(true);
  });

  it("requires the marker heading for the unknown-lines backstop (regex still applies without marker)", () => {
    const noMarkerNoSignoff = "Some legacy body without the gate marker or sign-off labels.";
    expect(existingBodyHasMaintainerEdits(noMarkerNoSignoff)).toBe(false);
    const noMarkerWithSignoff = "Some legacy body.\nVerified by: Maintainer — 2026-05-04";
    expect(existingBodyHasMaintainerEdits(noMarkerWithSignoff)).toBe(true);
  });

  it("ignores unknown-lines when the body's signoff section lacks the current template-version marker (older bot)", () => {
    const olderBotSignoff = [
      SIGNOFF_SECTION_HEADER,
      "",
      "## Older content from a previous bot template",
      "",
      "- [ ] Some old checklist line that the current template no longer has",
    ].join("\n");
    const body = `${buildAutoHeaderSection(args)}\n\n${olderBotSignoff}`;
    expect(existingBodyHasMaintainerEdits(body)).toBe(false);
  });

  it("preserves real maintainer sign-off on an older template via the regex signal even without the version marker", () => {
    const olderBotWithSignoff = [
      SIGNOFF_SECTION_HEADER,
      "",
      "- [ ] Old checklist line",
      "Verified by: Maintainer — 2026-05-04",
    ].join("\n");
    expect(existingBodyHasMaintainerEdits(olderBotWithSignoff)).toBe(true);
  });

  it("applies the unknown-lines backstop when the current version marker is present and a non-template line was added", () => {
    const withMarkerAndNote = [
      buildAutoHeaderSection(args),
      "",
      buildSignoffSection(),
      "",
      "Maintainer note: skipped audit triage; see #999.",
    ].join("\n");
    expect(withMarkerAndNote).toContain(SIGNOFF_TEMPLATE_VERSION_MARKER);
    expect(existingBodyHasMaintainerEdits(withMarkerAndNote)).toBe(true);
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

  it("preserves Verified by detection even when the body contains an unmatched backtick (e.g., a PR title with a single backtick)", () => {
    const body = [
      "- #100 `release: minor` — Fix `release docs",
      "",
      "## Release gate sign-off",
      "",
      "Verified by: Maintainer — 2026-05-04",
      "",
      "Some `inline code` later",
    ].join("\n");
    expect(existingBodyHasMaintainerSignoff(body)).toBe(true);
  });

  it("ignores signals above the marker so they don't route to merge mode and get dropped", () => {
    // The merge path slices from the marker onward, so any sign-off
    // detected above the marker would be classified as edit but then
    // silently lost. Scope detection to the marker-onward section.
    const body = [
      "Auto-header preamble.",
      "",
      "Verified by: Maintainer — 2026-05-04",
      "",
      "- [x] Some pre-marker checked box",
      "",
      "## Release gate sign-off",
      "",
      "- [ ] Required validation block runs cleanly on the merge candidate",
    ].join("\n");
    expect(existingBodyHasMaintainerSignoff(body)).toBe(false);
  });

  it("does not match a PR title containing Waived: or Verified by:", () => {
    const body = `${buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [
        makePr({
          number: 100,
          title: "Waived: update release docs",
          labels: [{ name: "release: patch" }],
        }),
        makePr({
          number: 101,
          title: "Verified by: rename module",
          labels: [{ name: "release: minor" }],
        }),
      ],
      baseTag: "v2.0.0",
    })}`;
    expect(existingBodyHasMaintainerSignoff(body)).toBe(false);
  });

  it("does not match the gate doc template prose when pasted unfilled", () => {
    const pastedTemplate = [
      "## Sign-off convention",
      "",
      "- **Verified by:** `<maintainer> — <YYYY-MM-DD>` — the maintainer ran the check.",
      "- **Waived:** `<rationale>` — the check does not apply to this release.",
      "",
      "Verified by: <maintainer> — <YYYY-MM-DD>",
      "Waived: <rationale referencing tracked follow-up>",
    ].join("\n");
    expect(existingBodyHasMaintainerSignoff(pastedTemplate)).toBe(false);
  });

  it("matches a list-item style fill (- Verified by: ... or - [x] Verified by: ...)", () => {
    expect(
      existingBodyHasMaintainerSignoff("- Verified by: Maintainer — 2026-05-04"),
    ).toBe(true);
    expect(
      existingBodyHasMaintainerSignoff("- [x] Verified by: Maintainer — 2026-05-04"),
    ).toBe(true);
  });

  it("matches checked task-list rows so flipping a checkbox counts as sign-off in progress", () => {
    expect(
      existingBodyHasMaintainerSignoff("- [x] Required validation block runs cleanly"),
    ).toBe(true);
    expect(
      existingBodyHasMaintainerSignoff("- [X] Dist reproducibility check is clean"),
    ).toBe(true);
  });

  it("does not match unchecked task-list rows from a freshly generated body", () => {
    const body = buildPrBody({
      version: "2.1.0",
      isPrerelease: false,
      prs: [],
      baseTag: "v2.0.0",
    });
    expect(body).toContain("- [ ] Required validation block runs cleanly");
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

describe("runCli (rerun body-refresh integration)", () => {
  function runRerunScenario(existingBody: string | null) {
    const ghCalls: Array<{ args: string[] }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    const branch = "release/v2.1.0";
    const baseRef = "abc1234";

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
            labels: [{ name: "release: minor" }],
            url: "https://github.com/o/r/pull/100",
          },
        ]),
      [`pr list --head ${branch} --state open --json number`]: JSON.stringify([{ number: 42 }]),
      "pr view 42 --json body": JSON.stringify({ body: existingBody }),
    };

    const exit = runCli({
      argv: [],
      env: { RELEASE_APP_BOT_USER_ID: "999000" },
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
      writeFile: () => undefined,
      runGh: (args) => {
        ghCalls.push({ args: [...args] });
        if (args[0] === "pr" && args[1] === "edit") {
          return "";
        }
        const key = args.join(" ");
        const value = ghRoutes[key];
        if (value === undefined) throw new Error(`unrouted gh: ${key}`);
        return value;
      },
      runGit: (args) => {
        if (args[0] === "ls-remote" && args[1] === "--tags") {
          return `${baseRef}\trefs/tags/v2.0.0\n`;
        }
        if (args[0] === "ls-remote" && args[1] === "--heads") {
          return "";
        }
        if (args[0] === "log" && args.includes("--format=%cI")) {
          return "2026-04-07T00:00:00Z\n";
        }
        if (args[0] === "diff" && args.includes("--cached")) {
          return "package.json\npackage-lock.json\nCHANGELOG.md\n";
        }
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: (chunk) => stdout.push(chunk),
      stderrWrite: (chunk) => stderr.push(chunk),
    });

    const editCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "edit");
    return {
      exit,
      ghCalls,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      editBody: editCall?.args[editCall.args.indexOf("--body") + 1],
    };
  }

  it("refreshes the auto-header on the existing PR when no maintainer sign-off is present", () => {
    const { exit, editBody, stdout, stderr } = runRerunScenario(
      "Release prepared by `scripts/prepare-release.ts` for v2.1.0.\n\n(no sign-off yet)",
    );
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(editBody).toBeDefined();
    expect(editBody).toContain("Release prepared by `scripts/prepare-release.ts` for v2.1.0.");
    expect(editBody).toContain("**PRs included (1)");
    expect(editBody).toContain("## Release gate sign-off");
    expect(stdout).toContain("Updated existing release PR #42");
  });

  it("refreshes the auto-header but preserves the gate sign-off section verbatim when sign-off is present (older template, warns about new items)", () => {
    const filledBody = [
      "Stale prior auto-header — should be refreshed.",
      "",
      SIGNOFF_SECTION_HEADER,
      "",
      "Verified by: Maintainer — 2026-05-04",
      "",
      "Maintainer note retained on rerun.",
    ].join("\n");
    const { exit, editBody, stdout, stderr } = runRerunScenario(filledBody);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(editBody).toBeDefined();
    expect(editBody).not.toContain("Stale prior auto-header");
    expect(editBody).toContain("Release prepared by `scripts/prepare-release.ts` for v2.1.0.");
    expect(editBody).toContain("**PRs included (1)");
    expect(editBody).toContain("Verified by: Maintainer — 2026-05-04");
    expect(editBody).toContain("Maintainer note retained on rerun.");
    expect(stdout).toContain("Refreshed auto-generated header on release PR #42");
    expect(stdout).toContain("re-verify the gate before approving");
    // The body lacks SIGNOFF_TEMPLATE_VERSION_MARKER → warning fires.
    expect(stdout).toContain("WARNING:");
    expect(stdout).toContain("older sign-off template");
    expect(stdout).toContain("append/check any missing items manually");
  });

  it("does not emit the older-template warning when the existing body carries the current template-version marker", () => {
    const filledBody = [
      "Stale prior auto-header — should be refreshed.",
      "",
      SIGNOFF_SECTION_HEADER,
      SIGNOFF_TEMPLATE_VERSION_MARKER,
      "",
      "Verified by: Maintainer — 2026-05-04",
    ].join("\n");
    const { exit, stdout, stderr } = runRerunScenario(filledBody);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Refreshed auto-generated header on release PR #42");
    expect(stdout).not.toContain("older sign-off template");
  });

  it("refreshes the PR body even when no file changes are staged (template-text-only update)", () => {
    const ghCalls: Array<{ args: string[] }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    const branch = "release/v2.1.0";
    const ghRoutes: Record<string, string> = {
      "release list --limit 100 --json tagName,publishedAt,isPrerelease": JSON.stringify([
        { tagName: "v2.0.0", publishedAt: "2026-04-07T00:00:00Z", isPrerelease: false },
      ]),
      "pr list --state merged --base main --search merged:>2026-04-07T00:00:00Z base:main --json number,title,body,labels,url --limit 1000":
        JSON.stringify([]),
      [`pr list --head ${branch} --state open --json number`]: JSON.stringify([{ number: 42 }]),
      "pr view 42 --json body": JSON.stringify({ body: "old body" }),
    };
    runCli({
      argv: ["--version", "2.1.0"],
      env: { RELEASE_APP_BOT_USER_ID: "999000" },
      readFile: (path) => {
        if (path === "package.json")
          return `${JSON.stringify({ name: "x", version: "2.1.0" }, null, 2)}\n`;
        if (path === "package-lock.json")
          return `${JSON.stringify(
            {
              name: "x",
              version: "2.1.0",
              lockfileVersion: 3,
              requires: true,
              packages: { "": { name: "x", version: "2.1.0" } },
            },
            null,
            2,
          )}\n`;
        if (path === "CHANGELOG.md")
          return "# Changelog\n\n## [2.1.0] - 2026-05-01\n\n- _No notable changes; release contains only `release: skip` PRs._\n\n## [2.0.0] - 2026-04-07\n\n- prior\n";
        throw new Error(`unexpected read: ${path}`);
      },
      writeFile: () => undefined,
      runGh: (args) => {
        ghCalls.push({ args: [...args] });
        if (args[0] === "pr" && args[1] === "edit") return "";
        const key = args.join(" ");
        const value = ghRoutes[key];
        if (value === undefined) throw new Error(`unrouted gh: ${key}`);
        return value;
      },
      runGit: (args) => {
        if (args[0] === "ls-remote" && args[1] === "--tags") return "abc\trefs/tags/v2.0.0\n";
        if (args[0] === "ls-remote" && args[1] === "--heads") return "";
        if (args[0] === "log" && args.includes("--format=%cI")) return "2026-04-07T00:00:00Z\n";
        if (args[0] === "diff" && args.includes("--cached")) return "";
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: (chunk) => stdout.push(chunk),
      stderrWrite: (chunk) => stderr.push(chunk),
    });

    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Skipping commit/push; continuing to release PR body refresh");
    const editCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "edit");
    expect(editCall).toBeDefined();
  });

  function runStaleBranchScenario(treeMatch: "match" | "mismatch") {
    const ghCalls: Array<{ args: string[] }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    const branch = "release/v2.1.0";
    const remoteSha = "deadbeefcafebabe1234";
    const branchTreeSha = "branchtree000000";
    const mainTreeSha = treeMatch === "match" ? branchTreeSha : "maintree00000000";

    const ghRoutes: Record<string, string> = {
      "release list --limit 100 --json tagName,publishedAt,isPrerelease": JSON.stringify([
        { tagName: "v2.0.0", publishedAt: "2026-04-07T00:00:00Z", isPrerelease: false },
      ]),
      "pr list --state merged --base main --search merged:>2026-04-07T00:00:00Z base:main --json number,title,body,labels,url --limit 1000":
        JSON.stringify([]),
      [`pr list --head ${branch} --state open --json number`]: JSON.stringify([{ number: 42 }]),
      "pr view 42 --json body": JSON.stringify({ body: "old body" }),
    };
    runCli({
      argv: ["--version", "2.1.0"],
      env: { RELEASE_APP_BOT_USER_ID: "999000" },
      readFile: (path) => {
        if (path === "package.json")
          return `${JSON.stringify({ name: "x", version: "2.1.0" }, null, 2)}\n`;
        if (path === "package-lock.json")
          return `${JSON.stringify(
            {
              name: "x",
              version: "2.1.0",
              lockfileVersion: 3,
              requires: true,
              packages: { "": { name: "x", version: "2.1.0" } },
            },
            null,
            2,
          )}\n`;
        if (path === "CHANGELOG.md")
          return "# Changelog\n\n## [2.1.0] - 2026-05-01\n\n- _No notable changes; release contains only `release: skip` PRs._\n\n## [2.0.0] - 2026-04-07\n\n- prior\n";
        throw new Error(`unexpected read: ${path}`);
      },
      writeFile: () => undefined,
      runGh: (args) => {
        ghCalls.push({ args: [...args] });
        if (args[0] === "pr" && args[1] === "edit") return "";
        const key = args.join(" ");
        const value = ghRoutes[key];
        if (value === undefined) throw new Error(`unrouted gh: ${key}`);
        return value;
      },
      runGit: (args) => {
        if (args[0] === "ls-remote" && args[1] === "--tags") return "abc\trefs/tags/v2.0.0\n";
        if (args[0] === "ls-remote" && args[1] === "--heads") {
          return `${remoteSha}\trefs/heads/${branch}\n`;
        }
        if (args[0] === "rev-parse") {
          const target = args[1];
          if (target === `${remoteSha}^{tree}`) return `${branchTreeSha}\n`;
          if (target === "origin/main^{tree}") return `${mainTreeSha}\n`;
          if (target === `refs/remotes/origin/${branch}`) return `${remoteSha}\n`;
          return "\n";
        }
        if (args[0] === "log" && args.includes("--format=%cI")) return "2026-04-07T00:00:00Z\n";
        if (args[0] === "log" && args.includes("--format=%H%x09%ae%x09%ce")) return "";
        if (args[0] === "diff" && args.includes("--cached")) return "";
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: (chunk) => stdout.push(chunk),
      stderrWrite: (chunk) => stderr.push(chunk),
    });

    return {
      ghCalls,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      branch,
      remoteSha,
    };
  }

  it("skips the body refresh when no file changes AND the remote branch's tree diverges from origin/main (stale)", () => {
    const { ghCalls, stdout, stderr, branch, remoteSha } =
      runStaleBranchScenario("mismatch");
    expect(stderr).toBe("");
    expect(stdout).toContain("Skipping commit/push");
    expect(stdout).toContain(`Skipping PR body refresh on release PR #42`);
    expect(stdout).toContain(
      `branch ${branch} (sha=${remoteSha}) does not match origin/main's tree`,
    );
    const editCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "edit");
    expect(editCall).toBeUndefined();
    const viewCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "view");
    expect(viewCall).toBeUndefined();
  });

  it("refreshes the body when no file changes but the remote branch's tree matches origin/main (template-text-only update with branch in sync)", () => {
    const { ghCalls, stdout, stderr, branch, remoteSha } =
      runStaleBranchScenario("match");
    expect(stderr).toBe("");
    expect(stdout).toContain(
      `Release branch ${branch} (sha=${remoteSha}) matches origin/main's tree`,
    );
    const editCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "edit");
    expect(editCall).toBeDefined();
  });

  it("skips the body update when sign-off is present but the marker heading is missing", () => {
    const filledBody = [
      "Stale prior auto-header.",
      "",
      "## Renamed gate heading",
      "",
      "Verified by: Maintainer — 2026-05-04",
    ].join("\n");
    const { exit, ghCalls, stdout, stderr } = runRerunScenario(filledBody);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    const editCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "edit");
    expect(editCall).toBeUndefined();
    expect(stdout).toContain("Skipping body update on release PR #42");
    expect(stdout).toContain("`## Release gate sign-off` marker");
  });

  it("composes the gate-doc URL from `git remote get-url origin` and `git symbolic-ref` end-to-end", () => {
    // Glue-code coverage: helper-level tests for parseGitRemoteUrl,
    // resolveDefaultBranchFromGit, and resolveGateDocUrl pass independently;
    // this exercises runCli's orchestration to ensure the assembled URL
    // reaches buildPrBody.
    const ghCalls: Array<{ args: string[] }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branch = "release/v2.1.0";
    const ghRoutes: Record<string, string> = {
      "release list --limit 100 --json tagName,publishedAt,isPrerelease": JSON.stringify([
        { tagName: "v2.0.0", publishedAt: "2026-04-07T00:00:00Z", isPrerelease: false },
      ]),
      "pr list --state merged --base main --search merged:>2026-04-07T00:00:00Z base:main --json number,title,body,labels,url --limit 1000":
        JSON.stringify([]),
      [`pr list --head ${branch} --state open --json number`]: JSON.stringify([]),
    };
    runCli({
      argv: ["--version", "2.1.0"],
      env: { RELEASE_APP_BOT_USER_ID: "999000" },
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
      writeFile: () => undefined,
      runGh: (args) => {
        ghCalls.push({ args: [...args] });
        if (args[0] === "pr" && args[1] === "create") return "";
        const key = args.join(" ");
        const value = ghRoutes[key];
        if (value === undefined) throw new Error(`unrouted gh: ${key}`);
        return value;
      },
      runGit: (args) => {
        if (args[0] === "ls-remote" && args[1] === "--tags") return "abc\trefs/tags/v2.0.0\n";
        if (args[0] === "ls-remote" && args[1] === "--heads") return "";
        if (args[0] === "log" && args.includes("--format=%cI")) return "2026-04-07T00:00:00Z\n";
        if (args[0] === "log" && args.includes("--format=%H%x09%ae%x09%ce")) return "";
        if (args[0] === "diff" && args.includes("--cached"))
          return "package.json\npackage-lock.json\nCHANGELOG.md\n";
        // The pieces that compose the gate-doc URL:
        if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
          return "git@github.fork.example:team/fork-repo.git\n";
        }
        if (args[0] === "symbolic-ref" && args[1] === "refs/remotes/origin/HEAD") {
          return "refs/remotes/origin/trunk\n";
        }
        return "";
      },
      today: () => "2026-05-01",
      stdoutWrite: (chunk) => stdout.push(chunk),
      stderrWrite: (chunk) => stderr.push(chunk),
    });

    expect(stderr.join("")).toBe("");
    const createCall = ghCalls.find((c) => c.args[0] === "pr" && c.args[1] === "create");
    expect(createCall).toBeDefined();
    const bodyArg = createCall?.args[createCall.args.indexOf("--body") + 1] ?? "";
    // Repo and host come from `git remote get-url origin`; branch comes
    // from `git symbolic-ref refs/remotes/origin/HEAD`.
    expect(bodyArg).toContain(
      "https://github.fork.example/team/fork-repo/blob/trunk/docs/release-gate.md",
    );
    // Hard-coded upstream URL must NOT appear since git fallback resolved.
    expect(bodyArg).not.toContain("milanhorvatovic/codex-ai-code-review-action");
  });
});
