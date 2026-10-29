// Generates both SDKs' contract code from spec/: TypeScript interfaces and tool
// schemas, and the Python TypedDicts and tool schemas. Run `npm run generate`
// after editing spec/; `npm run check:generated` fails when the output is stale.
//
// Covers only the JSON Schema subset spec/ uses: object, array, enum, $ref to
// #/definitions, and nullable type unions. Anything else fails loudly.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readJson('spec/intake-contract.schema.json');
const CONTRACT = readJson('spec/contract.json');
const DEFINITIONS = SCHEMA.definitions;

const TS_OUT = 'packages/js/src/generated/contract.generated.ts';
const PY_OUT = 'packages/python/src/intake_team_sdk/_generated.py';
const HEADER = 'Generated from spec/ by scripts/generate-contract.mjs. Do not edit.';

const check = process.argv.includes('--check');

const outputs = {
  [TS_OUT]: await prettier.format(typescript(), {
    parser: 'typescript',
    ...(await prettier.resolveConfig(join(ROOT, TS_OUT))),
  }),
  [PY_OUT]: python(),
};

let stale = false;

for (const [path, content] of Object.entries(outputs)) {
  const target = join(ROOT, path);
  const current = readOrNull(target);

  // Line endings aside: a Windows checkout has CRLF, and Git stores LF.
  if (current?.replace(/\r\n/g, '\n') === content) continue;

  if (check) {
    process.stderr.write(`${path} is out of date; run npm run generate\n`);
    stale = true;
  } else {
    writeFileSync(target, content);
    process.stdout.write(`wrote ${path}\n`);
  }
}

if (stale) process.exit(1);

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function refName(ref) {
  const prefix = '#/definitions/';

  if (!ref.startsWith(prefix)) throw new Error(`Unsupported $ref ${ref}`);

  const name = ref.slice(prefix.length);

  if (!DEFINITIONS[name]) throw new Error(`Unknown definition ${name}`);

  return name;
}

function isObjectDefinition(schema) {
  return schema.type === 'object';
}

/** The definitions one schema reaches, so each tool schema carries only its own. */
function reachable(schema, found = new Set()) {
  if (Array.isArray(schema)) {
    for (const item of schema) reachable(item, found);
  } else if (schema && typeof schema === 'object') {
    if (typeof schema.$ref === 'string') {
      const name = refName(schema.$ref);

      if (!found.has(name)) {
        found.add(name);
        reachable(DEFINITIONS[name], found);
      }
    }

    for (const value of Object.values(schema)) reachable(value, found);
  }

  return found;
}

/** A tool schema as tools/list publishes it: the definition itself at the root. */
function toolSchema(name) {
  const root = DEFINITIONS[name];
  const used = [...reachable(root)].sort();
  const definitions = Object.fromEntries(used.map((key) => [key, DEFINITIONS[key]]));

  return used.length > 0 ? { ...root, definitions } : { ...root };
}

function toolContracts() {
  return CONTRACT.tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    scope: tool.scope,
    readOnly: tool.readOnly,
    required: tool.required,
    inputSchema: toolSchema(tool.input),
    outputSchema: toolSchema(tool.output),
  }));
}

// TypeScript

function tsName(name) {
  return isObjectDefinition(DEFINITIONS[name]) ? `I${name}` : name;
}

function tsType(schema) {
  if (schema.$ref) return tsName(refName(schema.$ref));

  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');

  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => tsType({ ...schema, type })).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `readonly ${wrap(tsType(schema.items))}[]`;
    case 'object':
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `Readonly<Record<string, ${tsType(schema.additionalProperties)}>>`;
      }

      throw new Error('Inline object schemas must be named definitions');
    default:
      throw new Error(`Unsupported schema ${JSON.stringify(schema)}`);
  }
}

function wrap(type) {
  return type.includes('|') ? `(${type})` : type;
}

function tsDoc(text, indent = '') {
  return text ? `${indent}/** ${text} */\n` : '';
}

function tsDefinition(name) {
  const schema = DEFINITIONS[name];

  if (!isObjectDefinition(schema) || !schema.properties) {
    return `${tsDoc(schema.description)}export type ${tsName(name)} = ${tsType(schema)};\n`;
  }

  const required = new Set(schema.required ?? []);
  const lines = Object.entries(schema.properties).map(([key, property]) => {
    const optional = required.has(key) ? '' : '?';

    return `${tsDoc(property.description, '  ')}  readonly ${key}${optional}: ${tsType(property)};`;
  });

  const body = lines.length > 0 ? `{\n${lines.join('\n')}\n}` : '{}';

  if (lines.length === 0) {
    return `${tsDoc(schema.description)}export type ${tsName(name)} = Readonly<Record<string, never>>;\n`;
  }

  return `${tsDoc(schema.description)}export interface ${tsName(name)} ${body}\n`;
}

function typescript() {
  const definitions = Object.keys(DEFINITIONS).map(tsDefinition).join('\n');

  return `// ${HEADER}

export const CONTRACT_VERSION = ${JSON.stringify(CONTRACT.contractVersion)};

export const RESERVED_TOOL_PREFIX = ${JSON.stringify(CONTRACT.reservedToolPrefix)};

export const SCOPES = ${JSON.stringify(CONTRACT.scopes)} as const;

export const SERVICE_TOKEN_RULES = ${JSON.stringify(CONTRACT.serviceToken)} as const;

${definitions}
export interface IToolContract {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly scope: string;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export const TOOL_CONTRACTS: readonly IToolContract[] = ${JSON.stringify(toolContracts())};
`;
}

// Python

function pyType(schema) {
  if (schema.$ref) return refName(schema.$ref);

  if (schema.enum) {
    return `Literal[${schema.enum.map((value) => JSON.stringify(value)).join(', ')}]`;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => pyType({ ...schema, type })).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'str';
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'None';
    case 'array':
      return `list[${pyType(schema.items)}]`;
    case 'object':
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `dict[str, ${pyType(schema.additionalProperties)}]`;
      }

      throw new Error('Inline object schemas must be named definitions');
    default:
      throw new Error(`Unsupported schema ${JSON.stringify(schema)}`);
  }
}

function pyDoc(text, indent) {
  return text ? `${indent}"""${text.replace(/"""/g, "'''")}"""\n` : '';
}

/** Definitions ordered so each class follows the ones it names. */
function pyOrder() {
  const ordered = [];
  const done = new Set();

  const visit = (name) => {
    if (done.has(name)) return;

    done.add(name);

    for (const dependency of reachable(DEFINITIONS[name])) visit(dependency);

    ordered.push(name);
  };

  for (const name of Object.keys(DEFINITIONS)) visit(name);

  return ordered;
}

function pyDefinition(name) {
  const schema = DEFINITIONS[name];

  if (!isObjectDefinition(schema) || !schema.properties) {
    return `${name} = ${pyType(schema)}\n${pyDoc(schema.description, '')}`;
  }

  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties).map(([key, property]) => {
    const type = pyType(property);

    return `    ${key}: ${required.has(key) ? type : `NotRequired[${type}]`}\n${pyDoc(property.description, '    ')}`;
  });

  const body = fields.length > 0 ? fields.join('') : '    pass\n';

  return `class ${name}(TypedDict):\n${pyDoc(schema.description, '    ')}${body}`;
}

function python() {
  const json = JSON.stringify(toolContracts(), null, 2);

  return `# ${HEADER}
# ruff: noqa

from __future__ import annotations

import json
from typing import Any, Literal, NotRequired, TypedDict

CONTRACT_VERSION = ${JSON.stringify(CONTRACT.contractVersion)}

RESERVED_TOOL_PREFIX = ${JSON.stringify(CONTRACT.reservedToolPrefix)}

SCOPES: dict[str, str] = json.loads(${pyString(JSON.stringify(CONTRACT.scopes))})

SERVICE_TOKEN_RULES: dict[str, Any] = json.loads(${pyString(JSON.stringify(CONTRACT.serviceToken))})


${pyOrder().map(pyDefinition).join('\n\n')}

TOOL_CONTRACTS: list[dict[str, Any]] = json.loads(
    ${pyString(json)}
)
`;
}

/** A raw triple-quoted literal; the spec contains no triple quotes or trailing backslash. */
function pyString(text) {
  if (text.includes("'''")) throw new Error('Spec text contains a triple quote');

  return `r'''${text}'''`;
}
