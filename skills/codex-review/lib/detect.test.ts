import { describe, expect, it } from "vitest";

import { detect, type RepoReader } from "./detect.js";

function makeReader(files: Record<string, string>, dirs: Record<string, string[]> = {}): RepoReader {
  return {
    exists: (path) => path in files || path in dirs,
    listFiles: (dir) => dirs[dir] ?? [],
    readFile: (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
  };
}

describe("detect", () => {
  it("identifies a TypeScript + npm + GitHub Actions repo", () => {
    const reader = makeReader(
      {
        "package.json": JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }),
        "package-lock.json": "{}",
      },
      {
        ".": [".github", "package.json", "package-lock.json"],
        ".github/workflows": ["codex-review.yaml", "tests.yaml"],
      },
    );

    const facts = detect(reader);
    expect(facts.languages).toEqual(["javascript", "typescript"]);
    expect(facts.packageManagers).toEqual(["npm"]);
    expect(facts.testRunners).toContain("vitest");
    expect(facts.ciProvider).toBe("github-actions");
    expect(facts.hasGitHubActions).toBe(true);
    expect(facts.hasCodexReviewWorkflow).toBe(true);
  });

  it("identifies a Python + pytest project", () => {
    const reader = makeReader(
      {
        "pyproject.toml": "[tool.pytest.ini_options]\n",
        "requirements.txt": "requests\n",
      },
      { ".": ["pyproject.toml", "requirements.txt"] },
    );

    const facts = detect(reader);
    expect(facts.languages).toEqual(["python"]);
    expect(facts.packageManagers).toEqual(["pip"]);
    expect(facts.testRunners).toContain("pytest");
    expect(facts.ciProvider).toBe("none");
  });

  it("flags shell when *.sh files are present at the top level", () => {
    const reader = makeReader({}, { ".": ["build.sh", "deploy.sh"] });
    const facts = detect(reader);
    expect(facts.languages).toContain("shell");
  });

  it("returns a polyglot result for a Go + Rust monorepo", () => {
    const reader = makeReader(
      { "go.mod": "module x\n", "Cargo.toml": "[package]\n" },
      { ".": ["go.mod", "Cargo.toml"] },
    );
    const facts = detect(reader);
    expect(facts.languages).toEqual(["go", "rust"]);
    expect([...facts.packageManagers].sort()).toEqual(["cargo", "go-modules"]);
    expect(facts.testRunners).toEqual(["cargo-test", "go-test"]);
  });

  it("propagates fork-PR posture and contributor count from opts", () => {
    const reader = makeReader({}, { ".": [] });
    const facts = detect(reader, {
      contributorCount: 12,
      forkPostureSignal: "fork-prs-observed",
      recentDiffSizes: [4096, 8192],
    });
    expect(facts.contributorCount).toBe(12);
    expect(facts.forkPostureSignal).toBe("fork-prs-observed");
    expect(facts.recentDiffSizes).toEqual([4096, 8192]);
  });

  it("detects gitlab-ci as a fallback when GitHub Actions is absent", () => {
    const reader = makeReader({ ".gitlab-ci.yml": "stages: []\n" }, { ".": [".gitlab-ci.yml"] });
    expect(detect(reader).ciProvider).toBe("gitlab-ci");
  });
});
