// perkins.mjs: 6-key Perkins Brailler chord trainer core.
//
// Key map mirrors a real brailler: F D S strike dots 1-2-3 (left column),
// J K L strike dots 4-5-6 (right column), Space advances a blank cell.
// A chord is committed when every pressed key is released, exactly like the
// embossing head of a Perkins.

export const KEY_TO_DOT = { f: 1, d: 2, s: 3, j: 4, k: 5, l: 6 };
export const DOT_TO_KEY = { 1: 'f', 2: 'd', 3: 's', 4: 'j', 5: 'k', 6: 'l' };

export function chordToMask(dots) {
  let m = 0;
  for (const d of dots) m |= 1 << (d - 1);
  return m;
}

export function maskToChordKeys(mask) {
  const keys = [];
  for (let d = 1; d <= 6; d++) if (mask & (1 << (d - 1))) keys.push(DOT_TO_KEY[d]);
  return keys;
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

import { LETTER_MASK, STRONG_WORDSIGNS, STRONG_GROUPSIGNS, ALPHABETIC_WORDSIGNS, NUM, CAP, maskToUnicode, dotsOf } from './ueb.mjs';

// item: {prompt, hint, cells:[masks]}: one braille cell per chord, space = pause
function cellsFromText(text) {
  const cells = [];
  for (const ch of text) {
    if (ch === ' ') { cells.push(0); continue; }
    cells.push(LETTER_MASK[ch.toLowerCase()] ?? 0);
  }
  return cells;
}

export const LESSONS = [
  {
    id: 'home-row',
    title: 'Lesson 1: Home Row Letters',
    blurb: 'The alphabet in decades: a-j use only dots 1,2,4,5; k-t add dot 3; u-z add dot 6.',
    items: [
      ...[...'abcde'].map(ch => ({ prompt: ch.toUpperCase(), hint: `letter ${ch}`, cells: [LETTER_MASK[ch]] })),
      { prompt: 'SPACE', hint: 'press Space for a blank cell', cells: [0] },
      ...[...'fghij'].map(ch => ({ prompt: ch.toUpperCase(), hint: `letter ${ch}`, cells: [LETTER_MASK[ch]] })),
      { prompt: 'ADA', hint: 'three-letter caps word', cells: [CAP, CAP, ...cellsFromText('ada')] },
      ...[...'klmno'].map(ch => ({ prompt: ch.toUpperCase(), hint: `letter ${ch}`, cells: [LETTER_MASK[ch]] })),
      ...[...'pqrst'].map(ch => ({ prompt: ch.toUpperCase(), hint: `letter ${ch}`, cells: [LETTER_MASK[ch]] })),
      ...[...'uvwxyz'].map(ch => ({ prompt: ch.toUpperCase(), hint: `letter ${ch}`, cells: [LETTER_MASK[ch]] }))
    ]
  },
  {
    id: 'numbers',
    title: 'Lesson 2: Numbers and Indicators',
    blurb: 'The number sign opens numeric mode; a-j then read as 1-9 and 0.',
    items: [
      { prompt: '1', hint: 'number sign then a', cells: [NUM, LETTER_MASK.a] },
      { prompt: '7', hint: 'number sign then g', cells: [NUM, LETTER_MASK.g] },
      { prompt: '20', hint: 'number sign then b j', cells: [NUM, LETTER_MASK.b, LETTER_MASK.j] },
      { prompt: '204', hint: 'number sign then b j d', cells: [NUM, LETTER_MASK.b, LETTER_MASK.j, LETTER_MASK.d] },
      { prompt: 'EXIT 3', hint: 'caps, then a number', cells: [CAP, CAP, ...cellsFromText('exit'), 0, NUM, LETTER_MASK.c] },
      { prompt: 'a1', hint: 'letter, then number sign', cells: [LETTER_MASK.a, NUM, LETTER_MASK.a] }
    ]
  },
  {
    id: 'grade2',
    title: 'Lesson 3: Grade 2 Contractions',
    blurb: 'One cell, whole words: alphabetic wordsigns and the strong signs.',
    items: [
      { prompt: 'and', hint: 'strong wordsign, dots 1-2-3-4-6', cells: [STRONG_WORDSIGNS.and] },
      { prompt: 'the', hint: 'strong wordsign, dots 2-3-4-6', cells: [STRONG_WORDSIGNS.the] },
      { prompt: 'for', hint: 'strong wordsign, all six dots', cells: [STRONG_WORDSIGNS.for] },
      { prompt: 'of', hint: 'strong wordsign, dots 1-2-3-5-6', cells: [STRONG_WORDSIGNS.of] },
      { prompt: 'with', hint: 'strong wordsign, dots 2-3-4-5-6', cells: [STRONG_WORDSIGNS.with] },
      { prompt: 'but', hint: 'alphabetic wordsign: b', cells: [LETTER_MASK.b] },
      { prompt: 'you', hint: 'alphabetic wordsign: y', cells: [LETTER_MASK.y] },
      { prompt: 'it', hint: 'alphabetic wordsign: x', cells: [LETTER_MASK.x] },
      { prompt: 'ch', hint: 'groupsign, dots 1-6', cells: [STRONG_GROUPSIGNS.ch] },
      { prompt: 'ing', hint: 'groupsign, dots 3-4-6', cells: [STRONG_GROUPSIGNS.ing] },
      { prompt: 'ar', hint: 'groupsign, dots 3-4-5', cells: [STRONG_GROUPSIGNS.ar] },
      { prompt: 'ou', hint: 'groupsign, dots 1-2-5-6', cells: [STRONG_GROUPSIGNS.ou] }
    ]
  },
  {
    id: 'signage',
    title: 'Lesson 4: Real Classroom Signage',
    blurb: 'Chord complete ADA-style room signs, exactly as the plaque generator sets them.',
    items: [
      { prompt: 'QUIET', hint: 'caps word then letters', cells: [CAP, CAP, ...cellsFromText('quiet')] },
      { prompt: 'ROOM 204', hint: 'caps word, space, number', cells: [CAP, CAP, ...cellsFromText('room'), 0, NUM, LETTER_MASK.b, LETTER_MASK.j, LETTER_MASK.d] },
      { prompt: 'EXIT', hint: 'caps word', cells: [CAP, CAP, ...cellsFromText('exit')] },
      { prompt: 'LAB', hint: 'caps word', cells: [CAP, CAP, ...cellsFromText('lab')] },
      { prompt: 'STEM CLUB', hint: 'two caps words', cells: [CAP, CAP, ...cellsFromText('stem'), 0, CAP, CAP, ...cellsFromText('club')] }
    ]
  }
];

export function lessonById(id) {
  return LESSONS.find(l => l.id === id) || LESSONS[0];
}

// ---------------------------------------------------------------------------
// Session: chord capture, checking, and live stats (DOM-free, Node-testable)
// ---------------------------------------------------------------------------

export class PerkinsSession {
  constructor(lessonId) {
    this.lesson = lessonById(lessonId);
    this.itemIndex = 0;
    this.cellIndex = 0;
    this.pressed = new Set();
    this.attempts = 0;
    this.correct = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.startedAt = null; // ms epoch of first commit
    this.finishedAt = null;
    this.history = [];
  }

  get item() { return this.lesson.items[this.itemIndex] ?? null; }
  get expectedMask() { return this.item ? this.item.cells[this.cellIndex] : null; }
  get done() { return this.itemIndex >= this.lesson.items.length; }

  press(key) {
    const dot = KEY_TO_DOT[key];
    if (dot) this.pressed.add(dot);
  }

  release(key) {
    // real braillers commit on full release; per-key release is a no-op here
    void key;
  }

  // Commit when all keys are up. Returns the graded chord (or null if still held).
  commit({ space = false } = {}) {
    if (this.done) return null;
    if (this.startedAt === null) this.startedAt = Date.now();
    const mask = space ? 0 : chordToMask([...this.pressed]);
    this.pressed.clear();
    const expected = this.expectedMask;
    const ok = mask === expected;
    this.attempts++;
    if (ok) {
      this.correct++;
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      this.cellIndex++;
      if (this.cellIndex >= this.item.cells.length) {
        this.itemIndex++;
        this.cellIndex = 0;
      }
      if (this.done) this.finishedAt = Date.now();
    } else {
      this.streak = 0;
    }
    this.history.push({ mask, expected, ok });
    return { mask, expected, ok, done: this.done };
  }

  progress() {
    const totalCells = this.lesson.items.reduce((n, i) => n + i.cells.length, 0);
    let doneCells = 0;
    for (let i = 0; i < this.itemIndex; i++) doneCells += this.lesson.items[i].cells.length;
    doneCells += this.cellIndex;
    return { totalCells, doneCells, itemIndex: this.itemIndex, itemCount: this.lesson.items.length };
  }

  stats() {
    const end = this.finishedAt ?? Date.now();
    const minutes = this.startedAt ? Math.max((end - this.startedAt) / 60000, 1 / 60000) : 0;
    const cpm = minutes ? Math.round((this.correct / minutes) * 10) / 10 : 0;
    return {
      attempts: this.attempts,
      correct: this.correct,
      accuracy: this.attempts ? Math.round((this.correct / this.attempts) * 1000) / 10 : 100,
      cpm,
      wpm: Math.round((cpm / 5) * 10) / 10,
      streak: this.streak,
      bestStreak: this.bestStreak,
      done: this.done
    };
  }
}

// ---------------------------------------------------------------------------
// Pure WebAudio tactile feedback (browser-only; constructed lazily by the app)
// ---------------------------------------------------------------------------

export function createClicker(audioCtx) {
  const ctx = audioCtx;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  let muted = false;
  const blip = (freq, dur, type = 'square', gain = 1) => {
    if (muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5 * gain, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  };
  return {
    get muted() { return muted; },
    setMuted(v) { muted = !!v; },
    click() { blip(1400, 0.05, 'square', 0.5); },
    good() { blip(880, 0.09, 'triangle', 0.8); blip(1320, 0.14, 'triangle', 0.5); },
    bad() { blip(160, 0.16, 'sawtooth', 0.5); },
    finish() { blip(660, 0.12, 'triangle', 0.7); blip(990, 0.18, 'triangle', 0.6); }
  };
}

export function describeChord(mask) {
  return {
    mask,
    dots: dotsOf(mask),
    keys: maskToChordKeys(mask),
    unicode: maskToUnicode(mask),
    isSpace: mask === 0
  };
}
