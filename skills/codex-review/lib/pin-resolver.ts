export type PinResolution = {
  sha: string;
  tag: string;
};

export type GhExec = (args: ReadonlyArray<string>) => { code: number; stderr: string; stdout: string };

const ACTION_REPO = "milanhorvatovic/codex-ai-code-review-action";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PRE_RELEASE = /-(rc|beta|alpha|pre|next)\b/i;
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

export class PinResolutionError extends Error {
  override name = "PinResolutionError";
}

export function resolvePin(gh: GhExec): PinResolution {
  const tagResult = gh(["api", `repos/${ACTION_REPO}/releases/latest`, "--jq", ".tag_name"]);
  if (tagResult.code !== 0) {
    throw new PinResolutionError(
      `gh api repos/${ACTION_REPO}/releases/latest exited ${tagResult.code}: ${tagResult.stderr.trim()}`,
    );
  }
  const tag = tagResult.stdout.trim();
  if (tag.length === 0) {
    throw new PinResolutionError("releases/latest returned an empty tag_name");
  }
  if (!TAG_PATTERN.test(tag)) {
    throw new PinResolutionError(`releases/latest returned malformed tag '${tag}'`);
  }
  if (PRE_RELEASE.test(tag)) {
    throw new PinResolutionError(`refusing pre-release tag '${tag}' as the default for adopt`);
  }

  const shaResult = gh(["api", `repos/${ACTION_REPO}/commits/${tag}`, "--jq", ".sha"]);
  if (shaResult.code !== 0) {
    throw new PinResolutionError(
      `gh api repos/${ACTION_REPO}/commits/${tag} exited ${shaResult.code}: ${shaResult.stderr.trim()}`,
    );
  }
  const sha = shaResult.stdout.trim();
  if (!SHA_PATTERN.test(sha)) {
    throw new PinResolutionError(`commits/${tag} returned malformed SHA '${sha}'`);
  }
  return { sha, tag };
}
