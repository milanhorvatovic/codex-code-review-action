import * as fs from "node:fs";
import * as path from "node:path";

export const REFERENCE_MAX_BYTES = 64 * 1024;

export class ReviewReferenceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewReferenceFileError";
  }
}

export function resolveReviewReferenceContent(input: string, cwd: string): string {
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
          `file not found: '${trimmed}' (resolved to '${current}')`,
        );
      }
      throw new ReviewReferenceFileError(
        `cannot stat '${trimmed}': ${describeError(error)}`,
      );
    }
    if (stat.isSymbolicLink()) {
      const isLeaf = i === components.length - 1;
      throw new ReviewReferenceFileError(
        isLeaf
          ? `path '${trimmed}' is a symbolic link; symlinks are not allowed`
          : `path '${trimmed}' resolves through a symbolic link`,
      );
    }
    leafStat = stat;
  }

  if (leafStat === undefined) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' did not resolve to a file`,
    );
  }
  if (!leafStat.isFile()) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' is not a regular file`,
    );
  }
  if (leafStat.size > REFERENCE_MAX_BYTES) {
    throw new ReviewReferenceFileError(
      `file '${trimmed}' is ${leafStat.size} bytes, exceeds ${REFERENCE_MAX_BYTES}-byte limit`,
    );
  }

  return fs.readFileSync(current, "utf8");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
