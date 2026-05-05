import * as core from "@actions/core";
import { getExecOutput } from "@actions/exec";

export async function fetchBaseSha(
  baseSha: string,
  token: string,
): Promise<void> {
  const check = await getExecOutput("git", [
    "cat-file",
    "-e",
    `${baseSha}^{commit}`,
  ], { ignoreReturnCode: true, silent: true });

  if (check.exitCode !== 0) {
    const authArgs: string[] = [];
    if (token) {
      const credentials = Buffer.from(`x-access-token:${token}`).toString("base64");
      core.setSecret(credentials);
      const host = process.env.GITHUB_SERVER_URL ?? "https://github.com";
      const extraHeader = `AUTHORIZATION: basic ${credentials}`;
      authArgs.push("-c", `http.${host}/.extraheader=${extraHeader}`);
    }

    const isShallow = await getExecOutput("git", [
      "rev-parse",
      "--is-shallow-repository",
    ], { ignoreReturnCode: true, silent: true });

    const shallow = isShallow.stdout.trim() === "true";
    const depthArgs = shallow
      ? ["--deepen=50"]
      : ["--depth=50"];

    await getExecOutput("git", [
      ...authArgs,
      "fetch",
      "--no-tags",
      ...depthArgs,
      "origin",
      baseSha,
    ], { silent: true });
  }
}

export async function buildDiff(
  baseSha: string,
  headSha: string,
): Promise<string> {
  const result = await getExecOutput("git", [
    "diff",
    "--no-color",
    "--unified=3",
    `${baseSha}...${headSha}`,
  ], { silent: true });
  return result.stdout;
}

export interface PathAtSha {
  content: string;
  mode: string;
}

export async function readPathAtSha(sha: string, repoPath: string): Promise<PathAtSha> {
  const lsTree = await getExecOutput(
    "git",
    ["ls-tree", "-z", "--full-tree", sha, "--", repoPath],
    { ignoreReturnCode: true, silent: true },
  );
  if (lsTree.exitCode !== 0) {
    const stderr = lsTree.stderr.trim();
    throw new Error(
      stderr === ""
        ? `git ls-tree failed for '${repoPath}' at ${sha} (exit ${lsTree.exitCode})`
        : `git ls-tree failed for '${repoPath}' at ${sha}: ${stderr}`,
    );
  }
  const stdout = lsTree.stdout.replace(/\0$/, "");
  if (stdout === "") {
    throw new Error(`path '${repoPath}' does not exist at ${sha}`);
  }
  const tabIndex = stdout.indexOf("\t");
  const meta = tabIndex === -1 ? stdout : stdout.slice(0, tabIndex);
  const parts = meta.split(" ");
  const mode = parts[0] ?? "";
  const objectType = parts[1] ?? "";
  const objectId = parts[2] ?? "";
  if (objectType !== "blob") {
    throw new Error(
      `path '${repoPath}' at ${sha} is a ${objectType || "non-blob"}, not a file`,
    );
  }

  const catFile = await getExecOutput(
    "git",
    ["cat-file", "blob", objectId],
    { ignoreReturnCode: true, silent: true },
  );
  if (catFile.exitCode !== 0) {
    const stderr = catFile.stderr.trim();
    throw new Error(
      stderr === ""
        ? `git cat-file failed for blob ${objectId} (exit ${catFile.exitCode})`
        : `git cat-file failed for blob ${objectId}: ${stderr}`,
    );
  }

  return { content: catFile.stdout, mode };
}
