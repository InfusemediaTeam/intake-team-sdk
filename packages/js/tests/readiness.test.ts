import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IIntakeDraft } from '../src/contract/contract.types';
import { toIntakeDraft } from '../src/draft/draft.helper';
import { readiness } from '../src/readiness/readiness.report';

const draft = (
  core: Readonly<Record<string, string>> = {},
  fieldValues: Readonly<Record<string, string>> = {},
): IIntakeDraft => toIntakeDraft({ draft: { core, fieldValues } });

const LEVELS = ['Low', 'High'] as const;

const messages = {
  missing: 'State the level.',
  invalid: (value: string) => `"${value}" is not a level.`,
};

describe('ReadinessReport', () => {
  it('is ready when nothing blocks, warnings notwithstanding', () => {
    const verdict = readiness(draft({ title: 'A title' }))
      .requireCore('title', 'Needs a title.')
      .warn('volume', 'Volume would help.')
      .verdict();

    assert.equal(verdict.ready, true);
    assert.equal(verdict.blockers.length, 0);
    assert.equal(verdict.warnings.length, 1);
  });

  it('reports issues in the order the rules were declared', () => {
    const verdict = readiness(draft())
      .requireCore('title', 'Needs a title.')
      .requireField('one', 'Needs one.')
      .requireField('two', 'Needs two.')
      .verdict();

    assert.deepEqual(
      verdict.blockers.map((blocker) => blocker.field),
      ['title', 'one', 'two'],
    );
    assert.equal(verdict.ready, false);
  });

  it('treats a blank value as missing, in core fields and team fields alike', () => {
    const verdict = readiness(draft({ title: '   ' }, { one: '  ' }))
      .requireCore('title', 'Needs a title.')
      .requireField('one', 'Needs one.')
      .verdict();

    assert.equal(verdict.blockers.length, 2);
  });

  it('blocks conditionally only when the team says so', () => {
    const blocked = readiness(draft())
      .blockWhen(true, 'approver', 'Name an approver.')
      .verdict();
    const clear = readiness(draft())
      .blockWhen(false, 'approver', 'Name an approver.')
      .verdict();

    assert.equal(blocked.blockers.length, 1);
    assert.equal(clear.ready, true);
  });

  it('warns only about a field that is actually missing', () => {
    const present = readiness(draft({}, { volume: '12' }))
      .warnMissingField('volume', 'Volume would help.')
      .verdict();
    const absent = readiness(draft())
      .warnMissingField('volume', 'Volume would help.')
      .verdict();

    assert.equal(present.warnings.length, 0);
    assert.equal(absent.warnings.length, 1);
  });

  it('carries a message with no field for a rule about the draft as a whole', () => {
    const verdict = readiness(draft())
      .block(undefined, 'This request is out of scope.')
      .verdict();

    assert.deepEqual(verdict.blockers, [
      { message: 'This request is out of scope.' },
    ]);
  });

  describe('requireEnumField', () => {
    it('accepts a value the team defines', () => {
      const verdict = readiness(draft({}, { level: 'High' }))
        .requireEnumField('level', LEVELS, messages)
        .verdict();

      assert.equal(verdict.ready, true);
    });

    it('asks for a missing value', () => {
      const verdict = readiness(draft())
        .requireEnumField('level', LEVELS, messages)
        .verdict();

      assert.deepEqual(verdict.blockers, [
        { field: 'level', message: 'State the level.' },
      ]);
    });

    it('reports an unrecognised value differently from an absent one', () => {
      // The two ask the requester for different things: one to answer, one to
      // correct — so a single message would be wrong for one of them.
      const verdict = readiness(draft({}, { level: 'Medium' }))
        .requireEnumField('level', LEVELS, messages)
        .verdict();

      assert.deepEqual(verdict.blockers, [
        { field: 'level', message: '"Medium" is not a level.' },
      ]);
    });

    it('raises one blocker at most for a field', () => {
      const verdict = readiness(draft({}, { level: 'Medium' }))
        .requireEnumField('level', LEVELS, messages)
        .verdict();

      assert.equal(verdict.blockers.length, 1);
    });
  });
});
