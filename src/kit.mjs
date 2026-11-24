// kit.mjs: the Community Tactile Kit. Batches several signs into one print
// job a volunteer maker can run, a handoff sheet that names who designs,
// prints, checks and mounts, and study cards that let sighted peers learn
// the braille on the signs they made. Browser and Node safe, no dependencies.

import { encode, maskToUnicode, dotsOf } from './ueb.mjs';
import { ADA, layoutPlaque, buildMesh, meshVolume, toSVG } from './tactile_geometry.mjs';

export const PLA_DENSITY_G_CM3 = 1.24; // typical PLA filament density
export const MAX_SIGNS = 16;
export const MAX_QTY = 20;
export const MAX_SIGN_LEN = 48;
export const MAX_ROLE_LEN = 32;
export const ROLES = Object.freeze(['design', 'print', 'check', 'mount']);
export const BED_MM = 220; // a common 220 x 220 mm printer bed
export const BED_GAP_MM = 6;

export const KIT_PACKS = Object.freeze([
  {
    id: 'classroom',
    title: 'Classroom hallway',
    items: [['Room 101', 1], ['Room 102', 1], ['Library', 1], ['Nurse', 1], ['Main office', 1], ['Restroom', 2]]
  },
  {
    id: 'science',
    title: 'Science wing',
    items: [['Lab 2', 1], ['Eyewash station', 2], ['First aid', 1], ['Exit', 2]]
  },
  {
    id: 'center',
    title: 'Community center',
    items: [['Food pantry', 1], ['Elevator', 2], ['Stairs', 2], ['Meeting room', 1]]
  }
]);

export function packById(id) {
  return KIT_PACKS.find(p => p.id === id) || null;
}

export function kitFromPack(id, grade = 2) {
  const p = packById(id);
  if (!p) return null;
  return { pack: p.id, grade, items: p.items.map(([text, qty]) => ({ text, qty })), roles: {} };
}

// ------------------------------- sanitizing --------------------------------

function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}

export const cleanSignText = raw => cleanText(raw, MAX_SIGN_LEN);
export const cleanRole = raw => cleanText(raw, MAX_ROLE_LEN);

export function clampQty(q) {
  const n = Math.round(Number(q));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_QTY, n));
}

// Strict decoder for a kit that arrives in a share link. Bad fields are
// dropped or clamped, never thrown on.
export function normalizeKit(raw) {
  const kit = { pack: null, grade: 2, items: [], roles: {} };
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return kit;
  if (typeof raw.pack === 'string' && packById(raw.pack)) kit.pack = raw.pack;
  if (raw.grade === 1 || raw.grade === 2) kit.grade = raw.grade;
  if (Array.isArray(raw.items)) {
    for (const it of raw.items) {
      if (kit.items.length >= MAX_SIGNS) break;
      const text = cleanSignText(Array.isArray(it) ? it[0] : it?.text);
      if (!text) continue;
      kit.items.push({ text, qty: clampQty(Array.isArray(it) ? it[1] : it?.qty) });
    }
  }
  if (raw.roles && typeof raw.roles === 'object' && !Array.isArray(raw.roles)) {
    for (const r of ROLES) {
      const v = cleanRole(raw.roles[r]);
      if (v) kit.roles[r] = v;
    }
  }
  return kit;
}

// Compact form for the URL hash: items as [text, qty] pairs.
export function packKit(kit) {
  const out = { grade: kit.grade, items: kit.items.map(i => [i.text, i.qty]) };
  if (kit.pack) out.pack = kit.pack;
  const roles = {};
  for (const r of ROLES) if (kit.roles?.[r]) roles[r] = kit.roles[r];
  if (Object.keys(roles).length) out.roles = roles;
  return out;
}

// --------------------------------- build -----------------------------------

const round1 = x => Math.round(x * 10) / 10;

export function buildKit(kit, { maxCols = 24 } = {}) {
  const signs = [];
  for (const [i, item] of (kit?.items || []).entries()) {
    const res = encode(item.text, { grade: kit.grade });
    const layout = layoutPlaque(res.tokens, { maxCols });
    const mesh = buildMesh(layout);
    const volumeMm3 = meshVolume(mesh);
    signs.push({
      n: i + 1,
      text: item.text,
      qty: item.qty,
      grade: kit.grade,
      unicode: res.unicode,
      cells: res.cells.length,
      saved: res.stats.cellsSaved,
      plateW: layout.plateW,
      plateH: layout.plateH,
      dots: layout.dots.length,
      volumeMm3,
      gramsEach: round1((volumeMm3 / 1000) * PLA_DENSITY_G_CM3),
      layout,
      mesh
    });
  }
  const totals = {
    signs: signs.length,
    plates: signs.reduce((n, s) => n + s.qty, 0),
    dots: signs.reduce((n, s) => n + s.dots * s.qty, 0),
    cellsSaved: signs.reduce((n, s) => n + s.saved * s.qty, 0),
    grams: round1(signs.reduce((n, s) => n + s.gramsEach * s.qty, 0))
  };
  return { signs, totals };
}

// Shelf-pack every plate copy onto a printer bed, left to right, front to
// back. Plates wider than the bed still get their own row.
export function packBed(signs, { bedMm = BED_MM, gapMm = BED_GAP_MM } = {}) {
  const placements = [];
  let x = 0, y = 0, rowH = 0, usedW = 0;
  for (const s of signs) {
    for (let k = 0; k < s.qty; k++) {
      if (x > 0 && x + s.plateW > bedMm) { x = 0; y += rowH + gapMm; rowH = 0; }
      placements.push({ n: s.n, copy: k + 1, x, y, w: s.plateW, h: s.plateH });
      x += s.plateW + gapMm;
      rowH = Math.max(rowH, s.plateH);
      usedW = Math.max(usedW, x - gapMm);
    }
  }
  const depth = placements.length ? y + rowH : 0;
  return { placements, width: usedW, depth, fitsBed: usedW <= bedMm && depth <= bedMm };
}

// One mesh holding every plate copy at its bed position. Disjoint closed
// shells, so the merged mesh stays watertight.
export function batchMesh(signs, bed) {
  const bySign = new Map(signs.map(s => [s.n, s]));
  let nPos = 0, nIdx = 0;
  for (const p of bed.placements) {
    const m = bySign.get(p.n).mesh;
    nPos += m.positions.length; nIdx += m.indices.length;
  }
  const positions = new Float64Array(nPos);
  const indices = new Uint32Array(nIdx);
  let po = 0, io = 0;
  for (const p of bed.placements) {
    const m = bySign.get(p.n).mesh;
    const base = po / 3;
    for (let i = 0; i < m.positions.length; i += 3) {
      positions[po++] = m.positions[i] + p.x;
      positions[po++] = m.positions[i + 1] + p.y;
      positions[po++] = m.positions[i + 2];
    }
    for (let i = 0; i < m.indices.length; i++) indices[io++] = m.indices[i] + base;
  }
  return { positions, indices, vertexCount: positions.length / 3, triangleCount: indices.length / 3 };
}

// One SVG sheet with every distinct sign blueprint stacked at 1:1 scale.
// Marker ids are made unique per sign so the combined file stays valid.
export function kitSheetSVG(signs, { gapMm = 8 } = {}) {
  const parts = [];
  let y = 0, w = 0;
  for (const s of signs) {
    const svg = toSVG(s.layout, { caption: s.text })
      .replace(/id="ah"/g, `id="ah${s.n}"`)
      .replace(/url\(#ah\)/g, `url(#ah${s.n})`);
    const mW = /width="([\d.]+)mm"/.exec(svg);
    const mH = /height="([\d.]+)mm"/.exec(svg);
    const sw = mW ? Number(mW[1]) : s.plateW;
    const sh = mH ? Number(mH[1]) : s.plateH;
    parts.push(svg.replace('<svg xmlns="http://www.w3.org/2000/svg" ', `<svg x="0" y="${round1(y)}" `));
    y += sh + gapMm;
    w = Math.max(w, sw);
  }
  const H = Math.max(0, y - gapMm);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round1(w)}mm" height="${round1(H)}mm" viewBox="0 0 ${round1(w)} ${round1(H)}">` +
    `<title>BrailleCraft community kit sheet</title>${parts.join('')}</svg>`;
}

// ------------------------------ handoff sheet -------------------------------

const ROLE_LABEL = { design: 'Designed by', print: 'Printed by', check: 'Checked by a braille reader', mount: 'Mounted by' };

export function handoffLines(kit, built, bed) {
  const L = [];
  const pack = packById(kit.pack);
  L.push('BrailleCraft | Print-shop handoff sheet');
  L.push(`${pack ? pack.title : 'Custom kit'} | ${built.totals.signs} signs, ${built.totals.plates} plates, Grade ${kit.grade} UEB`);
  L.push(`Spec ${ADA.specName} | dot base ${ADA.dotBaseMm} mm | dot height ${ADA.dotHeightMm} mm | dot pitch ${ADA.intraCellPitchMm} mm | cell pitch ${ADA.interCellPitchMm} mm | line pitch ${ADA.linePitchMm} mm | plate ${ADA.plateThicknessMm} mm | holes ${ADA.mountHoleDiameterMm} mm`);
  L.push('');
  for (const s of built.signs) {
    L.push(`${s.n}. ${s.text}  x${s.qty}`);
    L.push(`   ${s.unicode}`);
    L.push(`   ${Math.round(s.plateW)} x ${Math.round(s.plateH)} mm | ${s.cells} cells | ${s.dots} dots | ${s.gramsEach} g PLA each`);
  }
  L.push('');
  L.push(`Totals | ${built.totals.plates} plates | ${built.totals.dots} raised dots | about ${built.totals.grams} g PLA at 100% infill (${PLA_DENSITY_G_CM3} g/cm3)`);
  if (bed) {
    L.push(bed.fitsBed
      ? `Batch STL lays every plate on one ${BED_MM} x ${BED_MM} mm bed (${Math.round(bed.width)} x ${Math.round(bed.depth)} mm used).`
      : `Batch STL needs ${Math.round(bed.width)} x ${Math.round(bed.depth)} mm, more than one ${BED_MM} mm bed. Split the job or print signs one at a time.`);
  }
  L.push('');
  L.push('Before mounting');
  L.push('[ ] Print at 100% scale and check one cell with calipers against the dot pitch above.');
  L.push('[ ] Dots are smooth rounded domes with no strings or sharp tips.');
  L.push('[ ] A braille reader has checked every sign by touch.');
  L.push('[ ] Braille sits below the raised print text (ADA 703.3.2).');
  L.push('[ ] Lowest tactile baseline at least 48 in and highest at most 60 in above the floor (ADA 703.4.1).');
  L.push('');
  for (const r of ROLES) L.push(`${ROLE_LABEL[r]}: ${kit.roles?.[r] || '______________________'}`);
  return L;
}

export function kitJSON(kit, built, bed) {
  return {
    app: 'BrailleCraft',
    kind: 'community-kit',
    version: 1,
    pack: kit.pack,
    grade: kit.grade,
    spec: { ...ADA },
    roles: { ...kit.roles },
    totals: { ...built.totals },
    bed: bed ? { widthMm: round1(bed.width), depthMm: round1(bed.depth), fitsBed: bed.fitsBed, bedMm: BED_MM } : null,
    signs: built.signs.map(s => ({
      n: s.n, text: s.text, qty: s.qty, braille: s.unicode, cells: s.cells, dots: s.dots,
      plateMm: [round1(s.plateW), round1(s.plateH)], gramsEach: s.gramsEach
    }))
  };
}

// ------------------------------- study cards --------------------------------

const RULE_NAME = {
  'alphabetic-wordsign': 'alphabetic wordsign', 'strong-wordsign': 'strong contraction',
  'groupsign': 'groupsign', 'letter': 'letters', 'digit': 'digits',
  'numeric-indicator': 'numeric indicator', 'cap-letter': 'capital indicator',
  'caps-word-indicator': 'capitals word indicator', 'grade1-indicator': 'grade 1 indicator'
};

// One card per distinct word on the kit's signs. Words are lowercased so the
// card practises letters and contractions, not capital indicators.
export function studyCards(kit, { max = 12 } = {}) {
  const seen = new Set();
  const cards = [];
  for (const item of kit?.items || []) {
    for (const w of item.text.split(/\s+/)) {
      const word = w.toLowerCase().replace(/[^a-z0-9']/g, '');
      if (word.length < 2 || seen.has(word)) continue;
      seen.add(word);
      const res = encode(word, { grade: kit.grade });
      const rules = [...new Set(res.tokens.map(t => t.rule).filter(r => r !== 'space'))];
      cards.push({
        word,
        unicode: res.unicode,
        cells: res.cells.map(m => ({ mask: m, dots: dotsOf(m), char: maskToUnicode(m) })),
        rules: rules.map(r => RULE_NAME[r] || r),
        contracted: rules.some(r => /wordsign|groupsign/.test(r)),
        saved: res.stats.cellsSaved
      });
      if (cards.length >= max) return cards;
    }
  }
  return cards;
}

export function checkAnswer(card, answer) {
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9']/g, '');
  return norm(answer).length > 0 && norm(answer) === norm(card.word);
}
