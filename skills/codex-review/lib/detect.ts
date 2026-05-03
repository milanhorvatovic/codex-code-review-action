export type Language =
  | "go"
  | "java"
  | "javascript"
  | "kotlin"
  | "php"
  | "python"
  | "ruby"
  | "rust"
  | "shell"
  | "typescript";

export type PackageManager =
  | "cargo"
  | "composer"
  | "go-modules"
  | "gradle"
  | "maven"
  | "npm"
  | "pip"
  | "pnpm"
  | "poetry"
  | "rubygems"
  | "yarn";

export type CIProvider = "circleci" | "github-actions" | "gitlab-ci" | "none";

export type ForkPostureSignal = "fork-prs-observed" | "no-fork-prs-observed" | "unknown";

export type RepoFacts = {
  ciProvider: CIProvider;
  contributorCount: number | "unknown";
  forkPostureSignal: ForkPostureSignal;
  hasCodexReviewWorkflow: boolean;
  hasGitHubActions: boolean;
  languages: ReadonlyArray<Language>;
  packageManagers: ReadonlyArray<PackageManager>;
  recentDiffSizes: ReadonlyArray<number>;
  testRunners: ReadonlyArray<string>;
};

export type RepoReader = {
  exists: (path: string) => boolean;
  listFiles: (dir: string) => ReadonlyArray<string>;
  readFile: (path: string) => string;
};

const LANG_FILES: ReadonlyArray<{ files: ReadonlyArray<string>; languages: ReadonlyArray<Language> }> = [
  { files: ["package.json"], languages: ["javascript", "typescript"] },
  { files: ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py"], languages: ["python"] },
  { files: ["Cargo.toml"], languages: ["rust"] },
  { files: ["go.mod"], languages: ["go"] },
  { files: ["Gemfile"], languages: ["ruby"] },
  { files: ["composer.json"], languages: ["php"] },
  { files: ["pom.xml"], languages: ["java"] },
  { files: ["build.gradle", "build.gradle.kts"], languages: ["java", "kotlin"] },
];

const PM_FILES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: "Cargo.toml", manager: "cargo" },
  { file: "composer.json", manager: "composer" },
  { file: "go.mod", manager: "go-modules" },
  { file: "build.gradle", manager: "gradle" },
  { file: "build.gradle.kts", manager: "gradle" },
  { file: "pom.xml", manager: "maven" },
  { file: "package-lock.json", manager: "npm" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "poetry.lock", manager: "poetry" },
  { file: "requirements.txt", manager: "pip" },
  { file: "Gemfile.lock", manager: "rubygems" },
  { file: "yarn.lock", manager: "yarn" },
];

function detectLanguagesAndShell(reader: RepoReader): { languages: Language[]; hasShell: boolean } {
  const found = new Set<Language>();
  for (const entry of LANG_FILES) {
    if (entry.files.some((f) => reader.exists(f))) {
      for (const language of entry.languages) found.add(language);
    }
  }
  const topLevel = safeListFiles(reader, ".");
  const hasShell = topLevel.some((f) => f.endsWith(".sh"));
  if (hasShell) found.add("shell");
  return { languages: [...found].sort(), hasShell };
}

function detectPackageManagers(reader: RepoReader): PackageManager[] {
  const found = new Set<PackageManager>();
  for (const entry of PM_FILES) {
    if (reader.exists(entry.file)) found.add(entry.manager);
  }
  return [...found].sort();
}

function detectTestRunners(reader: RepoReader, languages: ReadonlyArray<Language>): string[] {
  const runners = new Set<string>();
  if (reader.exists("package.json")) {
    const pkg = safeReadJson(reader, "package.json");
    const all = {
      ...((pkg as { dependencies?: Record<string, string> }).dependencies ?? {}),
      ...((pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {}),
    };
    if ("vitest" in all) runners.add("vitest");
    if ("jest" in all) runners.add("jest");
    if ("mocha" in all) runners.add("mocha");
    if ("playwright" in all || "@playwright/test" in all) runners.add("playwright");
  }
  if (languages.includes("python")) {
    if (reader.exists("pytest.ini") || matchesPyproject(reader, "pytest")) runners.add("pytest");
    if (reader.exists("tox.ini")) runners.add("tox");
  }
  if (languages.includes("go")) runners.add("go-test");
  if (languages.includes("rust")) runners.add("cargo-test");
  return [...runners].sort();
}

function matchesPyproject(reader: RepoReader, marker: string): boolean {
  if (!reader.exists("pyproject.toml")) return false;
  return reader.readFile("pyproject.toml").includes(marker);
}

function detectCIProvider(reader: RepoReader): { provider: CIProvider; hasCodexReviewWorkflow: boolean } {
  const workflowDir = ".github/workflows";
  const hasGhActions = reader.exists(workflowDir);
  if (hasGhActions) {
    const files = safeListFiles(reader, workflowDir);
    const hasCodexReviewWorkflow = files.some((f) => /codex.*review.*\.yaml$/i.test(f));
    return { provider: "github-actions", hasCodexReviewWorkflow };
  }
  if (reader.exists(".gitlab-ci.yml") || reader.exists(".gitlab-ci.yaml")) {
    return { provider: "gitlab-ci", hasCodexReviewWorkflow: false };
  }
  if (reader.exists(".circleci/config.yml") || reader.exists(".circleci/config.yaml")) {
    return { provider: "circleci", hasCodexReviewWorkflow: false };
  }
  return { provider: "none", hasCodexReviewWorkflow: false };
}

function safeReadJson(reader: RepoReader, path: string): unknown {
  try {
    return JSON.parse(reader.readFile(path)) as unknown;
  } catch {
    return {};
  }
}

function safeListFiles(reader: RepoReader, dir: string): ReadonlyArray<string> {
  try {
    return reader.listFiles(dir);
  } catch {
    return [];
  }
}

export function detect(
  reader: RepoReader,
  opts: { contributorCount?: number; forkPostureSignal?: ForkPostureSignal; recentDiffSizes?: ReadonlyArray<number> } = {},
): RepoFacts {
  const { languages } = detectLanguagesAndShell(reader);
  const packageManagers = detectPackageManagers(reader);
  const { provider, hasCodexReviewWorkflow } = detectCIProvider(reader);
  const testRunners = detectTestRunners(reader, languages);
  return {
    ciProvider: provider,
    contributorCount: opts.contributorCount ?? "unknown",
    forkPostureSignal: opts.forkPostureSignal ?? "unknown",
    hasCodexReviewWorkflow,
    hasGitHubActions: provider === "github-actions",
    languages,
    packageManagers,
    recentDiffSizes: opts.recentDiffSizes ?? [],
    testRunners,
  };
}
