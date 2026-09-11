import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  draftProse,
  fieldValue,
  filled,
  includesAny,
  toIntakeDraft,
} from '../src/draft/draft.helper';

describe('toIntakeDraft', () => {
  it('reads a well-formed payload', () => {
    const parsed = toIntakeDraft({
      draft: {
        core: { title: 'A title', whatNeeded: 'Some work', urgency: 'ASAP' },
        fieldValues: { exampleField: 'A value' },
        requester: { displayName: 'Ada', department: 'Research' },
      },
    });

    assert.equal(parsed.core.title, 'A title');
    assert.equal(parsed.core.businessValue, null);
    assert.equal(parsed.fieldValues.exampleField, 'A value');
    assert.equal(parsed.requester.displayName, 'Ada');
  });

  it('treats blank strings as absent', () => {
    const parsed = toIntakeDraft({ draft: { core: { title: '   ' } } });

    assert.equal(parsed.core.title, null);
  });

  it('trims core fields and the requester, as fieldValue trims a field', () => {
    const parsed = toIntakeDraft({
      draft: {
        core: { title: '  A title  ' },
        requester: { displayName: '  Ada  ' },
      },
    });

    assert.equal(parsed.core.title, 'A title');
    assert.equal(parsed.requester.displayName, 'Ada');
  });

  it('survives every malformed shape rather than throwing', () => {
    for (const hostile of [
      undefined,
      null,
      42,
      'text',
      [],
      { draft: 7 },
      { draft: { core: [] } },
    ]) {
      const parsed = toIntakeDraft(hostile);

      assert.equal(parsed.core.title, null);
      assert.deepEqual(parsed.fieldValues, {});
    }
  });

  it('drops field values that are not strings', () => {
    const parsed = toIntakeDraft({
      draft: { fieldValues: { good: 'yes', bad: { nested: true }, worse: 12 } },
    });

    assert.deepEqual(parsed.fieldValues, { good: 'yes' });
  });
});

describe('filled and fieldValue', () => {
  it('agrees that whitespace is empty', () => {
    assert.equal(filled('  '), false);
    assert.equal(filled(null), false);
    assert.equal(filled('x'), true);
  });

  it('trims a field value and reports a blank one as absent', () => {
    const parsed = toIntakeDraft({
      draft: { fieldValues: { a: '  value  ', b: ' ' } },
    });

    assert.equal(fieldValue(parsed, 'a'), 'value');
    assert.equal(fieldValue(parsed, 'b'), null);
    assert.equal(fieldValue(parsed, 'missing'), null);
  });
});

describe('draftProse', () => {
  const draft = toIntakeDraft({
    draft: {
      core: {
        title: 'A TITLE',
        whatNeeded: 'Some Work',
        businessValue: 'Saves time',
        urgency: 'ASAP',
      },
      fieldValues: { named: 'In a field', ignored: 'Not gathered' },
      requester: { displayName: 'Ada' },
    },
  });

  it('gathers the prose core fields, lower-cased', () => {
    assert.equal(draftProse(draft), 'a title some work saves time');
  });

  it('gathers only the field values it was asked for', () => {
    const text = draftProse(draft, ['named']);

    assert.equal(text.includes('in a field'), true);
    assert.equal(text.includes('not gathered'), false);
  });

  it('leaves out urgency and the requester', () => {
    // Neither is something the requester writes an explanation into, and a
    // keyword rule that read them would fire on a name or a deadline.
    const text = draftProse(draft, ['named', 'ignored']);

    assert.equal(text.includes('asap'), false);
    assert.equal(text.includes('ada'), false);
  });

  it('skips absent fields rather than joining blanks', () => {
    const sparse = toIntakeDraft({ draft: { core: { title: 'Only this' } } });

    assert.equal(draftProse(sparse, ['missing']), 'only this');
  });
});

describe('includesAny', () => {
  it('finds a phrase and reports its absence', () => {
    assert.equal(includesAny('a new system for close', ['new system']), true);
    assert.equal(includesAny('a routine tweak', ['new system']), false);
    assert.equal(includesAny('anything', []), false);
  });
});
