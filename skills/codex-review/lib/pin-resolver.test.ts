import { describe, expect, it } from "vitest";

import { PinResolutionError, resolvePin, type GhExec } from "./pin-resolver.js";

function fakeGh(map: Record<string, { code?: number; stderr?: string; stdout: string }>): GhExec {
  return (args) => {
    const key = args.join(" ");
    const entry = map[key];
    if (entry === undefined) {
      return { code: 1, stderr: `unmocked: ${key}`, stdout: "" };
    }
    return { code: entry.code ?? 0, stderr: entry.stderr ?? "", stdout: entry.stdout };
  };
}

describe("resolvePin", () => {
  it("returns the latest tag and SHA", () => {
    const gh = fakeGh({
      "api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq .tag_name": { stdout: "v2.1.0\n" },
      "api repos/milanhorvatovic/codex-ai-code-review-action/commits/v2.1.0 --jq .sha": {
        stdout: "1111111111111111111111111111111111111111\n",
      },
    });
    const pin = resolvePin(gh);
    expect(pin).toEqual({ sha: "1111111111111111111111111111111111111111", tag: "v2.1.0" });
  });

  it("refuses a pre-release tag", () => {
    const gh = fakeGh({
      "api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq .tag_name": {
        stdout: "v2.1.0-rc.1\n",
      },
    });
    expect(() => resolvePin(gh)).toThrow(PinResolutionError);
  });

  it("refuses a malformed tag", () => {
    const gh = fakeGh({
      "api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq .tag_name": { stdout: "latest\n" },
    });
    expect(() => resolvePin(gh)).toThrow(/malformed tag/);
  });

  it("refuses a malformed SHA", () => {
    const gh = fakeGh({
      "api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq .tag_name": { stdout: "v2.1.0\n" },
      "api repos/milanhorvatovic/codex-ai-code-review-action/commits/v2.1.0 --jq .sha": { stdout: "abcd\n" },
    });
    expect(() => resolvePin(gh)).toThrow(/malformed SHA/);
  });

  it("surfaces a non-zero gh exit code", () => {
    const gh = fakeGh({
      "api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq .tag_name": {
        code: 1,
        stderr: "401 Unauthorized",
        stdout: "",
      },
    });
    expect(() => resolvePin(gh)).toThrow(/releases\/latest exited 1: 401 Unauthorized/);
  });
});
