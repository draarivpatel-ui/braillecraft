// perkins.test.mjs — chord mapping, session grading, lesson integrity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_TO_DOT, DOT_TO_KEY, chordToMask, maskToChordKeys,
  LESSONS, lessonById, PerkinsSession, describeChord
} from '../src/perkins.mjs';
import { LETTER_MASK, STRONG_WORDSIGNS, STRONG_GROUPSIGNS, NUM, CAP, encode } from '../src/ueb.mjs';

// ---- key map --------------------------------------------------------------------
for (const [key, dot] of Object.entries(KEY_TO_DOT)) {
  test(`key '${key.toUpperCase()}' strikes dot ${dot}`, () => {
    assert.equal(KEY_TO_DOT[key], dot);
    assert.equal(DOT_TO_KEY[dot], key);
  });
}
test('exactly six dot keys', () => {
  assert.equal(Object.keys(KEY_TO_DOT).length, 6);
});
test('F D S are the left column, J K L the right', () => {
  assert.deepEqual(['f', 'd', 's'].map(k => KEY_TO_DOT[k]), [1, 2, 3]);
  assert.deepEqual(['j', 'k', 'l'].map(k => KEY_TO_DOT[k]), [4, 5, 6]);
});

// ---- chord masks -------------------------------------------------------------------
for (let m = 0; m < 64; m += 5) {
  test(`chord keys round-trip mask 0x${m.toString(16).padStart(2, '0')}`, () => {
    const keys = maskToChordKeys(m);
    let back = 0;
    for (const k of keys) back |= 1 << (KEY_TO_DOT[k] - 1);
    assert.equal(back, m);
  });
}
test('chordToMask combines dots', () => {
  assert.equal(chordToMask([1, 2, 3, 4, 6]), STRONG_WORDSIGNS.and);
});
test('full six-dot chord is 0x3f', () => {
  assert.equal(chordToMask([1, 2, 3, 4, 5, 6]), 0x3f);
});
test('empty chord is blank', () => {
  assert.equal(chordToMask([]), 0);
});
test('describeChord reports dots, keys and unicode', () => {
  const d = describeChord(STRONG_WORDSIGNS.the);
  assert.deepEqual(d.dots, [2, 3, 4, 6]);
  assert.deepEqual(d.keys, ['d', 's', 'j', 'l']);
  assert.equal(d.unicode, '⠮');
});

// ---- lessons -------------------------------------------------------------------------
for (const lesson of LESSONS) {
  test(`lesson "${lesson.id}" has items with prompts and cells`, () => {
    assert.ok(lesson.items.length >= 4);
    for (const it of lesson.items) {
      assert.ok(typeof it.prompt === 'string' && it.prompt.length > 0);
      assert.ok(Array.isArray(it.cells) && it.cells.length > 0);
      for (const m of it.cells) assert.ok(m >= 0 && m <= 0x3f);
    }
  });
}
test('exactly four lessons', () => assert.equal(LESSONS.length, 4));
test('lessonById falls back to first for unknown id', () => {
  assert.equal(lessonById('nope').id, LESSONS[0].id);
});
test('lesson 1 covers the whole alphabet', () => {
  const letters = LESSONS[0].items.filter(i => i.cells.length === 1 && i.prompt.length === 1)
    .map(i => i.prompt.toLowerCase());
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') assert.ok(letters.includes(ch), ch);
});
test('lesson item cells match the UEB encoder for all-letter words', () => {
  const ada = LESSONS[0].items.find(i => i.prompt === 'ADA');
  assert.deepEqual(ada.cells, encode('ADA', { grade: 1 }).cells);
});
test('numbers lesson includes the numeric indicator', () => {
  const nums = LESSONS[1].items.flatMap(i => i.cells);
  assert.ok(nums.includes(NUM));
});
test('grade2 lesson includes strong wordsigns and groupsigns', () => {
  const cells = LESSONS[2].items.flatMap(i => i.cells);
  for (const m of Object.values(STRONG_WORDSIGNS)) assert.ok(cells.includes(m));
  assert.ok(cells.includes(STRONG_GROUPSIGNS.ch));
});
test('signage lesson uses caps words and numbers', () => {
  const cells = LESSONS[3].items.flatMap(i => i.cells);
  assert.ok(cells.includes(CAP));
  assert.ok(cells.includes(NUM));
});

// ---- session ---------------------------------------------------------------------------
test('session starts on first item with fresh stats', () => {
  const s = new PerkinsSession('home-row');
  assert.equal(s.itemIndex, 0);
  assert.equal(s.stats().accuracy, 100);
  assert.equal(s.done, false);
});
test('pressing keys sets chord bits', () => {
  const s = new PerkinsSession('home-row');
  s.press('f'); s.press('d'); s.press('s');
  const r = s.commit();
  assert.equal(r.mask, chordToMask([1, 2, 3]));
});
test('correct chord advances the cell index', () => {
  const s = new PerkinsSession('home-row'); // first item is 'a' = dot 1
  s.press('f');
  const r = s.commit();
  assert.equal(r.ok, true);
  assert.equal(s.cellIndex + s.itemIndex, 1);
});
test('wrong chord is counted but does not advance', () => {
  const s = new PerkinsSession('home-row');
  s.press('f'); s.press('d');
  const r = s.commit();
  assert.equal(r.ok, false);
  assert.equal(s.cellIndex, 0);
  assert.equal(s.stats().attempts, 1);
  assert.equal(s.stats().accuracy, 0);
});
test('space chord embosses a blank cell', () => {
  const s = new PerkinsSession('home-row');
  // pass items a-e correctly, then the SPACE item expects a blank chord
  for (const ch of 'abcde') {
    for (let d = 1; d <= 6; d++) if (LETTER_MASK[ch] & (1 << (d - 1))) s.press(DOT_TO_KEY[d]);
    assert.equal(s.commit().ok, true, ch);
  }
  const r = s.commit({ space: true });
  assert.equal(r.ok, true);
  assert.equal(r.mask, 0);
});
test('accuracy computes over attempts', () => {
  const s = new PerkinsSession('grade2'); // first item 'and' = 1-2-3-4-6
  s.press('f'); s.press('d'); s.press('s'); s.press('j'); s.press('l');
  const r1 = s.commit();
  assert.equal(r1.ok, true);
  s.press('f'); // wrong for 'the'
  const r2 = s.commit();
  assert.equal(r2.ok, false);
  assert.equal(s.stats().correct, 1);
  assert.equal(s.stats().accuracy, 50);
});
test('streak resets on a miss and best streak persists', () => {
  const s = new PerkinsSession('grade2');
  for (const [keys] of [['and'], ['the']]) void keys;
  // 'and'
  s.press('f'); s.press('d'); s.press('s'); s.press('j'); s.press('l'); s.commit();
  // 'the' = 2-3-4-6
  s.press('d'); s.press('s'); s.press('j'); s.press('l'); s.commit();
  assert.equal(s.stats().streak, 2);
  s.press('f'); s.commit(); // miss on 'for'
  assert.equal(s.stats().streak, 0);
  assert.equal(s.stats().bestStreak, 2);
});
test('session finishes when all items are done', () => {
  const s = new PerkinsSession('numbers');
  while (!s.done) {
    const exp = s.expectedMask;
    for (let d = 1; d <= 6; d++) if (exp & (1 << (d - 1))) s.press(DOT_TO_KEY[d]);
    const r = exp === 0 ? s.commit({ space: true }) : s.commit();
    assert.ok(r);
  }
  assert.equal(s.done, true);
  assert.equal(s.stats().accuracy, 100);
  assert.ok(s.finishedAt !== null);
});
test('progress counts cells', () => {
  const s = new PerkinsSession('home-row');
  const p = s.progress();
  assert.ok(p.totalCells > 10);
  assert.equal(p.doneCells, 0);
});
test('commit returns null after done', () => {
  const s = new PerkinsSession('numbers');
  while (!s.done) {
    const exp = s.expectedMask;
    for (let d = 1; d <= 6; d++) if (exp & (1 << (d - 1))) s.press(DOT_TO_KEY[d]);
    if (exp === 0) s.commit({ space: true }); else s.commit();
  }
  assert.equal(s.commit(), null);
});
