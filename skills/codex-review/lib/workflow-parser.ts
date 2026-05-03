export type Step = {
  comments: ReadonlyArray<string>;
  env: ReadonlyArray<string>;
  uses: string | null;
  with: ReadonlyMap<string, string>;
};

export type Job = {
  comments: ReadonlyArray<string>;
  env: ReadonlyArray<string>;
  environment: string | null;
  if: string | null;
  name: string;
  permissions: ReadonlyMap<string, string>;
  steps: ReadonlyArray<Step>;
};

export type Workflow = {
  comments: ReadonlyArray<string>;
  jobs: ReadonlyArray<Job>;
  on: ReadonlyArray<string>;
  text: string;
};

const SELF_USES = /milanhorvatovic\/codex-ai-code-review-action(?:\/(prepare|review|publish))?@([0-9a-f]{40}|v\d[^\s#]*|[\w./-]+)/;

export function parseWorkflow(text: string): Workflow {
  const lines = text.split(/\r?\n/);
  const comments = collectAllComments(lines);
  const on = parseOn(lines);
  const jobs = parseJobs(lines);
  return { comments, jobs, on, text };
}

function collectAllComments(lines: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const idx = indexOfComment(line);
    if (idx === -1) continue;
    out.push(line.slice(idx + 1).trim());
  }
  return out;
}

function indexOfComment(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return i;
  }
  return -1;
}

function parseOn(lines: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  let inOn = false;
  let baseIndent: number | null = null;
  for (const line of lines) {
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (/^on:\s+\[/.test(line)) {
      const m = /^on:\s+\[(.+)\]/.exec(line);
      if (m !== null && m[1] !== undefined) {
        for (const event of m[1].split(",")) out.push(event.trim());
      }
      return out.sort();
    }
    if (!inOn) continue;
    if (line.length === 0) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent === 0) {
      inOn = false;
      continue;
    }
    if (baseIndent === null) baseIndent = indent;
    if (indent === baseIndent) {
      const stripped = line.slice(indent);
      const m = /^([\w-]+):/.exec(stripped);
      if (m !== null && m[1] !== undefined) out.push(m[1]);
    }
  }
  return out.sort();
}

function parseJobs(lines: ReadonlyArray<string>): Job[] {
  const jobs: Job[] = [];
  let inJobs = false;
  let baseIndent: number | null = null;
  let current: { name: string; indent: number; lines: string[] } | null = null;

  function commit(): void {
    if (current === null) return;
    jobs.push(parseJob(current.name, current.indent, current.lines));
    current = null;
  }

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed.length === 0) {
      if (current !== null) current.lines.push(line);
      continue;
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent === 0 && trimmed !== "") {
      commit();
      inJobs = false;
      continue;
    }
    if (baseIndent === null) baseIndent = indent;

    if (indent === baseIndent) {
      const stripped = line.slice(indent);
      const m = /^([\w-]+):\s*$/.exec(stripped);
      if (m !== null && m[1] !== undefined) {
        commit();
        current = { indent, lines: [], name: m[1] };
        continue;
      }
    }
    if (current !== null) current.lines.push(line);
  }
  commit();
  return jobs;
}

function parseJob(name: string, jobIndent: number, lines: ReadonlyArray<string>): Job {
  const fieldIndent = jobIndent + 2;
  let ifExpr: string | null = null;
  let environment: string | null = null;
  const permissions = new Map<string, string>();
  const env: string[] = [];
  const steps: Step[] = [];
  const comments: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    if (raw.length === 0) {
      i++;
      continue;
    }
    const cmt = indexOfComment(raw);
    if (cmt !== -1) comments.push(raw.slice(cmt + 1).trim());
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    if (indent < fieldIndent) {
      i++;
      continue;
    }
    if (indent !== fieldIndent) {
      i++;
      continue;
    }
    const stripped = raw.slice(fieldIndent).replace(/\s+#.*$/, "");
    const ifMatch = /^if:\s*(.*)$/.exec(stripped);
    if (ifMatch !== null && ifMatch[1] !== undefined) {
      ifExpr = ifMatch[1].trim();
      i++;
      continue;
    }
    const envMatch = /^environment:\s*(.*)$/.exec(stripped);
    if (envMatch !== null && envMatch[1] !== undefined && envMatch[1].trim().length > 0) {
      environment = envMatch[1].trim().replace(/^["']|["']$/g, "");
      i++;
      continue;
    }
    if (/^permissions:\s*$/.test(stripped)) {
      i++;
      while (i < lines.length) {
        const r = lines[i] ?? "";
        const ind = r.match(/^ */)?.[0].length ?? 0;
        if (ind <= fieldIndent || r.trim() === "") {
          if (ind <= fieldIndent && r.trim() !== "") break;
          if (r.trim() === "") {
            i++;
            continue;
          }
          break;
        }
        const sub = r.slice(ind).replace(/\s+#.*$/, "").trim();
        const pm = /^([\w-]+):\s*(\S+)\s*$/.exec(sub);
        if (pm !== null && pm[1] !== undefined && pm[2] !== undefined) permissions.set(pm[1], pm[2]);
        i++;
      }
      continue;
    }
    if (/^env:\s*$/.test(stripped)) {
      i++;
      while (i < lines.length) {
        const r = lines[i] ?? "";
        const ind = r.match(/^ */)?.[0].length ?? 0;
        if (ind <= fieldIndent && r.trim() !== "") break;
        if (r.trim() !== "") env.push(r.trim());
        i++;
      }
      continue;
    }
    if (/^steps:\s*$/.test(stripped)) {
      i++;
      const stepEntries = collectStepEntries(lines, i, fieldIndent);
      i = stepEntries.next;
      for (const entry of stepEntries.entries) steps.push(parseStep(entry));
      continue;
    }
    i++;
  }
  return { comments, env, environment, if: ifExpr, name, permissions, steps };
}

function collectStepEntries(
  lines: ReadonlyArray<string>,
  start: number,
  jobFieldIndent: number,
): { entries: ReadonlyArray<ReadonlyArray<string>>; next: number } {
  const entries: string[][] = [];
  let i = start;
  let current: string[] | null = null;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    if (raw.length === 0) {
      if (current !== null) current.push(raw);
      i++;
      continue;
    }
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    if (indent <= jobFieldIndent && raw.trim() !== "") break;
    const stripped = raw.slice(indent);
    if (/^- /.test(stripped)) {
      if (current !== null) entries.push(current);
      current = [stripped.slice(2)];
    } else if (current !== null) {
      const stepIndent = indent;
      void stepIndent;
      current.push(stripped);
    }
    i++;
  }
  if (current !== null) entries.push(current);
  return { entries, next: i };
}

function parseStep(stepLines: ReadonlyArray<string>): Step {
  const comments: string[] = [];
  const env: string[] = [];
  let uses: string | null = null;
  const withMap = new Map<string, string>();

  let inWith = false;
  for (let i = 0; i < stepLines.length; i++) {
    const raw = stepLines[i] ?? "";
    const cmt = indexOfComment(raw);
    if (cmt !== -1) comments.push(raw.slice(cmt + 1).trim());
    const stripped = raw.replace(/\s+#.*$/, "").replace(/^\s+/, "");
    if (stripped.length === 0) continue;

    const usesMatch = /^uses:\s*(\S+)/.exec(stripped);
    if (usesMatch !== null && usesMatch[1] !== undefined) {
      uses = usesMatch[1];
      inWith = false;
      continue;
    }
    if (/^with:\s*$/.test(stripped)) {
      inWith = true;
      continue;
    }
    if (/^env:\s*$/.test(stripped)) {
      inWith = false;
      continue;
    }
    if (inWith) {
      const m = /^([\w-]+):\s*(.*)$/.exec(stripped);
      if (m !== null && m[1] !== undefined) {
        const value = stripQuotes((m[2] ?? "").trim());
        withMap.set(m[1], value);
      }
    }
    if (/\${{\s*secrets\./.test(raw) || /OPENAI_API_KEY/.test(raw)) {
      env.push(raw.trim());
    }
  }
  return { comments, env, uses, with: withMap };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function selfPin(line: string): { sub: string | null; ref: string } | null {
  const m = SELF_USES.exec(line);
  if (m === null) return null;
  return { ref: m[2] ?? "", sub: m[1] ?? null };
}

export function findStepsUsingSelf(workflow: Workflow): Array<{ job: string; sub: string | null; ref: string }> {
  const out: Array<{ job: string; sub: string | null; ref: string }> = [];
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      if (step.uses === null) continue;
      const pin = selfPin(step.uses);
      if (pin === null) continue;
      out.push({ job: job.name, ref: pin.ref, sub: pin.sub });
    }
  }
  return out;
}
