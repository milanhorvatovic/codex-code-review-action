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

    const depthArgs = isShallow.stdout.trim() === "true"
      ? ["--deepen=50"]
      : ["--depth=1"];

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
