// selftest.mjs — in-browser verification suite for judges.
// Runs the same invariants as the Node test suite against the live modules
// and reports every check with a human-readable pass/fail line.

import {
  encode, decodeG1, cellsToUnicode, unicodeToMask, maskToUnicode,
  LETTER_MASK, ALPHABETIC_WORDSIGNS, STRONG_WORDSIGNS, STRONG_GROUPSIGNS,
  NUM, CAP, G1, dotsOf
} from './ueb.mjs';
import {
  ADA, layoutPlaque, buildMesh, toSTL, toSVG, verifyWatertight, meshVolume, triNormal
} from './tactile_geometry.mjs';
import { LESSONS, PerkinsSession, KEY_TO_DOT, maskToChordKeys } from './perkins.mjs';
import { PRESETS, encodeHash, decodeHash } from './presets.mjs';

function check(name, fn) {
  try {
    const detail = fn();
    return { name, pass: true, detail: detail || '' };
  } catch (err) {
    return { name, pass: false, detail: String(err && err.message || err) };
  }
}
function eq(a, b, what = '') {
  if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

export function runSelfTests() {
  const t = [];
  const enc = (s, g = 2) => encode(s, { grade: g });
  const masksOf = (s, g = 2) => enc(s, g).cells;

  t.push(check('UEB: all 26 letters encode to distinct masks', () => {
    const set = new Set(Object.values(LETTER_MASK));
    eq(set.size, 26, 'letter mask count');
    return '26/26 distinct';
  }));
  t.push(check('UEB: a = dot 1, w = dots 2-4-5-6 (French exception)', () => {
    eq(LETTER_MASK.a, 0x01); eq(LETTER_MASK.w, 0x3a);
  }));
  t.push(check('UEB: "the" is one cell (strong wordsign)', () => {
    eq(cellsToUnicode(masksOf('the')), '\u282e');
  }));
  t.push(check('UEB: all 23 alphabetic wordsigns contract standalone', () => {
    let n = 0;
    for (const w of Object.keys(ALPHABETIC_WORDSIGNS)) {
      const cells = masksOf(w);
      if (cells.length === 1) n++;
    }
    eq(n, 23); return '23/23 single-cell';
  }));
  t.push(check('UEB: strong wordsigns contract inside words ("within")', () => {
    const cells = masksOf('within');
    eq(cells[0], STRONG_WORDSIGNS.with); eq(cells.length, 3);
  }));
  t.push(check('UEB: groupsigns in "church" give ch-u-r-ch', () => {
    eq(cellsToUnicode(masksOf('church')), '\u2821\u2825\u2817\u2821');
  }));
  t.push(check('UEB: wordsigns never contract inside a word ("button")', () => {
    eq(masksOf('button').length, 6);
  }));
  t.push(check('UEB: capital letter takes one indicator ("I")', () => {
    eq(masksOf('I').join(','), `${CAP},${LETTER_MASK.i}`);
  }));
  t.push(check('UEB: caps word takes double indicator ("STEM")', () => {
    const c = masksOf('STEM');
    eq(c[0], CAP); eq(c[1], CAP);
  }));
  t.push(check('UEB: numbers take the numeric indicator', () => {
    const c = masksOf('204');
    eq(c[0], NUM); eq(c.length, 4);
  }));
  t.push(check('UEB: a-j after digits take the grade-1 indicator ("3d")', () => {
    const c = masksOf('3d');
    eq(c[0], NUM); eq(c[2], G1); eq(c[3], LETTER_MASK.d);
  }));
  t.push(check('UEB: Grade-1 round trip on 12 phrases', () => {
    const corpus = ['Hello World', 'STEM Room 204', 'Quiet Please', 'Exit 3',
      'Science Lab', 'Braille 1829', 'A B C 1 2 3', 'Room 204 is Quiet!',
      'The Quick Brown Fox', 'Grade 1', 'forty two 42', 'Ms Lee'];
    for (const s of corpus) eq(decodeG1(enc(s, { grade: 1 }).cells), s, s);
    return `${corpus.length}/${corpus.length}`;
  }));
  t.push(check('UEB: unicode mask round trip for all 64 cells', () => {
    for (let m = 0; m < 64; m++) eq(unicodeToMask(maskToUnicode(m)), m, `mask ${m}`);
    return '64/64';
  }));
  t.push(check('UEB: Grade 2 saves cells on a signage corpus', () => {
    const r = enc('the people and you will go with us');
    if (r.stats.cellsSaved < 8) throw new Error(`saved only ${r.stats.cellsSaved}`);
    return `saved ${r.stats.cellsSaved} cells (${r.stats.savingPct}%)`;
  }));

  t.push(check('ADA: intra-cell pitch inside 2.3-2.54 mm band', () => {
    if (ADA.intraCellPitchMm < 2.3 || ADA.intraCellPitchMm > 2.54) throw new Error(String(ADA.intraCellPitchMm));
    return `${ADA.intraCellPitchMm} mm`;
  }));
  t.push(check('ADA: inter-cell pitch inside 6.1-7.6 mm band', () => {
    if (ADA.interCellPitchMm < 6.1 || ADA.interCellPitchMm > 7.6) throw new Error(String(ADA.interCellPitchMm));
    return `${ADA.interCellPitchMm} mm`;
  }));
  t.push(check('ADA: dot height inside 0.6-0.9 mm band', () => {
    if (ADA.dotHeightMm < 0.6 || ADA.dotHeightMm > 0.9) throw new Error(String(ADA.dotHeightMm));
    return `${ADA.dotHeightMm} mm`;
  }));
  t.push(check('ADA: dot base inside 1.5-1.6 mm band', () => {
    if (ADA.dotBaseMm < 1.5 || ADA.dotBaseMm > 1.6) throw new Error(String(ADA.dotBaseMm));
    return `${ADA.dotBaseMm} mm`;
  }));
  t.push(check('ADA: line pitch inside 10-10.7 mm band', () => {
    if (ADA.linePitchMm < 10 || ADA.linePitchMm > 10.7) throw new Error(String(ADA.linePitchMm));
    return `${ADA.linePitchMm} mm`;
  }));

  const lay = layoutPlaque(enc('EXIT 3', { grade: 1 }).tokens, { maxCols: 16 });
  const mesh = buildMesh(lay);
  t.push(check('STL: mesh is watertight (every edge shared by 2 triangles)', () => {
    const v = verifyWatertight(mesh);
    if (!v.watertight) throw new Error(`${v.violations} open edges`);
    return `${v.edgeCount} edges closed`;
  }));
  t.push(check('STL: signed mesh volume is positive', () => {
    const v = meshVolume(mesh);
    if (!(v > 0)) throw new Error(String(v));
    return `${v.toFixed(1)} mm3`;
  }));
  t.push(check('STL: bounding box matches plate plus dot height', () => {
    const b = mesh.bounds;
    if (Math.abs(b.max[2] - (ADA.plateThicknessMm + ADA.dotHeightMm)) > 1e-6) {
      throw new Error(`zmax ${b.max[2]}`);
    }
    return `${b.max[0].toFixed(1)} x ${b.max[1].toFixed(1)} x ${b.max[2].toFixed(1)} mm`;
  }));
  t.push(check('STL: binary buffer has exact length and triangle count', () => {
    const stl = toSTL(mesh);
    const dv = new DataView(stl);
    eq(dv.getUint32(80, true), mesh.triangleCount, 'tri count');
    eq(stl.byteLength, 84 + mesh.triangleCount * 50, 'bytes');
    return `${mesh.triangleCount} triangles`;
  }));
  t.push(check('STL: every face normal is unit length and finite', () => {
    for (let i = 0; i < mesh.triangleCount; i++) {
      const n = triNormal(mesh.positions, mesh.indices, i);
      const len = Math.hypot(...n);
      if (!Number.isFinite(len) || Math.abs(len - 1) > 1e-6) throw new Error(`tri ${i}`);
    }
    return `${mesh.triangleCount}/${mesh.triangleCount}`;
  }));
  t.push(check('SVG: blueprint is mm-true and carries dimension callouts', () => {
    const svg = toSVG(layoutPlaque(enc('EXIT STAIRWELL B', { grade: 1 }).tokens, { maxCols: 8 }), { caption: 'EXIT' });
    for (const tag of ['data-dim="intraCell"', 'data-dim="interCell"', 'data-dim="linePitch"', 'data-dim="plateW"', 'data-dim="plateH"', 'mm"']) {
      if (!svg.includes(tag)) throw new Error(`missing ${tag}`);
    }
    return '5 dimension groups + caption layer';
  }));

  t.push(check('PERKINS: F D S J K L map to dots 1-6', () => {
    eq(KEY_TO_DOT.f, 1); eq(KEY_TO_DOT.d, 2); eq(KEY_TO_DOT.s, 3);
    eq(KEY_TO_DOT.j, 4); eq(KEY_TO_DOT.k, 5); eq(KEY_TO_DOT.l, 6);
  }));
  t.push(check('PERKINS: chord keys round-trip through masks', () => {
    for (let m = 0; m < 64; m++) {
      const keys = maskToChordKeys(m);
      let back = 0;
      for (const k of keys) back |= 1 << (KEY_TO_DOT[k] - 1);
      eq(back, m, `mask ${m}`);
    }
    return '64/64';
  }));
  t.push(check('PERKINS: session grades a chord and tracks accuracy', () => {
    const s = new PerkinsSession('grade2');
    s.press('f'); s.press('d'); s.press('s'); s.press('j'); s.press('l'); // and = 1-2-3-4-6
    const r = s.commit();
    if (!r.ok) throw new Error('and chord rejected');
    eq(s.stats().accuracy, 100);
    return '1/1 correct';
  }));
  t.push(check('PERKINS: all four lessons ship with prompts', () => {
    eq(LESSONS.length, 4);
    for (const l of LESSONS) if (!l.items.length) throw new Error(l.id);
    return `${LESSONS.map(l => l.items.length).join('+')} items`;
  }));

  t.push(check('PRESETS: five community signage templates', () => {
    eq(PRESETS.length, 5);
    return PRESETS.map(p => p.title).join(' | ');
  }));
  t.push(check('STATE: URL hash round trip survives encode/decode', () => {
    const st = { tab: 'studio', grade: 2, text: 'Room 204!', maxCols: 24, theme: 'dark' };
    const back = decodeHash(encodeHash(st));
    eq(back.text, st.text); eq(back.grade, 2); eq(back.maxCols, 24); eq(back.theme, 'dark');
  }));
  t.push(check('STATE: malformed hash decodes to empty, never throws', () => {
    decodeHash('#t=%ZZ%%&g=9&tab=nope');
    decodeHash('%%%%');
    return 'recovered';
  }));

  t.push(check('DOTS: every emitted cell stays inside the 6-dot mask', () => {
    const r = enc('The quick brown fox jumps over 13 lazy dogs! Grade 2 rules.');
    for (const m of r.cells) if (m < 0 || m > 0x3f) throw new Error(`mask ${m}`);
    for (const m of r.cells) for (const d of dotsOf(m)) if (d < 1 || d > 6) throw new Error('dot');
    return `${r.cells.length} cells`;
  }));

  const passed = t.filter(x => x.pass).length;
  return { results: t, passed, total: t.length, allPass: passed === t.length };
}
