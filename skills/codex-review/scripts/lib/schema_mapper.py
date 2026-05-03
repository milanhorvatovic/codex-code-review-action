"""Action-input schema mapper for the codex-review skill.

Parses the prepare/, review/, and publish/ action.yaml manifests into a typed
input registry. Top-level action.yaml is excluded by design — see scope-trim
notes in the skill's design plan.

Implementation note: a regex-based parser is sufficient for the small,
constrained shape of the action manifests we read. Avoiding a YAML library
keeps the skill stdlib-only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol

type TrustClass = Literal["policy", "secret", "tuning", "wiring"]


@dataclass(frozen=True)
class InputSpec:
    default: str | None
    description: str
    name: str
    required: bool
    trust_class: TrustClass


@dataclass(frozen=True)
class ActionInputSchema:
    prepare: tuple[InputSpec, ...]
    publish: tuple[InputSpec, ...]
    review: tuple[InputSpec, ...]


class ManifestReader(Protocol):
    def read_file(self, path: str) -> str: ...


_TRUST_BY_NAME: dict[str, TrustClass] = {
    "allow-users": "policy",
    "chunk": "wiring",
    "effort": "tuning",
    "expected-chunks": "wiring",
    "fail-on-missing-chunks": "tuning",
    "github-token": "secret",
    "max-chunk-bytes": "tuning",
    "max-comments": "tuning",
    "min-confidence": "tuning",
    "model": "tuning",
    "openai-api-key": "secret",
    "retain-findings": "tuning",
    "retain-findings-days": "tuning",
    "review-effort": "tuning",
    "review-reference-file": "policy",
}

_INPUT_LINE = re.compile(r"^([A-Za-z][\w.-]*):\s*$")
_FIELD_LINE = re.compile(r"^(description|required|default):\s*(.*)$")


def classify_trust(name: str) -> TrustClass:
    return _TRUST_BY_NAME.get(name, "wiring")


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


@dataclass
class _Pending:
    name: str
    indent: int
    description: str = ""
    required: bool = False
    default: str | None = None


def parse_manifest(yaml_text: str) -> tuple[InputSpec, ...]:
    inputs: list[InputSpec] = []
    in_inputs = False
    base_indent: int | None = None
    current: _Pending | None = None

    def commit() -> None:
        nonlocal current
        if current is None:
            return
        inputs.append(
            InputSpec(
                default=current.default,
                description=current.description,
                name=current.name,
                required=current.required,
                trust_class=classify_trust(current.name),
            )
        )
        current = None

    for raw in yaml_text.splitlines():
        if raw == "":
            continue
        if re.match(r"^\s*#", raw):
            continue
        if not in_inputs:
            if re.match(r"^inputs:\s*$", raw):
                in_inputs = True
            continue
        leading = len(raw) - len(raw.lstrip(" "))
        if leading == 0:
            commit()
            in_inputs = False
            continue
        if base_indent is None:
            base_indent = leading
        if leading == base_indent:
            stripped = raw[leading:]
            match = _INPUT_LINE.match(stripped)
            if match is None:
                continue
            commit()
            current = _Pending(name=match.group(1), indent=leading)
            continue
        if current is None:
            continue
        if leading <= current.indent:
            continue
        stripped = raw[leading:]
        field_match = _FIELD_LINE.match(stripped)
        if field_match is None:
            continue
        field = field_match.group(1)
        value = _strip_quotes(field_match.group(2).strip())
        if field == "description":
            current.description = value
        elif field == "required":
            current.required = value == "true"
        elif field == "default":
            current.default = value

    commit()
    return tuple(inputs)


def map_schema(reader: ManifestReader, *, prepare: str, publish: str, review: str) -> ActionInputSchema:
    return ActionInputSchema(
        prepare=parse_manifest(reader.read_file(prepare)),
        publish=parse_manifest(reader.read_file(publish)),
        review=parse_manifest(reader.read_file(review)),
    )


def find_input(schema: ActionInputSchema, action: Literal["prepare", "publish", "review"], name: str) -> InputSpec | None:
    inputs = getattr(schema, action)
    for spec in inputs:
        if spec.name == name:
            return spec
    return None
