import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Hit = {
  file: string;
  line: number;
  column: number;
  word: string;
};

// Regex source strings, each matching a complete UK English word (the
// `COMBINED_PATTERN` below anchors them with `^...$`). Anchored matching
// eliminates the class of false positives where a UK `-ise` verb stem appears
// inside a correct US English noun (e.g. "criticism" contains "criticis";
// "organism" contains "organis"; "programmer" contains "programme") — those
// nouns simply do not match the verb-form alternatives listed here.
export const UK_PATTERNS: readonly string[] = [
  // -our (UK) → -or (US)
  "behaviour(?:s|al|ally|ism|ist|ists)?",
  "colour(?:s|ed|ing|ful|fully|less|ist|ists)?",
  "favour(?:s|ed|ing|able|ably|ite|ites|itism)?",
  "honour(?:s|ed|ing|able|ably)?",
  "labour(?:s|ed|ing|er|ers|ite|ites)?",
  "neighbour(?:s|ly|hood|hoods|ing|ed)?",
  "harbour(?:s|ed|ing)?",
  "humour(?:s|ed|ing|ist|ists|less)?",
  "rumour(?:s|ed|ing)?",
  "vapour(?:s|ed|ing|ish|y)?",
  "savour(?:s|ed|ing|y|ies)?",
  "valour",
  "vigour(?:s)?",
  "armour(?:s|ed|ing|y|er|ers)?",
  "endeavour(?:s|ed|ing)?",
  "flavour(?:s|ed|ing|ful|fully|less|some|ist|ists)?",
  "splendour(?:s)?",
  "demeanour(?:s)?",

  // -ce (UK noun) → -se (US noun): "defence"/"defense", "offence"/"offense",
  // "pretence"/"pretense", "licence"/"license". The corresponding US verb
  // forms ("license", "defense" used as a verb, etc.) deliberately remain
  // unflagged.
  "defence(?:s|less|lessness)?",
  "offence(?:s|less)?",
  "pretence(?:s)?",
  "licence(?:s|d)?",

  // -ise (UK verb) → -ice (US verb): "practise"/"practice". Note this is the
  // inverse of the noun rule above — UK uses "practice" for the noun and
  // "practise" for the verb; US uses "practice" for both. Only the UK verb
  // form is flagged.
  "practise(?:s|d|ing)?",

  // standalone UK words and inflections
  "whilst",
  "amongst",
  "amidst",
  "enquir(?:e|es|ed|ing|y|ies)",
  "artefact(?:s|ual)?",
  "aluminium",
  "mould(?:s|ed|ing|y|able)?",
  "plough(?:s|ed|ing|man|men|share)?",

  // -t past tense (UK) — single-form
  "learnt",
  "spelt",
  "dreamt",
  "burnt",
  "leapt",
  "knelt",
  "smelt",
  "spilt",

  // -wards (UK; US drops the trailing 's')
  "backwards",
  "forwards",
  "upwards",
  "downwards",

  // -ise (UK) verb family — verb forms only.
  // Crucially, these patterns do NOT match the corresponding -ism/-ist nouns
  // ("criticism", "optimism", "specialist", "theorist", "materialism",
  // "metabolism", "militarism", "nationalism", "naturalism", "pluralism",
  // "rationalism", "socialism", "symbolism", "terrorism", "modernism",
  // "astigmatism", "organism", "organist", "optimist", "finalist",
  // "generalist", "minimist") which are correct in US English.
  "organis(?:e|es|ed|ing|ation|ations|ational|er|ers|able)",
  "prioritis(?:e|es|ed|ing|ation)",
  "customis(?:e|es|ed|ing|ation|ations|able|er|ers)",
  "optimis(?:e|es|ed|ing|ation|ations|er|ers|able)",
  "recognis(?:e|es|ed|ing|able|ably)",
  "emphasis(?:e|es|ed|ing)",
  "categoris(?:e|es|ed|ing|ation|ations)",
  "standardis(?:e|es|ed|ing|ation|ations)",
  "summaris(?:e|es|ed|ing|ation)",
  "specialis(?:e|es|ed|ing|ation|ations)",
  "finalis(?:e|es|ed|ing|ation)",
  "normalis(?:e|es|ed|ing|ation)",
  "serialis(?:e|es|ed|ing|ation)",
  "initialis(?:e|es|ed|ing|ation)",
  "generalis(?:e|es|ed|ing|ation|ations)",
  "modernis(?:e|es|ed|ing|ation)",
  "criticis(?:e|es|ed|ing|able)",
  "harmonis(?:e|es|ed|ing|ation)",
  "maximis(?:e|es|ed|ing|ation)",
  "minimis(?:e|es|ed|ing|ation)",
  "mobilis(?:e|es|ed|ing|ation)",
  "neutralis(?:e|es|ed|ing|ation|er|ers)",
  "patronis(?:e|es|ed|ing|ingly)",
  "pluralis(?:e|es|ed|ing|ation)",
  "privatis(?:e|es|ed|ing|ation)",
  "randomis(?:e|es|ed|ing|ation)",
  "sanitis(?:e|es|ed|ing|ation|er|ers)",
  "scrutinis(?:e|es|ed|ing)",
  "stabilis(?:e|es|ed|ing|ation|er|ers)",
  "sterilis(?:e|es|ed|ing|ation|er|ers)",
  "stigmatis(?:e|es|ed|ing|ation)",
  "subsidis(?:e|es|ed|ing|ation)",
  "sympathis(?:e|es|ed|ing|er|ers)",
  "synchronis(?:e|es|ed|ing|ation)",
  "systematis(?:e|es|ed|ing|ation)",
  "theoris(?:e|es|ed|ing)",
  "utilis(?:e|es|ed|ing|ation|er|ers)",
  "visualis(?:e|es|ed|ing|ation)",
  "incentivis(?:e|es|ed|ing)",
  "materialis(?:e|es|ed|ing|ation)",
  "memoris(?:e|es|ed|ing)",
  "metabolis(?:e|es|ed|ing)",
  "militaris(?:e|es|ed|ing|ation)",
  "nationalis(?:e|es|ed|ing|ation)",
  "naturalis(?:e|es|ed|ing|ation)",
  "personalis(?:e|es|ed|ing|ation)",
  "polaris(?:e|es|ed|ing|ation)",
  "rationalis(?:e|es|ed|ing|ation)",
  "reorganis(?:e|es|ed|ing|ation|ations)",
  "revolutionis(?:e|es|ed|ing)",
  "sensitis(?:e|es|ed|ing)",
  "signalis(?:e|es|ed|ing)",
  "socialis(?:e|es|ed|ing|ation)",
  "symbolis(?:e|es|ed|ing)",
  "tantalis(?:e|es|ed|ing|ingly)",
  "terroris(?:e|es|ed|ing)",
  "unionis(?:e|es|ed|ing|ation)",
  "urbanis(?:e|es|ed|ing|ation)",

  // doubled-consonant verb forms (UK; US drops one consonant)
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

  // -re (UK) → -er (US)
  "centre(?:s|d|piece|pieces|line|lines|fold|folds)?",
  "fibre(?:s|board|glass|optic)?",
  "theatre(?:s|goer|goers|going)?",
  "calibre(?:s)?",

  // -mme / -gement / other UK-only.
  // "programme(?:s)?" matches the UK noun and its plural only — NOT
  // "programmer", "programmers", "programmed", or "programming", all of which
  // are correct in US English (and in UK English, in the verb sense).
  "programme(?:s)?",
  "judgement(?:s|al)?",
  "acknowledgement(?:s)?",
  "tyre(?:s|d)?",
  "kerb(?:s|ed|ing|side|stone|stones)?",
  "cheque(?:s|book|books)?",
  "enrolment(?:s)?",
  "fulfilment(?:s)?",
  "instalment(?:s)?",
  "skilful(?:ly|ness)?",
  "wilful(?:ly|ness)?",
];

// Reserved for proper nouns and external identifiers whose canonical spelling
// is the UK form (e.g. "Labour" the political party, "Polaris" the star).
// Empty by default — the anchored regex matching in UK_PATTERNS already
// excludes shared US English nouns like "organism", "optimist", and
// "minimist" without needing them listed here. Add lowercased entries if a
// proper noun later appears in repository prose.
export const ALLOWED_WORDS: ReadonlySet<string> = new Set<string>([]);

// Paths excluded from scanning.
// - package-lock.json: machine-generated; npm package names are noise.
// - this script and its test: contain UK regex sources as data, not prose.
export const EXCLUDE_PATHS: ReadonlySet<string> = new Set([
  "package-lock.json",
  "scripts/verify-prose-style.test.ts",
  "scripts/verify-prose-style.ts",
]);

// Glob patterns for `git ls-files`. Curated, not exhaustive: covers the file
// types where prose actually lives in this repository. `.js` is intentionally
// omitted (the only tracked `*.js` files are bundled artifacts in `dist/`,
// derived from `.ts` source which is already audited). Any tracked extension
// that does not appear here is unscanned by design — extend this list (or
// EXTRA_FILES below) when adding a new prose-bearing file type.
export const FILE_PATTERNS: readonly string[] = [
  "*.gitignore",
  "*.json",
  "*.md",
  "*.mjs",
  "*.sh",
  "*.toml",
  "*.ts",
  "*.yaml",
];

// Extensionless tracked files that the FILE_PATTERNS globs cannot reach.
// `LICENSE` is a verbatim third-party text and is deliberately not included.
export const EXTRA_FILES: readonly string[] = [".github/CODEOWNERS"];

const COMBINED_PATTERN = new RegExp(
  `^(?:${UK_PATTERNS.join("|")})$`,
  "i",
);
// Pure-alphabetic tokens. Splitting on hyphens, apostrophes (straight and
// curly), underscores, and any other non-letter character is deliberate:
// "organisation's", "organisation-wide", "_organisation_" all tokenize to a
// bare "organisation", which the anchored COMBINED_PATTERN can then match. UK
// patterns never legitimately include punctuation, so widening the token to
// cover hyphens/apostrophes (the previous behavior) only created false
// negatives on possessive and hyphenated forms.
const WORD_PATTERN = /[A-Za-z]+/g;

export function findHits(file: string, content: string): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const wordMatch of line.matchAll(WORD_PATTERN)) {
      const word = wordMatch[0];
      if (ALLOWED_WORDS.has(word.toLowerCase())) continue;
      if (!COMBINED_PATTERN.test(word)) continue;
      hits.push({
        file,
        line: i + 1,
        column: (wordMatch.index ?? 0) + 1,
        word,
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
        `${hit.file}:${hit.line}:${hit.column}: UK English "${hit.word}"\n`,
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
