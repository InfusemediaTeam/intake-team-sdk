import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import Ajv from 'ajv';

import { CONTRACT_TOOL_NAMES } from '../src/contract/contract.constants';
import { TOOL_CONTRACTS } from '../src/generated/contract.generated';

/**
 * `spec/` is the contract; these check that it is self-consistent and that the
 * shared fixtures mean what they say. The Python suite runs the same fixtures,
 * so a case judged differently there fails one side or the other.
 */

// The repository root, from packages/js/dist-test/tests.
const ROOT = join(__dirname, '..', '..', '..', '..');

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;

interface ICase {
  readonly name: string;
  readonly definition: string;
  readonly valid: boolean;
  readonly value: unknown;
}

const schema = readJson<{ definitions: Record<string, unknown> }>(
  'spec/intake-contract.schema.json',
);
const { cases } = readJson<{ cases: ICase[] }>(
  'spec/fixtures/contract-cases.json',
);

const ajv = new Ajv({ strict: true, allErrors: true });

ajv.addSchema(schema, 'contract');

describe('spec/intake-contract.schema.json', () => {
  for (const testCase of cases) {
    it(`${testCase.valid ? 'accepts' : 'rejects'} ${testCase.name}`, () => {
      const validate = ajv.getSchema(
        `contract#/definitions/${testCase.definition}`,
      );

      assert.ok(validate, `no definition ${testCase.definition}`);
      assert.equal(
        validate(testCase.value),
        testCase.valid,
        ajv.errorsText(validate.errors),
      );
    });
  }
});

describe('generated tool contracts', () => {
  it('cover exactly the contract tool names', () => {
    assert.deepEqual(
      TOOL_CONTRACTS.map((tool) => tool.name),
      [...CONTRACT_TOOL_NAMES],
    );
  });

  for (const tool of TOOL_CONTRACTS) {
    it(`publishes self-contained, compilable schemas for ${tool.name}`, () => {
      // Each one stands alone, as an MCP client compiles it on its own.
      const isolated = new Ajv({ strict: true });

      assert.doesNotThrow(() => isolated.compile(tool.inputSchema));
      assert.doesNotThrow(() => isolated.compile(tool.outputSchema));
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.outputSchema.type, 'object');
    });
  }

  it('match a fixture for every input and output a case covers', () => {
    const byName = new Map(TOOL_CONTRACTS.map((tool) => [tool.name, tool]));
    const create = byName.get('intake_create_task');
    const createCase = cases.find(
      (testCase) => testCase.name === 'create input',
    );

    assert.ok(create && createCase);
    assert.equal(
      new Ajv({ strict: true }).validate(create.inputSchema, createCase.value),
      true,
    );
  });
});
