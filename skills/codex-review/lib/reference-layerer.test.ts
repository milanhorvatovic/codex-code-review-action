import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { layerReference, listSections, pickSectionsForLanguages } from "./reference-layerer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = resolve(HERE, "..", "..", "..", "defaults", "review-reference.md");

function defaults(): string {
  return readFileSync(DEFAULTS_PATH, "utf-8");
}

describe("listSections", () => {
  it("enumerates the H3 sections in defaults/review-reference.md", () => {
    const sections = listSections(defaults());
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("Python");
    expect(headings).toContain("JavaScript / TypeScript");
    expect(headings).toContain("Go");
    expect(headings).toContain("YAML / Configuration");
  });
});

describe("pickSectionsForLanguages", () => {
  it("returns Python plus the always-include sections for a Python repo", () => {
    const picked = pickSectionsForLanguages(defaults(), ["python"]).map((s) => s.heading);
    expect(picked.some((h) => h.startsWith("Python"))).toBe(true);
    expect(picked.some((h) => h.startsWith("YAML / Configuration"))).toBe(true);
    expect(picked.some((h) => h.startsWith("Markdown"))).toBe(true);
    expect(picked.some((h) => h.startsWith("Go"))).toBe(false);
  });

  it("returns JavaScript/TypeScript for a typescript repo", () => {
    const picked = pickSectionsForLanguages(defaults(), ["typescript"]).map((s) => s.heading);
    expect(picked.some((h) => h.startsWith("JavaScript / TypeScript"))).toBe(true);
  });

  it("includes all the language sections for a polyglot repo", () => {
    const picked = pickSectionsForLanguages(defaults(), ["go", "rust", "shell"]).map((s) => s.heading);
    expect(picked.some((h) => h.startsWith("Go"))).toBe(true);
    expect(picked.some((h) => h.startsWith("Rust"))).toBe(true);
    expect(picked.some((h) => h.startsWith("Shell scripts"))).toBe(true);
  });
});

describe("layerReference", () => {
  it("emits a header containing the consent guidance and the picked sections", () => {
    const out = layerReference(defaults(), { languages: ["typescript"], projectName: "demo-repo" });
    expect(out).toContain("# Review reference — demo-repo");
    expect(out.toLowerCase()).toContain("not wired into the workflow");
    expect(out).toContain("### JavaScript / TypeScript");
  });

  it("does not include sections for languages absent from the input", () => {
    const out = layerReference(defaults(), { languages: ["python"], projectName: "py-repo" });
    expect(out).toContain("### Python");
    expect(out).not.toContain("### Go");
    expect(out).not.toContain("### Rust");
  });
});
