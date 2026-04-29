import { describe, expect, it } from "vitest";

import { findHits, runCli } from "./verify-prose-style.js";

describe("findHits", () => {
  it("flags a single UK word in prose", () => {
    const hits = findHits("test.md", "the organisation publishes");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.word).toBe("organisation");
    expect(hits[0]?.line).toBe(1);
    expect(hits[0]?.column).toBe(5);
  });

  it("flags 'cancelling' but leaves 'cancellation' alone (correct in both dialects)", () => {
    const hits = findHits(
      "test.md",
      "policy for cancelling runs causes cancellation",
    );
    expect(hits.map((h) => h.word)).toEqual(["cancelling"]);
  });

  it("flags every UK form on a multi-word line", () => {
    const hits = findHits(
      "test.md",
      "Prompt injection defences (backtick neutralisation, dynamic fencing, untrusted-data labelling)",
    );
    expect(hits.map((h) => h.word)).toEqual([
      "defences",
      "neutralisation",
      "labelling",
    ]);
  });

  it("reports the correct line for hits across multiple lines", () => {
    const content = [
      "clean line",
      "the organisation",
      "another",
      "with behaviour",
    ].join("\n");
    const hits = findHits("test.md", content);
    expect(hits.map((h) => ({ line: h.line, word: h.word }))).toEqual([
      { line: 2, word: "organisation" },
      { line: 4, word: "behaviour" },
    ]);
  });

  it("does not flag US English nouns that share a UK verb stem", () => {
    // -ism / -ist nouns that are correct in US English. Each shares a stem with
    // a UK -ise verb in UK_PATTERNS but does not match the verb-form regex
    // because the noun suffix is not in the alternation list.
    const text = [
      "criticism",
      "criticisms",
      "optimism",
      "optimist",
      "optimists",
      "specialist",
      "specialists",
      "finalist",
      "finalists",
      "generalist",
      "generalists",
      "modernism",
      "modernist",
      "modernists",
      "pluralism",
      "pluralist",
      "pluralists",
      "astigmatism",
      "theorist",
      "theorists",
      "materialism",
      "materialist",
      "metabolism",
      "militarism",
      "militarist",
      "nationalism",
      "nationalist",
      "naturalism",
      "naturalist",
      "rationalism",
      "rationalist",
      "socialism",
      "socialist",
      "symbolism",
      "symbolist",
      "terrorism",
      "terrorist",
      "organism",
      "organisms",
      "organist",
      "organists",
      "minimist",
      "emphasis",
      "emphases",
    ].join(" ");
    expect(findHits("test.md", text)).toEqual([]);
  });

  it("does not flag 'programmer', 'programmers', 'programmed', or 'programming'", () => {
    // The UK noun is "programme" (and plural "programmes"); the verb forms
    // "programmed", "programming", "programmer", "programmers" are correct in
    // both dialects and must not match.
    const hits = findHits(
      "test.md",
      "the programmer programmed the programming language; programmers everywhere",
    );
    expect(hits).toEqual([]);
  });

  it("flags the UK noun 'programme' and its plural", () => {
    const hits = findHits(
      "test.md",
      "the TV programme had two programmes scheduled",
    );
    expect(hits.map((h) => h.word)).toEqual(["programme", "programmes"]);
  });

  it("flags UK -ise verb forms while leaving US English nouns alone", () => {
    const hits = findHits(
      "test.md",
      "We organise around criticism, but we organised the criticisms; emphasising the emphasis matters",
    );
    expect(hits.map((h) => h.word)).toEqual([
      "organise",
      "organised",
      "emphasising",
    ]);
  });

  it("returns empty for clean US English text", () => {
    const hits = findHits(
      "test.md",
      "the organization prioritizes neutralization, labeling, and defenses against canceling threats",
    );
    expect(hits).toEqual([]);
  });

  it("returns empty for empty content", () => {
    expect(findHits("empty.md", "")).toEqual([]);
  });

  it("flags doubled-consonant verb forms", () => {
    const hits = findHits(
      "test.md",
      "labelling travelling modelling signalling fuelling levelling totalling focussing",
    );
    expect(hits.map((h) => h.word)).toEqual([
      "labelling",
      "travelling",
      "modelling",
      "signalling",
      "fuelling",
      "levelling",
      "totalling",
      "focussing",
    ]);
  });

  it("flags -re forms (centre, theatre, fibre, calibre)", () => {
    const hits = findHits(
      "test.md",
      "the centre theatre with fibre and calibre",
    );
    expect(hits.map((h) => h.word)).toEqual([
      "centre",
      "theatre",
      "fibre",
      "calibre",
    ]);
  });

  it("matches case-insensitively", () => {
    const hits = findHits("test.md", "the Organisation publishes");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.word).toBe("Organisation");
  });
});

describe("runCli", () => {
  it("returns 0 and writes nothing when every file is clean", () => {
    const errs: string[] = [];
    const exit = runCli({
      gitLsFiles: () => ["clean.md"],
      readSource: () => "no UK words here",
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(exit).toBe(0);
    expect(errs).toEqual([]);
  });

  it("returns 1 and reports file:line:column when hits are found", () => {
    const errs: string[] = [];
    const exit = runCli({
      gitLsFiles: () => ["dirty.md"],
      readSource: () => "the organisation",
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(exit).toBe(1);
    const out = errs.join("");
    expect(out).toContain("dirty.md:1:5:");
    expect(out).toContain("organisation");
    expect(out).toContain("Found 1 UK English match.");
  });

  it("excludes EXCLUDE_PATHS from scanning entirely", () => {
    const errs: string[] = [];
    const exit = runCli({
      gitLsFiles: () => [
        "package-lock.json",
        "scripts/verify-prose-style.ts",
        "scripts/verify-prose-style.test.ts",
      ],
      readSource: () => "minimist organisation behaviour",
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(exit).toBe(0);
    expect(errs).toEqual([]);
  });

  it("uses plural 'matches' when the count is greater than one", () => {
    const errs: string[] = [];
    runCli({
      gitLsFiles: () => ["a.md", "b.md"],
      readSource: () => "the organisation and the behaviour",
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(errs.join("")).toContain("Found 4 UK English matches.");
  });

  it("aggregates hits across multiple files", () => {
    const errs: string[] = [];
    const exit = runCli({
      gitLsFiles: () => ["one.md", "two.md"],
      readSource: (p) => (p === "one.md" ? "the colour" : "the behaviour"),
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(exit).toBe(1);
    const out = errs.join("");
    expect(out).toContain("one.md:");
    expect(out).toContain("two.md:");
  });

  it("includes EXTRA_FILES (e.g. CODEOWNERS) and dedupes against FILE_PATTERNS", () => {
    const errs: string[] = [];
    const calls: string[][] = [];
    const exit = runCli({
      gitLsFiles: (...patterns: string[]) => {
        calls.push(patterns);
        if (patterns.includes(".github/CODEOWNERS")) {
          return [".github/CODEOWNERS"];
        }
        return ["clean.md"];
      },
      readSource: (p) =>
        p === ".github/CODEOWNERS" ? "# the colour" : "clean prose",
      stderrWrite: (c) => {
        errs.push(c);
      },
    });
    expect(exit).toBe(1);
    expect(errs.join("")).toContain(".github/CODEOWNERS:");
    expect(calls.some((args) => args.includes(".github/CODEOWNERS"))).toBe(
      true,
    );
  });
});
