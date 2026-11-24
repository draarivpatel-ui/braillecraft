// presets.test.mjs: template integrity and URL-hash state codec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetById, encodeHash, decodeHash } from '../src/presets.mjs';
import { encode } from '../src/ueb.mjs';

test('exactly five presets', () => assert.equal(PRESETS.length, 5));

for (const p of PRESETS) {
  test(`preset "${p.id}" is well-formed and encodes cleanly`, () => {
    assert.ok(p.title.length > 3);
    assert.ok(p.text.length > 0);
    assert.ok(p.grade === 1 || p.grade === 2);
    assert.ok(p.caption.length > 0);
    assert.ok(p.note.length > 10);
    const r = encode(p.text, { grade: p.grade });
    assert.ok(r.cells.length > 0);
  });
  test(`presetById resolves "${p.id}"`, () => {
    assert.equal(presetById(p.id).title, p.title);
  });
}

test('preset ids are unique', () => {
  assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length);
});

test('safety-sign presets default to Grade 2 per ADA 703.3', () => {
  for (const id of ['lab-eyewash', 'restroom', 'exit-stairwell']) {
    assert.equal(presetById(id).grade, 2, id);
  }
  for (const p of PRESETS) assert.equal(p.grade, 2, `ADA signage preset ${p.id} must be contracted Grade 2`);
});
test('presetById returns null for unknown', () => {
  assert.equal(presetById('nope'), null);
});

// ---- hash codec -------------------------------------------------------------------
const STATES = [
  { tab: 'studio', grade: 2, text: 'STEM CLUB ROOM 204', maxCols: 24 },
  { tab: 'trainer', grade: 1, text: 'abc', lesson: 'numbers', muted: true },
  { tab: 'tests', theme: 'dark' },
  { text: 'Ünïcödé snow ☃' },
  { text: '' },
  { preset: 'lab-eyewash', grade: 1, maxCols: 40 }
];
for (const [i, st] of STATES.entries()) {
  test(`hash round trip #${i}`, () => {
    const back = decodeHash(encodeHash(st));
    if (st.tab) assert.equal(back.tab, st.tab);
    if (st.grade) assert.equal(back.grade, st.grade);
    if (st.text !== undefined) assert.equal(back.text, st.text);
    if (st.maxCols) assert.equal(back.maxCols, st.maxCols);
    if (st.preset) assert.equal(back.preset, st.preset);
    if (st.lesson) assert.equal(back.lesson, st.lesson);
    if (st.muted) assert.equal(back.muted, true);
    if (st.theme) assert.equal(back.theme, st.theme);
  });
}

test('empty hash decodes to {}', () => {
  assert.deepEqual(decodeHash(''), {});
  assert.deepEqual(decodeHash('#'), {});
});
test('malformed base64 does not throw', () => {
  assert.doesNotThrow(() => decodeHash('#t=%ZZ%%'));
});
test('garbage hash does not throw', () => {
  assert.doesNotThrow(() => decodeHash('%%%%'));
  assert.doesNotThrow(() => decodeHash('#v=99&x=%'));
});
test('out-of-range values are dropped', () => {
  const back = decodeHash('#g=9&tab=nope&max=999&th=x');
  assert.equal(back.grade, undefined);
  assert.equal(back.tab, undefined);
  assert.equal(back.maxCols, undefined);
  assert.equal(back.theme, undefined);
});
test('unknown preset id is dropped', () => {
  assert.equal(decodeHash('#p=not-a-preset').preset, undefined);
});
test('hash never contains raw unicode text', () => {
  const h = encodeHash({ text: 'Room 204 ☃' });
  assert.ok(!h.includes('☃'));
  assert.ok(h.startsWith('#'));
});
test('lesson id must match safe pattern', () => {
  assert.equal(decodeHash('#l=__proto__').lesson, undefined);
});
