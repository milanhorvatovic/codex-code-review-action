import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const INVARIANTS_PATH = resolve(HERE, "invariants.md");
const CONSUMER_CONTROLS_PATH = resolve(REPO_ROOT, "docs", "consumer-controls.md");

const ID_PATTERN = /\| (CC-\d{2}) \|/g;
const HEADING_PATTERN = /^### (\d+)\. /gm;

function readIds(): string[] {
  const text = readFileSync(INVARIANTS_PATH, "utf-8");
  const ids = new Set<string>();
  for (const match of text.matchAll(ID_PATTERN)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort();
}

function readHeadingNumbers(): number[] {
  const text = readFileSync(CONSUMER_CONTROLS_PATH, "utf-8");
  const numbers = new Set<number>();
  for (const match of text.matchAll(HEADING_PATTERN)) {
    const raw = match[1];
    if (raw !== undefined) numbers.add(Number(raw));
  }
  return [...numbers].sort((a, b) => a - b);
}

describe("invariants ↔ docs/consumer-controls.md consistency", () => {
  it("encodes IDs CC-01 through CC-09", () => {
    expect(readIds()).toEqual([
      "CC-01",
      "CC-02",
      "CC-03",
      "CC-04",
      "CC-05",
      "CC-06",
      "CC-07",
      "CC-08",
      "CC-09",
    ]);
  });

  it("docs/consumer-controls.md still numbers items 1 through 9", () => {
    const numbers = readHeadingNumbers();
    expect(numbers).toContain(1);
    expect(numbers).toContain(2);
    expect(numbers).toContain(3);
    expect(numbers).toContain(4);
    expect(numbers).toContain(5);
    expect(numbers).toContain(6);
    expect(numbers).toContain(7);
    expect(numbers).toContain(8);
    expect(numbers).toContain(9);
  });

  it("each CC-NN id has a corresponding numbered heading", () => {
    const ids = readIds();
    const headingNumbers = new Set(readHeadingNumbers());
    for (const id of ids) {
      const num = Number(id.slice(3));
      expect(headingNumbers, `expected heading "### ${num}." for ${id}`).toContain(num);
    }
  });
});
