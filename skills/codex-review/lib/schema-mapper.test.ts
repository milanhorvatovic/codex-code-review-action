import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyTrust, findInput, mapSchema, parseManifest } from "./schema-mapper.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, "..", "__fixtures__", "repos", "codex-review-action");

function readFixture(path: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, path), "utf-8");
}

describe("classifyTrust", () => {
  it("flags openai-api-key as secret", () => {
    expect(classifyTrust("openai-api-key")).toBe("secret");
  });

  it("flags review-reference-file as policy", () => {
    expect(classifyTrust("review-reference-file")).toBe("policy");
  });

  it("flags max-chunk-bytes as tuning", () => {
    expect(classifyTrust("max-chunk-bytes")).toBe("tuning");
  });

  it("falls back to wiring for unknown names", () => {
    expect(classifyTrust("some-future-input")).toBe("wiring");
  });
});

describe("parseManifest", () => {
  it("parses prepare/action.yaml inputs", () => {
    const inputs = parseManifest(readFixture("prepare/action.yaml"));
    const names = inputs.map((i) => i.name).sort();
    expect(names).toEqual(["allow-users", "github-token", "max-chunk-bytes", "review-reference-file"]);

    const allowUsers = inputs.find((i) => i.name === "allow-users");
    expect(allowUsers?.required).toBe(false);
    expect(allowUsers?.default).toBe("");
    expect(allowUsers?.trustClass).toBe("policy");
  });

  it("parses review/action.yaml inputs and keeps required: true", () => {
    const inputs = parseManifest(readFixture("review/action.yaml"));
    const names = inputs.map((i) => i.name).sort();
    expect(names).toEqual(["chunk", "effort", "model", "openai-api-key"]);

    const chunk = inputs.find((i) => i.name === "chunk");
    expect(chunk?.required).toBe(true);

    const apiKey = inputs.find((i) => i.name === "openai-api-key");
    expect(apiKey?.trustClass).toBe("secret");
  });

  it("parses publish/action.yaml inputs including fail-on-missing-chunks", () => {
    const inputs = parseManifest(readFixture("publish/action.yaml"));
    const names = inputs.map((i) => i.name).sort();
    expect(names).toContain("fail-on-missing-chunks");
    expect(names).toContain("retain-findings");
    expect(names).toContain("min-confidence");

    const failOn = inputs.find((i) => i.name === "fail-on-missing-chunks");
    expect(failOn?.default).toBe("false");
    expect(failOn?.trustClass).toBe("tuning");
  });

  it("returns an empty list when no inputs: section is present", () => {
    expect(parseManifest("name: x\nruns:\n  using: composite\n")).toEqual([]);
  });
});

describe("mapSchema", () => {
  it("composes prepare/review/publish into one schema", () => {
    const schema = mapSchema(
      { readFile: (p) => readFileSync(p, "utf-8") },
      {
        prepare: resolve(FIXTURE_ROOT, "prepare/action.yaml"),
        publish: resolve(FIXTURE_ROOT, "publish/action.yaml"),
        review: resolve(FIXTURE_ROOT, "review/action.yaml"),
      },
    );
    expect(schema.prepare.length).toBeGreaterThan(0);
    expect(schema.review.length).toBeGreaterThan(0);
    expect(schema.publish.length).toBeGreaterThan(0);

    const found = findInput(schema, "publish", "fail-on-missing-chunks");
    expect(found?.default).toBe("false");
    expect(findInput(schema, "publish", "no-such-input")).toBeNull();
  });
});
