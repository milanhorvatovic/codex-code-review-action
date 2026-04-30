const VERSION_BASE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(.+))?$/;
const PRERELEASE_IDENT = /^[0-9A-Za-z-]+$/;

export type SemverParts = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
};

export type SectionLocation = {
  version: string;
  startIndex: number;
  endIndex: number;
};

export type VersionBump = "major" | "minor" | "patch";

export function parseVersion(input: string): string {
  if (input === "Unreleased") {
    throw new Error(
      "'Unreleased' is not a valid version here; pass MAJOR.MINOR.PATCH[-PRERELEASE] (e.g. 2.0.0 or 2.1.0-rc.1).",
    );
  }
  if (input.startsWith("v")) {
    throw new Error("Strip the leading 'v'; pass 1.0.0 not v1.0.0.");
  }
  if (input.includes("+")) {
    throw new Error(
      "Build metadata not supported; pass MAJOR.MINOR.PATCH[-PRERELEASE] only.",
    );
  }
  const match = VERSION_BASE.exec(input);
  if (!match) {
    throw new Error("Invalid version; expected MAJOR.MINOR.PATCH[-PRERELEASE].");
  }
  const prerelease = match[1];
  if (prerelease !== undefined) {
    const idents = prerelease.split(".");
    for (const ident of idents) {
      if (!PRERELEASE_IDENT.test(ident)) {
        throw new Error(
          "Invalid version; expected MAJOR.MINOR.PATCH[-PRERELEASE].",
        );
      }
      if (/^[0-9]+$/.test(ident) && ident.length > 1 && ident.startsWith("0")) {
        throw new Error(
          "Numeric pre-release identifiers may not have leading zeros.",
        );
      }
    }
  }
  return input;
}

export function parseSemver(input: string): SemverParts {
  parseVersion(input);
  const dashIdx = input.indexOf("-");
  const base = dashIdx === -1 ? input : input.slice(0, dashIdx);
  const prerelease = dashIdx === -1 ? "" : input.slice(dashIdx + 1);
  const baseParts = base.split(".");
  const majorStr = baseParts[0];
  const minorStr = baseParts[1];
  const patchStr = baseParts[2];
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    throw new Error(
      `Internal error: parseVersion accepted ${input} but parseSemver could not split it.`,
    );
  }
  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
    prerelease: prerelease === "" ? [] : prerelease.split("."),
  };
}

export function isPrereleaseVersion(version: string): boolean {
  return parseSemver(version).prerelease.length > 0;
}

export function bumpVersion(current: string, bump: VersionBump): string {
  const { major, minor, patch } = parseSemver(current);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function findSection(
  changelog: string,
  version: string,
): { startIndex: number; endIndex: number } {
  const lines = changelog.split("\n");
  const headingPrefix = `## [${version}]`;
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.startsWith(headingPrefix)) continue;
    const after = line.slice(headingPrefix.length);
    if (after !== "" && !after.startsWith(" ")) continue;
    matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`Section ## [${version}] not found in CHANGELOG.md`);
  }
  if (matches.length > 1) {
    const lineNumbers = matches.map((i) => i + 1).join(", ");
    throw new Error(
      `Multiple ## [${version}] headings at lines ${lineNumbers}`,
    );
  }
  const startIndex = matches[0] ?? 0;
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i]?.startsWith("## [")) {
      endIndex = i;
      break;
    }
  }
  return { startIndex, endIndex };
}

export function extractSectionContent(
  changelog: string,
  version: string,
): string {
  const { startIndex, endIndex } = findSection(changelog, version);
  const lines = changelog.split("\n");
  const body = lines.slice(startIndex + 1, endIndex);
  let start = 0;
  let end = body.length;
  while (start < end && (body[start] ?? "").trim() === "") start++;
  while (end > start && (body[end - 1] ?? "").trim() === "") end--;
  if (start === end) {
    throw new Error(`Section ## [${version}] is empty`);
  }
  return body.slice(start, end).join("\n");
}

const SECTION_HEADING = /^## \[([^\]]+)\]/;

export function findAllSections(changelog: string): SectionLocation[] {
  const lines = changelog.split("\n");
  const headings: Array<{ version: string; startIndex: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = SECTION_HEADING.exec(line);
    if (!match || match[1] === undefined) continue;
    headings.push({ version: match[1], startIndex: i });
  }
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      version: heading.version,
      startIndex: heading.startIndex,
      endIndex: next === undefined ? lines.length : next.startIndex,
    };
  });
}

export function removeSections(
  changelog: string,
  predicate: (version: string) => boolean,
): string {
  const sections = findAllSections(changelog);
  const toRemove = sections.filter((section) => predicate(section.version));
  if (toRemove.length === 0) return changelog;
  const lines = changelog.split("\n");
  const keep = new Array<boolean>(lines.length).fill(true);
  for (const section of toRemove) {
    for (let i = section.startIndex; i < section.endIndex; i++) {
      keep[i] = false;
    }
  }
  return lines.filter((_, i) => keep[i]).join("\n");
}

export function insertSection(changelog: string, sectionBlock: string): string {
  const sections = findAllSections(changelog);
  const lines = changelog.split("\n");
  const block = sectionBlock.endsWith("\n") ? sectionBlock : `${sectionBlock}\n`;
  if (sections.length === 0) {
    let insertAt = lines.length;
    while (insertAt > 0 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
    const head = lines.slice(0, insertAt).join("\n");
    const trailing = head === "" ? "" : "\n\n";
    return `${head}${trailing}${block}`;
  }
  const firstSectionStart = sections[0]?.startIndex ?? 0;
  const before = lines.slice(0, firstSectionStart).join("\n");
  const after = lines.slice(firstSectionStart).join("\n");
  const beforeWithSpacing = before.endsWith("\n\n")
    ? before
    : before.endsWith("\n")
      ? `${before}\n`
      : before === ""
        ? ""
        : `${before}\n\n`;
  return `${beforeWithSpacing}${block}\n${after}`;
}

export function isRcOf(rcVersion: string, finalVersion: string): boolean {
  const rc = parseSemver(rcVersion);
  const final = parseSemver(finalVersion);
  if (rc.prerelease.length === 0) return false;
  if (final.prerelease.length !== 0) return false;
  return (
    rc.major === final.major && rc.minor === final.minor && rc.patch === final.patch
  );
}
