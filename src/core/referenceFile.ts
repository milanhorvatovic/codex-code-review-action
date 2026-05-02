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

  const candidate = path.resolve(realCwd, normalized);

  let lstats: fs.Stats;
  try {
    lstats = fs.lstatSync(candidate);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new ReviewReferenceFileError(
        `file not found: '${trimmed}' (resolved to '${candidate}')`,
      );
    }
    throw new ReviewReferenceFileError(
      `cannot stat '${trimmed}': ${describeError(error)}`,
    );
  }

  if (lstats.isSymbolicLink()) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' is a symbolic link; symlinks are not allowed`,
    );
  }
  if (!lstats.isFile()) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' is not a regular file`,
    );
  }

  let resolved: string;
  try {
    resolved = fs.realpathSync.native(candidate);
  } catch (error) {
    throw new ReviewReferenceFileError(
      `cannot resolve real path for '${trimmed}': ${describeError(error)}`,
    );
  }
  if (resolved !== candidate) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' resolves through a symbolic link`,
    );
  }
  if (resolved !== realCwd && !resolved.startsWith(realCwd + path.sep)) {
    throw new ReviewReferenceFileError(
      `path '${trimmed}' resolves outside the workspace`,
    );
  }

  if (lstats.size > REFERENCE_MAX_BYTES) {
    throw new ReviewReferenceFileError(
      `file '${trimmed}' is ${lstats.size} bytes, exceeds ${REFERENCE_MAX_BYTES}-byte limit`,
    );
  }

  return fs.readFileSync(candidate, "utf8");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
