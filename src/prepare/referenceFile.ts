import * as fs from "node:fs";
import * as path from "node:path";

import { readPathAtSha } from "../github/git.js";

export const REFERENCE_MAX_BYTES = 64 * 1024;

export class ReviewReferenceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewReferenceFileError";
  }
}

export function validateReviewReferencePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new ReviewReferenceFileError("path is empty");
  }
  if (trimmed.includes("\0")) {
    throw new ReviewReferenceFileError("path contains a NUL byte");
  }
  if (trimmed.includes("\\")) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' contains a backslash; use POSIX separators`,
    );
  }
  if (path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' must be workspace-relative, not absolute`,
    );
  }

  const normalized = path.posix.normalize(trimmed);
  if (normalized === "" || normalized === ".") {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' normalizes to the workspace root`,
    );
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' escapes the workspace`,
    );
  }
  const firstComponent = normalized.split("/")[0] ?? "";
  if (firstComponent.toLowerCase() === ".git") {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' targets the .git directory; reading runner-managed git state is not allowed`,
    );
  }

  return normalized;
}

export function resolveReviewReferenceFromWorkspace(input: string, cwd: string): string {
  const normalized = validateReviewReferencePath(input);

  let realCwd: string;
  try {
    realCwd = fs.realpathSync.native(cwd);
  } catch (error) {
    throw new ReviewReferenceFileError(
      `workspace directory '${cwd}' is not accessible: ${describeError(error)}`,
    );
  }

  const components = normalized.split("/");
  let current = realCwd;
  let leafStat: fs.Stats | undefined;
  for (let i = 0; i < components.length; i++) {
    current = path.join(current, components[i] ?? "");
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new ReviewReferenceFileError(
          `file not found: '${input.trim()}' (resolved to '${current}')`,
        );
      }
      throw new ReviewReferenceFileError(
        `cannot stat '${input.trim()}': ${describeError(error)}`,
      );
    }
    if (stat.isSymbolicLink()) {
      const isLeaf = i === components.length - 1;
      throw new ReviewReferenceFileError(
        isLeaf
          ? `path '${input.trim()}' is a symbolic link; symlinks are not allowed`
          : `path '${input.trim()}' resolves through a symbolic link`,
      );
    }
    leafStat = stat;
  }

  if (leafStat === undefined) {
    throw new ReviewReferenceFileError(
      `path '${input.trim()}' did not resolve to a file`,
    );
  }
  if (!leafStat.isFile()) {
    throw new ReviewReferenceFileError(
      `path '${input.trim()}' is not a regular file`,
    );
  }
  if (leafStat.size > REFERENCE_MAX_BYTES) {
    throw new ReviewReferenceFileError(
      `file '${input.trim()}' is ${leafStat.size} bytes, exceeds ${REFERENCE_MAX_BYTES}-byte limit`,
    );
  }

  return fs.readFileSync(current, "utf8");
}

export async function resolveReviewReferenceFromBase(
  input: string,
  baseSha: string,
): Promise<string> {
  const normalized = validateReviewReferencePath(input);
  if (baseSha.trim() === "") {
    throw new ReviewReferenceFileError("base SHA is empty");
  }

  const entry = await readPathAtSha(baseSha, normalized);
  if (entry.mode === "120000") {
    throw new ReviewReferenceFileError(
      `path '${input.trim()}' is a symbolic link at base SHA; symlinks are not allowed`,
    );
  }
  if (entry.mode !== "100644" && entry.mode !== "100755") {
    throw new ReviewReferenceFileError(
      `path '${input.trim()}' has unsupported git mode ${entry.mode}; expected a regular file`,
    );
  }

  const size = Buffer.byteLength(entry.content, "utf8");
  if (size > REFERENCE_MAX_BYTES) {
    throw new ReviewReferenceFileError(
      `file '${input.trim()}' is ${size} bytes at base SHA, exceeds ${REFERENCE_MAX_BYTES}-byte limit`,
    );
  }

  return entry.content;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
