import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bullets,
  compose,
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
