import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fieldValue, toIntakeDraft } from '../src/draft/draft.helper';
import {
  bullets,
  compose,
  customField,
  labelled,
  section,
} from '../src/render/render.helper';

describe('render helpers', () => {
  it('omits a section with no body rather than leaving a bare heading', () => {
    assert.equal(section('Scope', 'The work'), '## Scope\n\nThe work');
    assert.equal(section('Scope', null), '');
    assert.equal(section('Scope', '   '), '');
  });

  it('trims the body it renders', () => {
    assert.equal(section('Scope', '  The work  '), '## Scope\n\nThe work');
  });

  it('omits an empty bullet list entirely', () => {
    assert.equal(bullets('Facts', ['one', 'two']), '## Facts\n\n- one\n- two');
    assert.equal(bullets('Facts', []), '');
  });

  it('renders a labelled line only when there is a value', () => {
    assert.equal(labelled('Urgency', 'ASAP'), '**Urgency:** ASAP');
    assert.equal(labelled('Urgency', null), null);
  });

  it('drops the empty parts when composing', () => {
    const body = compose([section('A', 'one'), section('B', null), 'tail']);

    assert.equal(body, '## A\n\none\n\ntail');
    assert.equal(body.includes('##\n'), false);
  });

  it('composes nothing out of nothing', () => {
    assert.equal(compose([]), '');
    assert.equal(compose(['', '']), '');
  });
});

describe('customField', () => {
  const draft = toIntakeDraft({
    draft: { fieldValues: { version: '  3.0  ', blank: '   ' } },
  });

  it('maps a value onto the id it is given', () => {
    assert.deepEqual(
      customField('customfield_14310', fieldValue(draft, 'version')),
      { customfield_14310: '3.0' },
    );
  });

  it('trims a value it is handed directly', () => {
    assert.deepEqual(customField('customfield_14310', '  3.0 '), {
      customfield_14310: '3.0',
    });
  });

  it('omits a blank or missing answer rather than sending an empty value', () => {
    assert.deepEqual(
      customField('customfield_14310', fieldValue(draft, 'blank')),
      {},
    );
    assert.deepEqual(
      customField('customfield_14310', fieldValue(draft, 'missing')),
      {},
    );
    assert.deepEqual(customField('customfield_14310', '   '), {});
    assert.deepEqual(customField('customfield_14310', undefined), {});
  });

  it('omits a field this deployment has no id for', () => {
    const fieldIds: Readonly<Record<string, string>> = {};

    assert.deepEqual(customField(fieldIds.version, '3.0'), {});
  });

  it('omits an unconfigured key that names an inherited property', () => {
    const fieldIds: Readonly<Record<string, string>> = {
      version: 'customfield_14310',
    };

    // Read by a key held as a string, as a caller looping over its own field
    // keys would; the type says `string`, the value is `Object`.
    const key: string = 'constructor';

    assert.deepEqual(customField(fieldIds[key], '3.0'), {});
  });

  it('keeps a value of exactly the host limit', () => {
    const atLimit = 'a'.repeat(500);

    assert.deepEqual(customField('customfield_14310', atLimit), {
      customfield_14310: atLimit,
    });
  });

  it('omits a value over the host limit rather than truncating it', () => {
    assert.deepEqual(customField('customfield_14310', 'a'.repeat(501)), {});
  });

  it('measures the limit after trimming', () => {
    const atLimit = 'a'.repeat(500);

    assert.deepEqual(customField('customfield_14310', `  ${atLimit}  `), {
      customfield_14310: atLimit,
    });
  });

  it('refuses an id that is not a Jira custom field id', () => {
    // The easy mistake is passing the team's own field key instead of its id.
    const refused: readonly string[] = [
      'version',
      '14310',
      'customfield_',
      'customfield_abc',
    ];

    refused.forEach((fieldId) => {
      assert.throws(
        () => customField(fieldId, '3.0'),
        { message: /must be a Jira custom field id/ },
        `expected ${fieldId} to be refused`,
      );
    });
  });

  it('refuses a bad id even when the draft leaves the field blank', () => {
    assert.throws(() => customField('version', undefined), {
      message: /customField id "version"/,
    });
  });

  it('spreads into a map holding only what was chosen', () => {
    const fieldIds = {
      version: 'customfield_14310',
      environment: 'customfield_14311',
    };
    const chosen = toIntakeDraft({
      draft: {
        fieldValues: { version: '3.0', environment: 'Staging', notes: 'Prose' },
        requester: { displayName: 'Ada' },
      },
    });

    assert.deepEqual(
      {
        ...customField(fieldIds.version, fieldValue(chosen, 'version')),
        ...customField(fieldIds.environment, fieldValue(chosen, 'environment')),
      },
      { customfield_14310: '3.0', customfield_14311: 'Staging' },
    );
  });
});
