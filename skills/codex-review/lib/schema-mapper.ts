export type TrustClass = "policy" | "secret" | "tuning" | "wiring";

export type InputSpec = {
  default: string | null;
  description: string;
  name: string;
  required: boolean;
  trustClass: TrustClass;
};

export type ActionInputSchema = {
  prepare: ReadonlyArray<InputSpec>;
  publish: ReadonlyArray<InputSpec>;
  review: ReadonlyArray<InputSpec>;
};

export type ManifestReader = {
  readFile: (path: string) => string;
};

const TRUST_BY_NAME: Record<string, TrustClass> = {
  "allow-users": "policy",
  chunk: "wiring",
  effort: "tuning",
  "expected-chunks": "wiring",
  "fail-on-missing-chunks": "tuning",
  "github-token": "secret",
  "max-chunk-bytes": "tuning",
  "max-comments": "tuning",
  "min-confidence": "tuning",
  model: "tuning",
  "openai-api-key": "secret",
  "retain-findings": "tuning",
  "retain-findings-days": "tuning",
  "review-effort": "tuning",
  "review-reference-file": "policy",
};

export function classifyTrust(name: string): TrustClass {
  return TRUST_BY_NAME[name] ?? "wiring";
}

const INPUT_LINE = /^([A-Za-z][\w.-]*):\s*$/;
const FIELD_LINE = /^(description|required|default):\s*(.*)$/;

export function parseManifest(yamlText: string): InputSpec[] {
  const lines = yamlText.split(/\r?\n/);
  const inputs: InputSpec[] = [];

  let inInputs = false;
  let baseIndent: number | null = null;
  let current: { name: string; description: string; required: boolean; default: string | null; indent: number } | null = null;

  function commit(): void {
    if (current === null) return;
    inputs.push({
      default: current.default,
      description: current.description,
      name: current.name,
      required: current.required,
      trustClass: classifyTrust(current.name),
    });
    current = null;
  }

  for (const line of lines) {
    if (line.length === 0) continue;
    if (/^\s*#/.test(line)) continue;

    if (!inInputs) {
      if (/^inputs:\s*$/.test(line)) inInputs = true;
      continue;
    }

    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent === 0) {
      commit();
      inInputs = false;
      continue;
    }

    if (baseIndent === null) baseIndent = indent;

    if (indent === baseIndent) {
      const stripped = line.slice(indent);
      const m = INPUT_LINE.exec(stripped);
      if (m === null) continue;
      commit();
      const name = m[1];
      if (name === undefined) continue;
      current = { default: null, description: "", indent, name, required: false };
      continue;
    }

    if (current === null) continue;
    if (indent <= current.indent) continue;

    const stripped = line.slice(indent);
    const fm = FIELD_LINE.exec(stripped);
    if (fm === null) continue;
    const field = fm[1];
    const rawValue = fm[2] ?? "";
    const value = stripQuotes(rawValue.trim());
    if (field === "description") current.description = value;
    else if (field === "required") current.required = value === "true";
    else if (field === "default") current.default = value;
  }

  commit();
  return inputs;
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

export function mapSchema(reader: ManifestReader, paths: { prepare: string; publish: string; review: string }): ActionInputSchema {
  return {
    prepare: parseManifest(reader.readFile(paths.prepare)),
    publish: parseManifest(reader.readFile(paths.publish)),
    review: parseManifest(reader.readFile(paths.review)),
  };
}

export function findInput(schema: ActionInputSchema, action: keyof ActionInputSchema, name: string): InputSpec | null {
  return schema[action].find((spec) => spec.name === name) ?? null;
}
