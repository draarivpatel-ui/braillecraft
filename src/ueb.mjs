// ueb.mjs — Unified English Braille (UEB) transcription engine.
//
// Implements Grade 1 (uncontracted) and a documented core subset of Grade 2
// (contracted) UEB per ICEB "The Rules of Unified English Braille" (3rd ed.
// 2024): the 26 letters, 10 digits, capital and numeric mode indicators,
// the core punctuation/symbol set, all 23 alphabetic wordsigns, the five
// strong wordsigns, and the twelve strong groupsigns.
//
// Every cell is an exact 6-dot bitmask: dot n -> bit (1 << (n-1)).
// Unicode Braille Patterns occupy U+2800..U+283F; mask m -> U+2800 + m.

export const BLANK = 0x00;
export const CAP = 0x20; // dot 6 — capital letter indicator
export const CAPS_TERM = 0x04; // dot 3 — after dot 6: capital passage terminator
export const NUM = 0x3c; // dots 3-4-5-6 — numeric indicator
export const G1 = 0x30; // dots 5-6 — grade 1 symbol indicator
export const BRAILLE_BASE = 0x2800;

// ---------------------------------------------------------------------------
// Dot/cell primitives
// ---------------------------------------------------------------------------

export function dotsOf(mask) {
  const dots = [];
  for (let n = 1; n <= 6; n++) if (mask & (1 << (n - 1))) dots.push(n);
  return dots;
}

export function maskOfDots(dots) {
  let m = 0;
  for (const d of dots) m |= 1 << (d - 1);
  return m;
}

export function maskToUnicode(mask) {
  return String.fromCodePoint(BRAILLE_BASE + (mask & 0x3f));
}

export function unicodeToMask(ch) {
  const cp = ch.codePointAt(0);
  if (cp < BRAILLE_BASE || cp > BRAILLE_BASE + 0x3f) return null;
  return cp - BRAILLE_BASE;
}

export function cellsToUnicode(cells) {
  return cells.map(maskToUnicode).join('');
}

// ---------------------------------------------------------------------------
// Alphabet and digits (UEB section 8, numeric mode section 6)
// ---------------------------------------------------------------------------

// a-j are the first decade (dots 1,2,4,5); k-t add dot 3; u-z (except w)
// add dot 6; w is j shifted by dot 6 (the historic French exception).
export const LETTER_MASK = {
  a: 0x01, b: 0x03, c: 0x09, d: 0x19, e: 0x11,
  f: 0x0b, g: 0x1b, h: 0x13, i: 0x0a, j: 0x1a,
  k: 0x05, l: 0x07, m: 0x0d, n: 0x1d, o: 0x15,
  p: 0x0f, q: 0x1f, r: 0x17, s: 0x0e, t: 0x1e,
  u: 0x25, v: 0x27, w: 0x3a, x: 0x2d, y: 0x3d, z: 0x35
};

export const MASK_TO_LETTER = Object.fromEntries(
  Object.entries(LETTER_MASK).map(([c, m]) => [m, c])
);

// In numeric mode a-j stand for 1-9,0.
export const DIGIT_LETTER = 'abcdefghi j'.replace(' ', '');
export const DIGIT_TO_LETTER = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f', '7': 'g', '8': 'h', '9': 'i', '0': 'j' };
export const LETTER_TO_DIGIT = Object.fromEntries(
  Object.entries(DIGIT_TO_LETTER).map(([d, l]) => [l, d])
);

// ---------------------------------------------------------------------------
// Punctuation and symbols (UEB section 7 + general symbols section 3)
// Multi-cell signs are emitted atomically so the decoder can longest-match.
// ---------------------------------------------------------------------------

const OPEN_Q = 0x26; // dots 2-3-6 — also the question mark (ambiguous by design)
const CLOSE_Q = 0x34; // dots 3-5-6

export const PUNCT = {
  ',': [0x02],
  ';': [0x06],
  ':': [0x12],
  '.': [0x32],
  '!': [0x16],
  '?': [OPEN_Q],
  '\u2018': [CAP, OPEN_Q], // ' opening single quote
  '\u2019': [CAP, CLOSE_Q], // ' closing single quote
  '\u201c': [OPEN_Q], // " opening double quote
  '\u201d': [CLOSE_Q], // " closing double quote
  '(': [0x10, 0x23],
  ')': [0x10, 0x1c],
  '[': [0x28, 0x23],
  ']': [0x28, 0x1c],
  '{': [0x38, 0x23],
  '}': [0x38, 0x1c],
  '<': [0x08, 0x23],
  '>': [0x08, 0x1c],
  '/': [0x38, 0x0c],
  '\\': [0x38, 0x21],
  '-': [0x24],
  '\u2013': [0x20, 0x24], // – dash
  '\u2014': [0x10, 0x20, 0x24], // — long dash
  '\u2026': [0x32, 0x32, 0x32], // … ellipsis
  '_': [0x28, 0x24],
  '@': [0x08, 0x01],
  '&': [0x08, 0x2f],
  '#': [0x38, 0x39],
  '$': [0x08, 0x0e],
  '%': [0x28, 0x34],
  '*': [0x10, 0x14],
  '+': [0x10, 0x16],
  '=': [0x10, 0x36],
  '\u00b0': [0x18, 0x1a], // ° degree
  '\u00a9': [0x18, 0x09], // © copyright
};

// Straight ASCII quotes need context disambiguation: opening after start,
// space or an opening bracket; closing otherwise.
const ASCII_OPEN_DQ = [OPEN_Q];
const ASCII_CLOSE_DQ = [CLOSE_Q];
const APOSTROPHE = [0x04];

// ---------------------------------------------------------------------------
// Grade 2 contractions (UEB section 10)
// ---------------------------------------------------------------------------

// Alphabetic wordsigns: single letters standing for whole words. Contract
// only when the entire word (standing alone) is exactly this text.
export const ALPHABETIC_WORDSIGNS = {
  but: 'b', can: 'c', do: 'd', every: 'e', from: 'f', go: 'g',
  have: 'h', just: 'j', knowledge: 'k', like: 'l', more: 'm', not: 'n',
  people: 'p', quite: 'q', rather: 'r', so: 's', that: 't', us: 'u',
  very: 'v', will: 'w', it: 'x', you: 'y', as: 'z'
};

// Strong wordsigns: standalone words and usable inside longer words.
export const STRONG_WORDSIGNS = {
  and: 0x2f, for: 0x3f, of: 0x37, the: 0x2e, with: 0x3e
};

// Strong groupsigns: usable wherever their letters occur together.
// "ing" may not begin a word (UEB 10.6.8).
export const STRONG_GROUPSIGNS = {
  ch: 0x21, gh: 0x23, sh: 0x29, th: 0x39, wh: 0x31, ed: 0x2b,
  er: 0x3b, ou: 0x33, ow: 0x2a, st: 0x0c, ar: 0x1c, ing: 0x2c
};

const WORD_PART_SIGNS = (() => {
  const all = Object.entries({ ...STRONG_WORDSIGNS, ...STRONG_GROUPSIGNS })
    .map(([txt, mask]) => ({ txt, mask, rule: txt in STRONG_WORDSIGNS ? 'strong-wordsign' : 'groupsign' }));
  // Longest match first so "with" beats "th"/"wi" and "ing" beats nothing.
  all.sort((a, b) => b.txt.length - a.txt.length || a.txt.localeCompare(b.txt));
  return all;
})();

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

function isLetter(ch) { return /[a-z]/i.test(ch); }
function isDigit(ch) { return /[0-9]/.test(ch); }
function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'; }

// Contract one word (letters only, lowercase) into cells+tokens, Grade 2.
function contractWord(word, tokens, opts = {}) {
  let i = 0;
  while (i < word.length) {
    let hit = null;
    if (opts.groupsigns !== false) {
      for (const s of WORD_PART_SIGNS) {
        if (!word.startsWith(s.txt, i)) continue;
        if (s.txt === 'ing' && i === 0) continue; // "ing" may not open a word
        hit = s;
        break;
      }
    }
    if (hit) {
      tokens.push({ cells: [hit.mask], src: hit.txt, rule: hit.rule });
      i += hit.txt.length;
    } else {
      const ch = word[i];
      if (ch === "'") {
        tokens.push({ cells: [0x04], src: "'", rule: 'apostrophe' });
      } else {
        tokens.push({ cells: [LETTER_MASK[ch]], src: ch, rule: 'letter' });
      }
      i += 1;
    }
  }
}

// Encode text to UEB cells. Returns {cells, tokens, unicode, stats}.
export function encodeUEB(text, { grade = 2 } = {}) {
  const src = String(text ?? '').normalize('NFC');
  const tokens = [];
  let numericMode = false; // inside the numeric indicator's reach
  let capsWord = false; // capitalized-word mode

  const push = (cells, s, rule) => { tokens.push({ cells, src: s, rule }); };

  // Word segmentation: letters plus interior apostrophes that bind a word
  // ("don't", "o'clock") stay in the word; everything else is its own unit.
  const units = [];
  let cur = '';
  let curKind = null;
  const kindOf = ch => isLetter(ch) ? 'word' : isDigit(ch) ? 'num' : isSpace(ch) ? 'space' : 'sym';
  const chars = [...src];
  for (let idx = 0; idx < chars.length; idx++) {
    const ch = chars[idx];
    const k = kindOf(ch);
    if (k === 'word' && curKind === 'word') { cur += ch; continue; }
    if (k === 'num' && (curKind === 'num' || curKind === 'word')) {
      // digits bind to a running numeric/word unit so "Room204" stays whole
      cur += ch; curKind = curKind === 'word' ? 'word' : 'num'; continue;
    }
    if (k === 'word' && curKind === 'num') {
      // letter run closing a numeric unit ("3rd")
      cur += ch; curKind = 'word'; continue;
    }
    // numeric comma / decimal point bind inside a running number
    if ((ch === ',' || ch === '.') && curKind === 'num' && isDigit(chars[idx + 1] ?? '')) {
      cur += ch; continue;
    }
    if (ch === "'" && curKind === 'word') { cur += ch; continue; } // interior apostrophe
    if (cur) units.push({ kind: curKind, text: cur });
    cur = ch; curKind = k;
  }
  if (cur) units.push({ kind: curKind, text: cur });

  for (const unit of units) {
    if (unit.kind === 'space') {
      for (const _ of unit.text) push([BLANK], ' ', 'space');
      numericMode = false; capsWord = false;
      continue;
    }

    if (unit.kind === 'word') {
      const word = unit.text;
      const letters = word.replace(/'/g, '');
      const allCaps = letters.length >= 2 && letters === letters.toUpperCase() && /[A-Z]/.test(letters);

      if (grade >= 2 && /^[a-z]+$/.test(word) && ALPHABETIC_WORDSIGNS[word]) {
        push([LETTER_MASK[ALPHABETIC_WORDSIGNS[word]]], word, 'alphabetic-wordsign');
        numericMode = false;
        continue;
      }
      // Title case ("The", "Church"): one leading capital, rest lowercase
      // letters. The capital indicator precedes the whole contraction, so
      // "The" is cap + the-sign and "Church" is cap + ch-u-r-ch.
      const titleCase = /^[A-Z][a-z']+$/.test(word);
      if (titleCase) {
        const lower = word.toLowerCase();
        if (grade >= 2 && ALPHABETIC_WORDSIGNS[lower]) {
          push([CAP, LETTER_MASK[ALPHABETIC_WORDSIGNS[lower]]], word, 'cap-alphabetic-wordsign');
        } else {
          push([CAP], word[0], 'cap-letter');
          contractWord(lower, tokens, { groupsigns: grade >= 2 });
        }
        numericMode = false;
        continue;
      }
      if (allCaps) {
        push([CAP, CAP], word.slice(0, 2), 'caps-word-indicator');
        capsWord = true;
        contractWord(word.toLowerCase(), tokens, { groupsigns: grade >= 2 });
        capsWord = false;
        numericMode = false;
        continue;
      }
      // Mixed case / lowercase word: char-by-char so "Room204" and "McDonald" work.
      capsWord = false;
      let j = 0;
      let pending = ''; // accumulate a lowercase-letter run for contraction
      const flushRun = () => {
        if (!pending) return;
        contractWord(pending, tokens, { groupsigns: grade >= 2 });
        pending = '';
      };
      while (j < word.length) {
        const ch = word[j];
        if (ch === "'") {
          flushRun();
          push(APOSTROPHE, "'", 'apostrophe');
          j++; numericMode = false;
          continue;
        }
        if (isDigit(ch)) {
          flushRun();
          // digit run with interior . or , kept numeric
          let k = j;
          push([NUM], ch, 'numeric-indicator');
          numericMode = true;
          while (k < word.length && (isDigit(word[k]) || ((word[k] === '.' || word[k] === ',') && isDigit(word[k + 1])))) {
            const dc = word[k];
            if (isDigit(dc)) {
              push([LETTER_MASK[DIGIT_LETTER[Number(dc) === 0 ? 9 : Number(dc) - 1]]], dc, 'digit');
            } else {
              push(PUNCT[dc], dc, dc === '.' ? 'decimal' : 'numeric-comma');
            }
            k++;
          }
          j = k;
          continue;
        }
        if (!isLetter(ch)) { flushRun(); j++; continue; }
        const cap = ch === ch.toUpperCase();
        if (cap || numericMode) {
          flushRun();
          if (numericMode && 'abcdefghij'.includes(ch.toLowerCase())) {
            push([G1], ch, 'grade1-indicator');
          }
          numericMode = false;
          if (cap) push([CAP], ch, 'cap-letter');
          push([LETTER_MASK[ch.toLowerCase()]], ch, 'letter');
          j++;
          continue;
        }
        // lowercase letter in letter context: may contract
        pending += ch;
        numericMode = false;
        j++;
      }
      flushRun();
      continue;
    }

    if (unit.kind === 'num') {
      let j = 0;
      push([NUM], unit.text[0], 'numeric-indicator');
      numericMode = true;
      while (j < unit.text.length) {
        const dc = unit.text[j];
        if (isDigit(dc)) push([LETTER_MASK[DIGIT_TO_LETTER[dc]]], dc, 'digit');
        else push(PUNCT[dc], dc, dc === '.' ? 'decimal' : 'numeric-comma');
        j++;
      }
      continue;
    }

    // Symbols / punctuation
    for (const ch of unit.text) {
      numericMode = false; capsWord = false;
      if (ch === '"') {
        const prev = tokens.length ? tokens[tokens.length - 1].src : ' ';
        const opening = prev === ' ' || prev === '(' || prev === '[' || prev === '{';
        push(opening ? ASCII_OPEN_DQ : ASCII_CLOSE_DQ, ch, opening ? 'open-quote' : 'close-quote');
        continue;
      }
      if (ch === "'") {
        // leading or trailing apostrophe outside a word
        push(APOSTROPHE, "'", 'apostrophe');
        continue;
      }
      const cells = PUNCT[ch];
      if (cells) push(cells, ch, 'punct');
      else push([BLANK], ch, 'unsupported');
    }
  }

  const cells = tokens.flatMap(t => t.cells);
  return { cells, tokens, unicode: cellsToUnicode(cells), stats: {} };
}

// Grade-1 cells for the same text, for savings metrics.
export function grade1Cells(text) {
  return encodeUEB(text, { grade: 1 }).cells;
}

export function statsFor(text, cells) {
  const uncontracted = grade1Cells(text).length;
  const saved = uncontracted - cells.length;
  return {
    sourceChars: String(text).length,
    cells: cells.length,
    uncontractedCells: uncontracted,
    cellsSaved: saved,
    savingPct: uncontracted ? Math.round((saved / uncontracted) * 1000) / 10 : 0
  };
}

export function encode(text, opts) {
  const r = encodeUEB(text, opts);
  r.stats = statsFor(text, r.cells);
  return r;
}

// ---------------------------------------------------------------------------
// Grade 1 decoder (round-trip companion)
// Longest-match over the same tables. The question mark and opening double
// quote share one cell in UEB; the decoder reports '?' for it (documented).
// ---------------------------------------------------------------------------

const DECODE_PAIRS = (() => {
  const entries = [];
  for (const [ch, cells] of Object.entries(PUNCT)) entries.push({ cells, ch });
  entries.sort((a, b) => b.cells.length - a.cells.length);
  return entries;
})();

export function decodeG1(input) {
  const cells = typeof input === 'string'
    ? [...input].map(unicodeToMask)
    : [...input];
  if (cells.some(c => c === null || c === undefined)) {
    throw new Error('decodeG1: input contains non-braille characters');
  }
  let out = '';
  let numeric = false;
  let capNext = false;
  let capsWord = false;
  let literalNext = false;
  let i = 0;
  while (i < cells.length) {
    const m = cells[i];
    if (m === BLANK) { out += ' '; numeric = false; capsWord = false; i++; continue; }
    // longest-match multi-cell punctuation first, so bracket/quote/dash
    // pairs are not mistaken for indicator+letter sequences
    let matched = null;
    for (const e of DECODE_PAIRS) {
      if (e.cells.length > 1
          && i + e.cells.length <= cells.length
          && cells.slice(i, i + e.cells.length).every((c, k) => c === e.cells[k])) {
        matched = e; break;
      }
    }
    if (matched) { out += matched.ch; numeric = false; i += matched.cells.length; continue; }
    if (m === NUM) { numeric = true; i++; continue; }
    if (m === G1) { literalNext = true; numeric = false; i++; continue; }
    if (m === CAP) {
      if (cells[i + 1] === CAP) { capsWord = true; i += 2; continue; }
      if (cells[i + 1] === CAPS_TERM) { capsWord = false; i += 2; continue; }
      capNext = true; i++; continue;
    }

    if (MASK_TO_LETTER[m] !== undefined) {
      const l = MASK_TO_LETTER[m];
      if (numeric && !literalNext) {
        out += LETTER_TO_DIGIT[l];
      } else {
        out += (capNext || capsWord) ? l.toUpperCase() : l;
        capNext = false;
      }
      literalNext = false;
      i++;
      continue;
    }
    // single-cell punctuation
    const single = DECODE_PAIRS.find(e => e.cells.length === 1 && e.cells[0] === m);
    if (single) { out += single.ch === '\u201c' ? '?' : single.ch; numeric = false; i++; continue; }
    out += '\ufffd';
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cell description for the interactive inspector
// ---------------------------------------------------------------------------

export function describeCell(mask, token) {
  return {
    mask,
    dots: dotsOf(mask),
    unicode: `U+${(BRAILLE_BASE + mask).toString(16).toUpperCase().padStart(4, '0')}`,
    char: maskToUnicode(mask),
    letter: MASK_TO_LETTER[mask] ?? null,
    src: token?.src ?? null,
    rule: token?.rule ?? null
  };
}
