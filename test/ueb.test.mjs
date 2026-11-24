// ueb.test.mjs: UEB engine verification: every letter, digit, indicator,
// punctuation sign, wordsign, groupsign, savings and Grade-1 round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encode, encodeUEB, decodeG1, cellsToUnicode, maskToUnicode, unicodeToMask,
  dotsOf, maskOfDots, LETTER_MASK, MASK_TO_LETTER, DIGIT_TO_LETTER, LETTER_TO_DIGIT,
  ALPHABETIC_WORDSIGNS, STRONG_WORDSIGNS, STRONG_GROUPSIGNS,
  NUM, CAP, G1, PUNCT, describeCell
} from '../src/ueb.mjs';

const cells = (s, g = 2) => encode(s, { grade: g }).cells;
const uni = (s, g = 2) => encode(s, { grade: g }).unicode;

// ---- every letter a-z -------------------------------------------------------
const EXPECTED_LETTERS = {
  a: 0x01, b: 0x03, c: 0x09, d: 0x19, e: 0x11, f: 0x0b, g: 0x1b, h: 0x13,
  i: 0x0a, j: 0x1a, k: 0x05, l: 0x07, m: 0x0d, n: 0x1d, o: 0x15, p: 0x0f,
  q: 0x1f, r: 0x17, s: 0x0e, t: 0x1e, u: 0x25, v: 0x27, w: 0x3a, x: 0x2d,
  y: 0x3d, z: 0x35
};
for (const [ch, mask] of Object.entries(EXPECTED_LETTERS)) {
  test(`letter '${ch}' encodes to mask 0x${mask.toString(16)}`, () => {
    assert.equal(LETTER_MASK[ch], mask);
    assert.deepEqual(cells(ch, 1), [mask]);
  });
}

test('letter masks are all distinct', () => {
  assert.equal(new Set(Object.values(LETTER_MASK)).size, 26);
});
test('MASK_TO_LETTER inverts every letter', () => {
  for (const [ch, m] of Object.entries(LETTER_MASK)) assert.equal(MASK_TO_LETTER[m], ch);
});

// ---- digits -----------------------------------------------------------------
for (const d of '1234567890') {
  test(`digit '${d}' encodes inside numeric mode`, () => {
    const c = cells(d, 1);
    assert.equal(c[0], NUM);
    assert.equal(c[1], LETTER_MASK[DIGIT_TO_LETTER[d]]);
    assert.equal(LETTER_TO_DIGIT[DIGIT_TO_LETTER[d]], d);
  });
}
test('multi-digit number emits one numeric indicator', () => {
  const c = cells('204', 1);
  assert.equal(c[0], NUM);
  assert.deepEqual(c.slice(1), [LETTER_MASK.b, LETTER_MASK.j, LETTER_MASK.d]);
});
test('numeric comma stays inside numeric mode', () => {
  const c = cells('1,000', 1);
  assert.equal(c.filter(m => m === NUM).length, 1);
  assert.deepEqual(c.slice(2), [0x02, LETTER_MASK.j, LETTER_MASK.j, LETTER_MASK.j]);
});
test('decimal point stays inside numeric mode', () => {
  const c = cells('3.5', 1);
  assert.deepEqual(c, [NUM, LETTER_MASK.c, 0x32, LETTER_MASK.e]);
});
test('letter a-j after digits gets grade-1 indicator', () => {
  const c = cells('3d', 1);
  assert.deepEqual(c, [NUM, LETTER_MASK.c, G1, LETTER_MASK.d]);
});
test('letter k-z after digits needs no indicator', () => {
  const c = cells('3m', 1);
  assert.deepEqual(c, [NUM, LETTER_MASK.c, LETTER_MASK.m]);
});
test('a-j word after numeric word boundary is safe', () => {
  const c = cells('5 apples', 1);
  assert.deepEqual(c, [NUM, LETTER_MASK.e, 0, LETTER_MASK.a, LETTER_MASK.p, LETTER_MASK.p, LETTER_MASK.l, LETTER_MASK.e, LETTER_MASK.s]);
});
test('caps word requires letters only: digits force the mixed path', () => {
  for (const s of ['3D', 'A1', 'ROOM204', 'B2B', 'ABC123']) {
    const c = cells(s, 1);
    for (const m of c) assert.ok(Number.isInteger(m) && m >= 0 && m <= 0x3f, `${s} emitted ${m}`);
  }
});
test("'3D' is number + grade-1 + cap + d, not a caps word", () => {
  assert.deepEqual(cells('3D', 1), [NUM, LETTER_MASK.c, G1, CAP, LETTER_MASK.d]);
});
test("'A1' is cap + a + number, not a caps word", () => {
  assert.deepEqual(cells('A1', 1), [CAP, LETTER_MASK.a, NUM, LETTER_MASK.a]);
});

// ---- capitals ----------------------------------------------------------------
test('single capital takes one cap indicator', () => {
  assert.deepEqual(cells('I', 1), [CAP, LETTER_MASK.i]);
});
test('caps word takes double indicator', () => {
  const c = cells('STEM', 1);
  assert.equal(c[0], CAP); assert.equal(c[1], CAP);
});
test('caps word letters are not individually capped', () => {
  const c = cells('EXIT', 1);
  assert.equal(c.filter(m => m === CAP).length, 2);
  assert.equal(c.length, 6);
});
test('mixed case letters take per-letter indicators', () => {
  const c = cells('Mc', 1);
  assert.deepEqual(c, [CAP, LETTER_MASK.m, LETTER_MASK.c]);
});
test('cap indicator then wordsign for title-case "The"', () => {
  const c = cells('The');
  assert.deepEqual(c, [CAP, STRONG_WORDSIGNS.the]);
});
test('cap indicator then alphabetic wordsign for "But"', () => {
  assert.deepEqual(cells('But'), [CAP, LETTER_MASK.b]);
});

for (const [word, letter] of Object.entries(ALPHABETIC_WORDSIGNS)) {
  test('Grade 2 standalone identifier ' + letter + ' is distinct from the wordsign ' + word, () => {
    assert.deepEqual(cells(letter), [G1, LETTER_MASK[letter]]);
    assert.deepEqual(cells(letter.toUpperCase()), [G1, CAP, LETTER_MASK[letter]]);
    assert.deepEqual(cells("'" + letter.toUpperCase() + "'").slice(1, -1), [G1, CAP, LETTER_MASK[letter]]);
    assert.notDeepEqual(cells(letter), cells(word));
    const title = word[0].toUpperCase() + word.slice(1);
    assert.notDeepEqual(cells(letter.toUpperCase()), cells(title));
    assert.deepEqual(cells('Room ' + letter.toUpperCase() + '.').slice(-4, -1), [G1, CAP, LETTER_MASK[letter]]);
    assert.deepEqual(cells(letter, 1), [LETTER_MASK[letter]]);
  });
}

test('Exit Stairwell B has an unambiguous Grade 2 final identifier', () => {
  assert.deepEqual(cells('Exit Stairwell B').slice(-3), [G1, CAP, LETTER_MASK.b]);
});

// ---- punctuation --------------------------------------------------------------
const PUNCT_VECTORS = {
  ',': [0x02], ';': [0x06], ':': [0x12], '.': [0x32], '!': [0x16], '?': [0x26],
  "'": [0x04], '-': [0x24], '/': [0x38, 0x0c], '\\': [0x38, 0x21],
  '(': [0x10, 0x23], ')': [0x10, 0x1c], '[': [0x28, 0x23], ']': [0x28, 0x1c],
  '{': [0x38, 0x23], '}': [0x38, 0x1c], '@': [0x08, 0x01], '&': [0x08, 0x2f],
  '#': [0x38, 0x39], '$': [0x08, 0x0e], '%': [0x28, 0x34], '*': [0x10, 0x14],
  '+': [0x10, 0x16], '=': [0x10, 0x36], '_': [0x28, 0x24],
  '\u2013': [0x20, 0x24], '…': [0x32, 0x32, 0x32], '°': [0x18, 0x1a]
};
for (const [ch, expected] of Object.entries(PUNCT_VECTORS)) {
  test(`punct ${JSON.stringify(ch)} encodes to [${expected.map(m => '0x' + m.toString(16)).join(', ')}]`, () => {
    assert.deepEqual(cells(`x${ch}y`, 1).slice(1, -1), expected);
  });
}
test('interior apostrophe binds the word ("don\'t")', () => {
  assert.deepEqual(cells("don't", 1), [LETTER_MASK.d, LETTER_MASK.o, LETTER_MASK.n, 0x04, LETTER_MASK.t]);
});
test('opening double quote uses open-quote cell', () => {
  const c = cells(' "hi" ', 1);
  assert.equal(c[1], 0x26);
  assert.equal(c[4], 0x34);
});

// ---- alphabetic wordsigns -----------------------------------------------------
for (const [word, letter] of Object.entries(ALPHABETIC_WORDSIGNS)) {
  test(`alphabetic wordsign "${word}" is one cell (${letter})`, () => {
    assert.deepEqual(cells(word), [LETTER_MASK[letter]]);
  });
  test(`alphabetic wordsign "${word}" does not contract inside a word`, () => {
    const inner = cells(`x${word}x`);
    assert.ok(inner.length > 1, `${word} contracted inside word`);
  });
}
test('wordsign requires standalone word: "doit" stays uncontracted', () => {
  assert.ok(cells('doit').length >= 4);
});

// ---- strong wordsigns & groupsigns ---------------------------------------------
for (const [txt, mask] of Object.entries(STRONG_WORDSIGNS)) {
  test(`strong wordsign "${txt}" is cell 0x${mask.toString(16)}`, () => {
    assert.deepEqual(cells(txt), [mask]);
  });
}
for (const [txt, mask] of Object.entries(STRONG_GROUPSIGNS)) {
  const word = txt === 'ing' ? `x${txt}` : `${txt}`; // "ing" can't open a word
  test(`groupsign "${txt}" appears inside "x${word}y"`, () => {
    const c = cells(`x${word}y`, 2);
    assert.ok(c.includes(mask), `mask 0x${mask.toString(16)} not in [${c.join(',')}]`);
  });
}
test('"ing" may not open a word', () => {
  const c = cells('ingot', 2);
  assert.deepEqual(c.slice(0, 3), [LETTER_MASK.i, LETTER_MASK.n, LETTER_MASK.g]);
});
test('"church" is ch-u-r-ch', () => {
  assert.equal(uni('church'), '⠡⠥⠗⠡');
});
test('"within" is with-in', () => {
  assert.deepEqual(cells('within'), [STRONG_WORDSIGNS.with, LETTER_MASK.i, LETTER_MASK.n]);
});
test('"therefore" uses the + for', () => {
  const c = cells('therefore');
  assert.equal(c[0], STRONG_WORDSIGNS.the);
  assert.ok(c.includes(STRONG_WORDSIGNS.for));
});
test('space is a blank cell', () => {
  assert.deepEqual(cells('a b', 1), [LETTER_MASK.a, 0, LETTER_MASK.b]);
});

// ---- savings metrics -------------------------------------------------------------
test('Grade 2 saves cells on a sentence', () => {
  const r = encode('the people and you will go with us');
  assert.ok(r.stats.cellsSaved >= 8);
  assert.ok(r.stats.cells < r.stats.uncontractedCells);
});
test('Grade 2 never expands a plain word', () => {
  for (const w of ['quiz', 'box', 'jump', 'vexed']) {
    const r = encode(w);
    assert.ok(r.cells.length <= w.length, w);
  }
});
test('saving percent is consistent', () => {
  const r = encode('that and the knowledge');
  assert.equal(r.stats.savingPct, Math.round((r.stats.cellsSaved / r.stats.uncontractedCells) * 1000) / 10);
});

// ---- unicode + mask primitives ----------------------------------------------------
for (let m = 0; m < 64; m += 1) {
  test(`mask 0x${m.toString(16).padStart(2, '0')} unicode round trip`, () => {
    assert.equal(unicodeToMask(maskToUnicode(m)), m);
  });
}
test('dotsOf and maskOfDots invert each other', () => {
  for (let m = 0; m < 64; m++) assert.equal(maskOfDots(dotsOf(m)), m);
});
test('unicodeToMask rejects non-braille', () => {
  assert.equal(unicodeToMask('A'), null);
});

// ---- Grade-1 round trip -------------------------------------------------------------
const RT_CORPUS = [
  'a', 'z', 'A', 'Z', 'Hello World', 'STEM ROOM 204', 'Quiet Please',
  'Exit 3', 'Science Lab', 'Braille 1829', 'A B C 1 2 3', 'Room 204',
  'The Quick Brown Fox', 'Grade 1', 'forty two 42', 'Ms Lee', 'It is 5',
  'Do not open', 'half past 9', 'TEST 100', 'x', 'Mc', 'OK', '3 apples',
  'Cost is 3', 'lab bench 7', 'dot 6', 'see section 9', 'a-b',
  'one, two, three', 'wait!', 'really?', '(paren)', '[bracket]',
  '3m', '3mx', '3M', '1,000', '3.5', '1.5.7', '(3,4)', '1,k',
  '3D', '3Dx', 'A1', 'B2B', 'ROOM204', 'ABC123', 'R2D2', '12ab', 'x2'
];
for (const s of RT_CORPUS) {
  test(`G1 round trip ${JSON.stringify(s)}`, () => {
    assert.equal(decodeG1(encode(s, { grade: 1 }).cells), s);
  });
}
test('decodeG1 accepts unicode braille strings', () => {
  assert.equal(decodeG1(cellsToUnicode(encode('abc', { grade: 1 }).cells)), 'abc');
});
test('decodeG1: k-z letter after a number ends numeric mode', () => {
  assert.equal(decodeG1([NUM, LETTER_MASK.c, LETTER_MASK.m]), '3m');
  assert.equal(decodeG1([NUM, LETTER_MASK.c, LETTER_MASK.m, LETTER_MASK.x]), '3mx');
});
test('decodeG1: capitalized k-z letter after a number is a letter, not a digit', () => {
  assert.equal(decodeG1([NUM, LETTER_MASK.c, CAP, LETTER_MASK.m]), '3M');
});
test('decodeG1: numeric comma keeps numeric mode before a digit', () => {
  assert.equal(decodeG1([NUM, LETTER_MASK.a, 0x02, LETTER_MASK.j, LETTER_MASK.j, LETTER_MASK.j]), '1,000');
});
test('decodeG1: decimal point keeps numeric mode before a digit', () => {
  assert.equal(decodeG1([NUM, LETTER_MASK.c, 0x32, LETTER_MASK.e]), '3.5');
});
test('decodeG1: comma before a non-digit ends numeric mode', () => {
  assert.equal(decodeG1([NUM, LETTER_MASK.a, 0x02, LETTER_MASK.k]), '1,k');
});
test('decodeG1 throws on non-braille input', () => {
  assert.throws(() => decodeG1('abc'));
});
test('describeCell reports dots, unicode and rule', () => {
  const d = describeCell(LETTER_MASK.w, { src: 'w', rule: 'letter' });
  assert.deepEqual(d.dots, [2, 4, 5, 6]);
  assert.equal(d.unicode, 'U+283A');
  assert.equal(d.letter, 'w');
});

// ---- full-sentence UEB vectors ------------------------------------------------------
const VECTORS = [
  ['the', 2, '⠮'],
  ['and', 2, '⠯'],
  ['for', 2, '⠿'],
  ['of', 2, '⠷'],
  ['with', 2, '⠾'],
  ['but', 2, '⠃'],
  ['can', 2, '⠉'],
  ['knowledge', 2, '⠅'],
  ['people', 2, '⠏'],
  ['that', 2, '⠞'],
  ['you', 2, '⠽'],
  ['it', 2, '⠭'],
  ['church', 2, '⠡⠥⠗⠡'],
  ['about', 2, '⠁⠃⠳⠞'],
  ['shadow', 2, '⠩⠁⠙⠪'],
  ['thing', 2, '⠹⠬'],
  ['hello', 1, '⠓⠑⠇⠇⠕'],
  ['123', 1, '⠼⠁⠃⠉'],
  ['a', 1, '⠁'],
  ['I', 1, '⠠⠊'],
  ['OK', 1, '⠠⠠⠕⠅'],
  ['the and with', 2, '⠮⠀⠯⠀⠾'],
  ['ar', 2, '⠜'],
  ['st', 2, '⠌'],
  ['er', 2, '⠻'],
  ['ow', 2, '⠪'],
  ['ou', 2, '⠳'],
  ['ed', 2, '⠫'],
  ['gh', 2, '⠣'],
  ['sh', 2, '⠩'],
  ['th', 2, '⠹'],
  ['wh', 2, '⠱'],
  ['ch', 2, '⠡'],
  ['ingot', 2, '⠊⠝⠛⠕⠞'],
  ['star', 2, '⠌⠜'],
  ['mother', 2, '⠍⠕⠮⠗']
];
for (const [src, g, want] of VECTORS) {
  test(`vector ${JSON.stringify(src)} (g${g}) -> ${want}`, () => {
    assert.equal(uni(src, g), want);
  });
}
