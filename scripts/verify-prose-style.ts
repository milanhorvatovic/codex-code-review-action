import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Hit = {
  file: string;
  line: number;
  column: number;
  word: string;
  match: string;
};

// UK substrings. When found inside a word, the entire word is reported as UK English
// unless the word is in ALLOWED_WORDS. Matching is case-insensitive.
export const UK_PATTERNS: readonly string[] = [
  "behaviour",
  "colour",
  "favour",
  "honour",
  "labour",
  "neighbour",
  "harbour",
  "humour",
  "rumour",
  "vapour",
  "savour",
  "valour",
  "vigour",
  "armour",
  "endeavour",
  "flavour",
  "splendour",
  "demeanour",
  "defence",
  "offence",
  "pretence",
  "licence",
  "practise",
  "whilst",
  "amongst",
  "amidst",
  "enquir",
  "artefact",
  "aluminium",
  "mould",
  "plough",
  "learnt",
  "spelt",
  "dreamt",
  "burnt",
  "leapt",
  "knelt",
  "smelt",
  "spilt",
  "backwards",
  "forwards",
  "upwards",
  "downwards",
  "organis",
  "prioritis",
  "customis",
  "optimis",
  "recognis",
  "emphasis",
  "categoris",
  "standardis",
  "summaris",
  "specialis",
  "finalis",
  "normalis",
  "serialis",
  "initialis",
  "generalis",
  "modernis",
  "criticis",
  "harmonis",
  "maximis",
  "minimis",
  "mobilis",
  "neutralis",
  "patronis",
  "pluralis",
  "privatis",
  "randomis",
  "sanitis",
  "scrutinis",
  "stabilis",
  "sterilis",
  "stigmatis",
  "subsidis",
  "sympathis",
  "synchronis",
  "systematis",
  "theoris",
  "utilis",
  "visualis",
  "incentivis",
  "materialis",
  "memoris",
  "metabolis",
  "militaris",
  "nationalis",
  "naturalis",
  "personalis",
  "polaris",
  "rationalis",
  "reorganis",
  "revolutionis",
  "sensitis",
  "signalis",
  "socialis",
  "symbolis",
  "tantalis",
  "terroris",
  "unionis",
  "urbanis",
  "labelling",
  "labelled",
  "cancelling",
  "cancelled",
  "travelling",
  "travelled",
  "modelling",
  "modelled",
  "signalling",
  "signalled",
  "fuelling",
  "fuelled",
  "levelling",
  "levelled",
  "totalling",
  "totalled",
  "focussed",
  "focussing",
  "programme",
  "judgement",
  "acknowledgement",
  "tyre",
  "kerb",
  "cheque",
  "enrolment",
  "fulfilment",
  "instalment",
  "skilful",
  "wilful",
  "centre",
  "fibre",
  "theatre",
  "calibre",
];

// Full words that legitimately contain a UK substring. Keys are lowercase.
// Real US English words: "organism"/"organist" contain "organis"; "optimist"
// contains "optimis". External identifiers (npm package names) keep their
// original spelling.
export const ALLOWED_WORDS: ReadonlySet<string> = new Set([
  "minimist",
  "optimist",
  "optimistic",
  "optimistically",
  "optimists",
  "organism",
  "organisms",
  "organist",
  "organists",
]);

// Paths excluded from scanning.
// - package-lock.json: machine-generated; npm package names ("minimist") are noise.
// - this script and its test: contain UK substrings as data, not prose.
export const EXCLUDE_PATHS: ReadonlySet<string> = new Set([
  "package-lock.json",
  "scripts/verify-prose-style.test.ts",
  "scripts/verify-prose-style.ts",
]);

// Glob patterns for `git ls-files`. Covers every text-bearing file type tracked
// in the repository. JSON config files (`package.json`, `tsconfig.json`) carry
// occasional prose in `description` fields and are worth auditing too. `.js` is
// intentionally omitted: the only tracked `*.js` files are bundled artifacts in
// `dist/`, derived from `.ts` source which is already audited.
export const FILE_PATTERNS: readonly string[] = [
  "*.json",
  "*.md",
  "*.mjs",
  "*.sh",
  "*.toml",
  "*.ts",
  "*.yaml",
];

// Extensionless prose-bearing files that the FILE_PATTERNS globs cannot reach.
// `LICENSE` is a verbatim third-party text and is deliberately not included.
export const EXTRA_FILES: readonly string[] = [".github/CODEOWNERS"];

const COMBINED_PATTERN = new RegExp(`(${UK_PATTERNS.join("|")})`, "i");
const WORD_PATTERN = /[A-Za-z][A-Za-z'-]*/g;

export function findHits(file: string, content: string): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const wordMatch of line.matchAll(WORD_PATTERN)) {
      const word = wordMatch[0];
      if (ALLOWED_WORDS.has(word.toLowerCase())) continue;
      const ukMatch = COMBINED_PATTERN.exec(word);
      if (!ukMatch) continue;
      hits.push({
        file,
        line: i + 1,
        column: (wordMatch.index ?? 0) + 1,
        word,
        match: ukMatch[1] ?? ukMatch[0],
      });
    }
  }
  return hits;
}

function defaultGitLsFiles(...patterns: string[]): string[] {
  const stdout = execFileSync("git", ["ls-files", "--", ...patterns], {
    encoding: "utf-8",
  });
  return stdout.split("\n").filter((s) => s.length > 0);
}

function defaultReadSource(path: string): string {
  return readFileSync(path, "utf-8");
}

function defaultStderrWrite(chunk: string): void {
  process.stderr.write(chunk);
}

export type RunCliDeps = {
  gitLsFiles?: (...patterns: string[]) => string[];
  readSource?: (path: string) => string;
  stderrWrite?: (chunk: string) => void;
};

export function runCli(deps: RunCliDeps = {}): number {
  const lsFiles = deps.gitLsFiles ?? defaultGitLsFiles;
  const readSource = deps.readSource ?? defaultReadSource;
  const writeErr = deps.stderrWrite ?? defaultStderrWrite;

  const tracked = new Set([
    ...lsFiles(...FILE_PATTERNS),
    ...lsFiles(...EXTRA_FILES),
  ]);
  const files = [...tracked].filter((p) => !EXCLUDE_PATHS.has(p)).sort();

  let total = 0;
  for (const file of files) {
    const content = readSource(file);
    for (const hit of findHits(file, content)) {
      writeErr(
        `${hit.file}:${hit.line}:${hit.column}: UK English "${hit.word}" (matched "${hit.match}")\n`,
      );
      total++;
    }
  }

  if (total > 0) {
    const noun = total === 1 ? "match" : "matches";
    writeErr(
      `\nFound ${total} UK English ${noun}. See CONTRIBUTING.md "Documentation tone and style" for the convention.\n`,
    );
    return 1;
  }
  return 0;
}

function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  process.exit(runCli());
}
