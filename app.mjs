// app.mjs: BrailleCraft UI wiring. ES modules only, no dependencies.
import {
  encode, cellsToUnicode, describeCell, maskToUnicode, CAP, NUM, G1
} from './src/ueb.mjs';
import {
  ADA, layoutPlaque, buildMesh, toSTL, toSVG
} from './src/tactile_geometry.mjs';
import {
  LESSONS, PerkinsSession, createClicker, maskToChordKeys, KEY_TO_DOT, DOT_TO_KEY
} from './src/perkins.mjs';
import { PRESETS, presetById, encodeHash, decodeHash } from './src/presets.mjs';
import { runSelfTests } from './src/selftest.mjs';
import {
  KIT_PACKS, kitFromPack, normalizeKit, packKit, buildKit, packBed, batchMesh, kitSheetSVG,
  handoffLines, kitJSON, studyCards, checkAnswer, cleanSignText, cleanRole, clampQty, ROLES,
  MAX_SIGNS, MAX_QTY, BED_MM
} from './src/kit.mjs';

const $ = id => document.getElementById(id);
const state = {
  tab: 'studio', grade: 2, text: 'STEM CLUB ROOM 204', maxCols: 24,
  preset: 'stem-club', lesson: 'home-row', muted: false, theme: null,
  view3d: false, tilt: 28,
  kit: kitFromPack('classroom', 2)
};
let lastResult = null;
let lastLayout = null;
let lastMesh = null;

// ---------------------------------------------------------------------------
// Tabs (ARIA tablist with arrow-key navigation)
// ---------------------------------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(id, focus = false) {
  state.tab = id;
  for (const t of tabs) {
    const on = t.id === `tab-${id}`;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  syncHash();
}
for (const t of tabs) {
  t.addEventListener('click', () => selectTab(t.id.replace('tab-', '')));
  t.addEventListener('keydown', e => {
    const i = tabs.indexOf(t);
    if (e.key === 'ArrowRight') selectTab(tabs[(i + 1) % tabs.length].id.replace('tab-', ''), true);
    if (e.key === 'ArrowLeft') selectTab(tabs[(i + tabs.length - 1) % tabs.length].id.replace('tab-', ''), true);
  });
}

// ---------------------------------------------------------------------------
// Theme + sound
// ---------------------------------------------------------------------------

function applyTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  $('themeToggle').setAttribute('aria-pressed', String(t === 'dark'));
}
$('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  syncHash();
});

let clicker = null;
let audioCtx = null;
function sound() {
  if (!clicker) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    clicker = createClicker(audioCtx);
    clicker.setMuted(state.muted);
  }
  return clicker;
}
$('muteToggle').addEventListener('click', () => {
  state.muted = !state.muted;
  $('muteToggle').setAttribute('aria-pressed', String(state.muted));
  if (clicker) clicker.setMuted(state.muted);
  syncHash();
});

// ---------------------------------------------------------------------------
// Studio: translation -> preview -> exports
// ---------------------------------------------------------------------------

const RULE_LABELS = {
  'alphabetic-wordsign': 'wordsign', 'cap-alphabetic-wordsign': 'wordsign',
  'strong-wordsign': 'strong sign', 'groupsign': 'groupsign',
  'letter': 'letter', 'digit': 'digit', 'numeric-indicator': 'number sign',
  'cap-letter': 'capital', 'caps-word-indicator': 'caps word',
  'grade1-indicator': 'grade 1', 'punct': 'punctuation', 'space': 'space',
  'apostrophe': 'apostrophe', 'decimal': 'decimal', 'numeric-comma': 'comma',
  'open-quote': 'open quote', 'close-quote': 'close quote', 'unsupported': 'blank'
};

function rerun() {
  state.text = $('srcText').value;
  const res = encode(state.text, { grade: state.grade });
  lastResult = res;
  lastLayout = layoutPlaque(res.tokens, { maxCols: state.maxCols });
  lastMesh = buildMesh(lastLayout);
  $('brailleOut').textContent = res.unicode || ' ';
  renderBrailleCells(res.cells);
  $('mCells').textContent = res.cells.length;
  $('mSaved').textContent = `${res.stats.cellsSaved} (${res.stats.savingPct}%)`;
  $('mPlate').textContent = `${lastLayout.plateW.toFixed(0)}×${lastLayout.plateH.toFixed(0)}`;
  $('mDots').textContent = lastLayout.dots.length;
  const seen = new Set(res.tokens.map(t => t.rule));
  $('legend').textContent = [...seen].map(r => RULE_LABELS[r] || r).join(' · ');
  if (state.view3d) drawIso(); else renderBlueprint();
  syncHash();
}

// The output strip draws every cell as six domes (raised dots lit, empty
// positions as rings) so the braille reads clearly at any font support.
function renderBrailleCells(cells) {
  const wrap = $('brailleCells');
  wrap.textContent = '';
  // Cells of one word stay on one line; blank cells become word gaps.
  let word = null;
  for (const m of cells) {
    if (m === 0) { word = null; continue; }
    if (!word) {
      word = document.createElement('span');
      word.className = 'cell-word';
      wrap.appendChild(word);
    }
    word.appendChild(cellDots(m, 'dcell dcell-out'));
  }
}

function renderBlueprint() {
  const svg = toSVG(lastLayout, { caption: currentCaption() });
  $('svgStage').innerHTML = svg;
  for (const g of $('svgStage').querySelectorAll('.cellg')) {
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    const [r, c] = g.dataset.cell.split('.').map(Number);
    const cell = lastLayout.rows[r][c];
    const d = describeCell(cell.mask, cell);
    g.setAttribute('aria-label', `cell row ${r + 1} column ${c + 1}, ${d.letter || RULE_LABELS[cell.rule] || 'cell'}, dots ${d.dots.join(' ') || 'none'}`);
  }
}

function currentCaption() {
  const p = presetById(state.preset);
  return p ? p.caption : state.text.slice(0, 24);
}

// Inspector (works for blueprint cells and 3D hit-tested cells)
function inspect(r, c) {
  const cell = lastLayout.rows[r]?.[c];
  if (!cell) return;
  const d = describeCell(cell.mask, cell);
  const dotEls = [1, 4, 2, 5, 3, 6].map(dn =>
    `<i class="${cell.mask & (1 << (dn - 1)) ? 'on' : ''}"></i>`).join('');
  $('inspector').innerHTML = `
    <div class="insp-grid">
      <span class="insp-cell-face">${maskToUnicode(cell.mask)}</span>
      <div class="insp-rows">
        <div><span class="insp-rule">${RULE_LABELS[cell.rule] || cell.rule}</span>
          <span class="insp-dots">${dotEls}</span><b>${d.unicode}</b></div>
        <div>source: <b>${cell.src && cell.src !== ' ' ? escapeHtml(cell.src) : '(blank)'}</b>
          · row ${r + 1}, col ${c + 1} · dots ${d.dots.join(', ') || 'none'}</div>
        <div>origin <b>${cell.x0.toFixed(2)}, ${cell.y0.toFixed(2)} mm</b> · cell ${cell.col + 1} of ${lastLayout.cols}</div>
      </div>
    </div>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
$('svgStage').addEventListener('pointerover', e => {
  const g = e.target.closest?.('[data-cell]');
  if (g) { const [r, c] = g.dataset.cell.split('.').map(Number); inspect(r, c); }
});
$('svgStage').addEventListener('focusin', e => {
  const g = e.target.closest?.('[data-cell]');
  if (g) { const [r, c] = g.dataset.cell.split('.').map(Number); inspect(r, c); }
});

// 2D / 3D view toggle
function setView(v3d) {
  state.view3d = v3d;
  $('view2d').setAttribute('aria-pressed', String(!v3d));
  $('view3d').setAttribute('aria-pressed', String(v3d));
  $('svgStage').hidden = v3d;
  $('isoCanvas').hidden = !v3d;
  $('tiltRow').hidden = !v3d;
  if (v3d) drawIso(); else renderBlueprint();
}
$('view2d').addEventListener('click', () => setView(false));
$('view3d').addEventListener('click', () => setView(true));
$('tilt').addEventListener('input', () => {
  state.tilt = Number($('tilt').value);
  $('tiltOut').textContent = `${state.tilt}°`;
  drawIso();
});

// ------------------------- isometric relief preview -------------------------

const isoCanvas = $('isoCanvas');
let isoHits = []; // {sx, sy, r, c} screen-space hit targets

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawIso() {
  const ctx = isoCanvas.getContext('2d');
  const w = isoCanvas.clientWidth, h = isoCanvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  isoCanvas.width = w * dpr; isoCanvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!lastLayout) return;

  const spec = ADA;
  const t = spec.plateThicknessMm, dh = spec.dotHeightMm, r = spec.dotBaseMm / 2;
  const cx = lastLayout.plateW / 2, cy = lastLayout.plateH / 2;
  const th = (state.tilt * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const ISOX = Math.cos(Math.PI / 6), ISOY = 0.5;

  const proj = (x, y, z) => {
    const dx = x - cx, dy = y - cy;
    const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
    return [(rx - ry) * ISOX, (rx + ry) * ISOY - z * 0.92];
  };

  // fit projected bounds
  const corners = [
    proj(0, 0, 0), proj(lastLayout.plateW, 0, 0), proj(lastLayout.plateW, lastLayout.plateH, 0),
    proj(0, lastLayout.plateH, 0), proj(cx, cy, t + dh)
  ];
  const bx = [Math.min(...corners.map(p => p[0])), Math.max(...corners.map(p => p[0]))];
  const by = [Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[1]))];
  const scale = Math.min((w - 60) / (bx[1] - bx[0] || 1), (h - 60) / (by[1] - by[0] || 1));
  const ox = w / 2 - (bx[0] + bx[1]) / 2 * scale, oy = h / 2 - (by[0] + by[1]) / 2 * scale;
  const P = (x, y, z) => { const p = proj(x, y, z); return [ox + p[0] * scale, oy + p[1] * scale]; };

  const paper = cssVar('--paper') || '#f4f1ea';
  const ink = cssVar('--ink') || '#1b2430';
  const line = cssVar('--line') || '#d8d2c4';
  const accent = cssVar('--accent') || '#b4651f';
  const accentInk = cssVar('--accent-ink') || '#8f4f14';

  // plate walls then top (painter order: far edges first is fine for a slab)
  const c = [[0, 0], [lastLayout.plateW, 0], [lastLayout.plateW, lastLayout.plateH], [0, lastLayout.plateH]];
  const top = c.map(([x, y]) => P(x, y, t));
  const base = c.map(([x, y]) => P(x, y, 0));
  ctx.fillStyle = shade(paper, -28);
  ctx.beginPath();
  for (const [a, b] of [[1, 2], [2, 3]]) { // right and near walls
    ctx.moveTo(...top[a]); ctx.lineTo(...top[b]); ctx.lineTo(...base[b]); ctx.lineTo(...base[a]);
  }
  ctx.fill();
  ctx.fillStyle = shade(paper, -14);
  ctx.beginPath();
  ctx.moveTo(...top[0]); ctx.lineTo(...top[1]); ctx.lineTo(...base[1]); ctx.lineTo(...base[0]);
  ctx.fill();

  // top face
  ctx.beginPath();
  ctx.moveTo(...top[0]); for (let i = 1; i < 4; i++) ctx.lineTo(...top[i]);
  ctx.closePath();
  ctx.fillStyle = shade(paper, 4); ctx.fill();
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();

  // faint row/column guides on the plate face
  ctx.strokeStyle = line; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6;
  for (let i = 1; i < lastLayout.cols; i++) {
    const x = spec.marginMm + i * spec.interCellPitchMm - spec.interCellPitchMm / 2;
    ctx.beginPath(); ctx.moveTo(...P(x, spec.marginMm * 0.55, t)); ctx.lineTo(...P(x, lastLayout.plateH - spec.marginMm * 0.55, t)); ctx.stroke();
  }
  for (let i = 1; i < lastLayout.nRows; i++) {
    const y = spec.marginMm + i * spec.linePitchMm - spec.linePitchMm / 2;
    ctx.beginPath(); ctx.moveTo(...P(spec.marginMm * 0.55, y, t)); ctx.lineTo(...P(lastLayout.plateW - spec.marginMm * 0.55, y, t)); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // mounting holes as dark inset rings
  for (const hole of lastLayout.holes) {
    const [hx, hy] = P(hole.x, hole.y, t);
    const hr = (spec.mountHoleDiameterMm / 2) * scale * 0.86;
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * ISOY, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(ink, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx, hy, hr * 0.55, hr * 0.55 * ISOY, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill();
  }

  // relief dots, far to near, as shaded dome caps
  const sorted = [...lastLayout.dots].sort((a, b) => {
    const da = (a.x - cx) * cos - (a.y - cy) * sin + ((a.x - cx) * sin + (a.y - cy) * cos);
    const db = (b.x - cx) * cos - (b.y - cy) * sin + ((b.x - cx) * sin + (b.y - cy) * cos);
    return da - db;
  });
  isoHits = [];
  for (const d of sorted) {
    const [px, py] = P(d.x, d.y, t + dh);
    const rr = r * scale;
    // cast shadow on plate
    const [sx, sy] = P(d.x + 0.35, d.y + 0.35, t);
    ctx.beginPath(); ctx.ellipse(sx, sy, rr * 1.05, rr * ISOY, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fill();
    // dome: radial gradient offset toward the light (upper-left)
    const g = ctx.createRadialGradient(px - rr * 0.4, py - rr * 0.5, rr * 0.15, px, py, rr * 1.25);
    g.addColorStop(0, '#fff2df');
    g.addColorStop(0.45, accent);
    g.addColorStop(1, accentInk);
    ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.7; ctx.stroke();
    // specular fleck
    ctx.beginPath(); ctx.ellipse(px - rr * 0.38, py - rr * 0.5, rr * 0.2, rr * 0.13, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
    isoHits.push({ sx: px, sy: py, rr: Math.max(rr, 6), r: d.cell.row, c: d.cell.col });
  }
  ctx.fillStyle = cssVar('--ink-2');
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${lastLayout.plateW.toFixed(0)} × ${lastLayout.plateH.toFixed(0)} mm · ${lastLayout.dots.length} raised dots · ${meshTris()} triangles`, w / 2, h - 14);
}

function meshTris() { return lastMesh ? lastMesh.triangleCount : 0; }

function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = v => Math.max(0, Math.min(255, v + amt));
  const r = f(n >> 16), g = f((n >> 8) & 0xff), b = f(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// 3D interaction: drag to tilt + hover to inspect nearest dome
let dragging = false, dragX = 0;
isoCanvas.addEventListener('pointerdown', e => { dragging = true; dragX = e.clientX; isoCanvas.setPointerCapture(e.pointerId); });
isoCanvas.addEventListener('pointerup', () => { dragging = false; });
isoCanvas.addEventListener('pointermove', e => {
  if (dragging) {
    state.tilt = Math.max(-60, Math.min(60, state.tilt + (e.clientX - dragX) * 0.4));
    dragX = e.clientX;
    $('tilt').value = String(Math.round(state.tilt));
    $('tiltOut').textContent = `${Math.round(state.tilt)}°`;
    drawIso();
    return;
  }
  const rect = isoCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best = null, bd = 1e9;
  for (const h of isoHits) {
    const dd = (h.sx - mx) ** 2 + (h.sy - my) ** 2;
    if (dd < bd && dd < (h.rr * 2.2) ** 2) { bd = dd; best = h; }
  }
  if (best) inspect(best.r, best.c);
});
window.addEventListener('resize', () => { if (state.view3d) drawIso(); });

// ------------------------------- exports -----------------------------------

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  flash(`saved ${name}`);
}

$('dlStl').addEventListener('click', () => {
  const stl = toSTL(lastMesh, 'braillecraft-plaque');
  download('braillecraft-plaque.stl', new Blob([stl], { type: 'model/stl' }));
});
$('dlSvg').addEventListener('click', () => {
  download('braillecraft-blueprint.svg', new Blob([toSVG(lastLayout, { caption: currentCaption() })], { type: 'image/svg+xml' }));
});
$('copyBraille').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastResult.unicode);
    flash('braille copied to clipboard');
  } catch {
    flash('copy blocked by the browser');
  }
});
$('shareLink').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + encodeHash({ ...state, kit: packKit(state.kit) });
  try {
    await navigator.clipboard.writeText(url);
    flash('share link copied');
  } catch {
    location.hash = encodeHash({ ...state, kit: packKit(state.kit) });
    flash('hash updated, copy the address bar');
  }
});
function flash(msg) { $('copied').textContent = msg; setTimeout(() => { if ($('copied').textContent === msg) $('copied').textContent = ''; }, 2600); }

// ------------------------------- inputs ------------------------------------

$('srcText').addEventListener('input', rerun);
$('grade1').addEventListener('click', () => { state.grade = 1; state.preset = null; markGrade(); rerun(); });
$('grade2').addEventListener('click', () => { state.grade = 2; state.preset = null; markGrade(); rerun(); });
function markGrade() {
  $('grade1').setAttribute('aria-pressed', String(state.grade === 1));
  $('grade2').setAttribute('aria-pressed', String(state.grade === 2));
}
$('maxCols').addEventListener('change', () => {
  const v = Math.max(4, Math.min(40, Math.round(Number($('maxCols').value) || 24)));
  $('maxCols').value = String(v);
  state.maxCols = v; rerun(); renderKitOutputs();
});

// preset chips
const chipEls = new Map();
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = p.title; b.title = p.note; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    state.preset = p.id; state.text = p.text; state.grade = p.grade;
    $('srcText').value = p.text; markGrade(); markPresets();
    $('presetNote').textContent = p.note;
    rerun();
  });
  chipEls.set(p.id, b);
  $('presetChips').appendChild(b);
}
function markPresets() {
  for (const [id, b] of chipEls) b.setAttribute('aria-pressed', String(id === state.preset));
  const p = presetById(state.preset);
  $('presetNote').textContent = p ? p.note : '';
}
$('srcText').addEventListener('input', () => { state.preset = null; markPresets(); });

// ------------------------------- trainer ------------------------------------

let session = new PerkinsSession(state.lesson);
const pressedKeys = new Set();

function renderLessonList() {
  $('lessonList').textContent = '';
  for (const l of LESSONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = l.title.replace(/^Lesson \d+: /, '');
    b.setAttribute('aria-pressed', String(l.id === state.lesson));
    b.addEventListener('click', () => { state.lesson = l.id; startLesson(); syncHash(); });
    $('lessonList').appendChild(b);
  }
}

function startLesson() {
  session = new PerkinsSession(state.lesson);
  pressedKeys.clear();
  renderLessonList();
  $('lessonBlurb').textContent = session.lesson.blurb;
  $('trainerLog').textContent = '';
  showPrompt();
}

function showPrompt() {
  if (session.done) {
    const s = session.stats();
    $('promptText').textContent = 'Done';
    $('promptLabel').textContent = 'Lesson complete';
    $('promptBraille').textContent = '';
    $('promptHint').textContent = `${s.accuracy}% accuracy · ${s.cpm} cells/min · best streak ${s.bestStreak}`;
    $('lessonProgress').style.width = '100%';
    return;
  }
  const item = session.item;
  $('promptLabel').textContent = `Item ${session.itemIndex + 1} of ${session.lesson.items.length} · cell ${session.cellIndex + 1} of ${item.cells.length}`;
  $('promptText').textContent = item.prompt;
  $('promptBraille').textContent = item.cells.map(maskToUnicode).join('');
  $('promptHint').textContent = item.hint;
  const p = session.progress();
  $('lessonProgress').style.width = `${(p.doneCells / p.totalCells) * 100}%`;
  renderTrainerStats();
}

function renderTrainerStats() {
  const s = session.stats();
  $('tAcc').textContent = `${s.accuracy}%`;
  $('tCpm').textContent = s.cpm;
  $('tWpm').textContent = s.wpm;
  $('tStreak').textContent = s.streak;
}

function drawPad() {
  for (const el of $('cellgrid').querySelectorAll('.cg')) {
    el.classList.toggle('on', pressedKeys.has(Number(el.dataset.g)));
  }
}

function commitChord(space = false) {
  if (session.done) return;
  const r = session.commit({ space });
  if (!r) return;
  const li = document.createElement('li');
  li.textContent = maskToUnicode(r.mask);
  li.className = r.ok ? 'ok' : 'miss';
  li.title = r.ok ? 'correct' : `expected ${maskToUnicode(r.expected)}`;
  $('trainerLog').prepend(li);
  while ($('trainerLog').children.length > 24) $('trainerLog').lastChild.remove();
  const st = $('cellstate');
  if (r.ok) {
    st.textContent = session.done ? 'lesson complete' : 'embossed · correct';
    st.className = 'cellstate good';
    sound()?.good();
    if (session.done) sound()?.finish();
  } else {
    const keys = maskToChordKeys(r.expected).map(k => k.toUpperCase()).join(' + ') || 'Space';
    st.textContent = `miss · expected ${keys}`;
    st.className = 'cellstate bad';
    sound()?.bad();
  }
  $('cellchar').textContent = maskToUnicode(r.mask);
  drawPad();
  showPrompt();
  renderTrainerStats();
}

function pressDot(dot) {
  pressedKeys.add(dot);
  session.press(DOT_TO_KEY[dot]);
  drawPad();
  sound()?.click();
}
function releaseDot(dot) {
  pressedKeys.delete(dot);
  session.release(DOT_TO_KEY[dot]);
  drawPad();
  if (pressedKeys.size === 0) commitChord();
}

document.addEventListener('keydown', e => {
  if ($('panel-trainer').hidden) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') return;
  if (e.repeat) return;
  const dot = KEY_TO_DOT[e.key.toLowerCase()];
  if (dot) { e.preventDefault(); pressDot(dot); }
  else if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); commitChord(true); }
});
document.addEventListener('keyup', e => {
  if ($('panel-trainer').hidden) return;
  const dot = KEY_TO_DOT[e.key.toLowerCase()];
  if (dot) releaseDot(dot);
});

for (const b of document.querySelectorAll('.keycap[data-key]')) {
  const key = b.dataset.key;
  const dot = KEY_TO_DOT[key];
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ } b.classList.add('held'); pressDot(dot); });
  // keyboard activation (Enter/Space on a focused keycap) fires click with
  // detail 0; pointer clicks report detail >= 1 and already ran press/release
  b.addEventListener('click', e => { if (e.detail === 0) { pressDot(dot); releaseDot(dot); } });
  const up = e => { if (b.classList.contains('held')) { b.classList.remove('held'); releaseDot(dot); } };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
$('spaceBtn').addEventListener('click', () => commitChord(true));
$('restartLesson').addEventListener('click', startLesson);
$('skipItem').addEventListener('click', () => {
  if (session.done) return;
  session.itemIndex++; session.cellIndex = 0;
  showPrompt(); renderTrainerStats();
});


// ------------------------------ community kit -------------------------------

let kitBuilt = null;
let kitBed = null;

function kitFlash(msg) {
  const el = $('kitStatus');
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2600);
}

function rebuildKit() {
  kitBuilt = buildKit(state.kit, { maxCols: state.maxCols });
  kitBed = packBed(kitBuilt.signs);
}

function renderKitPacks() {
  $('kitPacks').textContent = '';
  for (const pk of KIT_PACKS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = pk.title;
    b.setAttribute('aria-pressed', String(state.kit.pack === pk.id));
    b.addEventListener('click', () => {
      const roles = state.kit.roles;
      state.kit = kitFromPack(pk.id, state.kit.grade);
      state.kit.roles = roles;
      renderKitAll();
      syncHash();
    });
    $('kitPacks').appendChild(b);
  }
  $('kitG1').setAttribute('aria-pressed', String(state.kit.grade === 1));
  $('kitG2').setAttribute('aria-pressed', String(state.kit.grade === 2));
}

// The sign list holds live inputs, so it is rebuilt only when signs are
// added, removed or replaced; typing updates outputs in place.
function renderKitList() {
  const ol = $('kitSigns');
  ol.textContent = '';
  state.kit.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'kit-sign';
    const br = document.createElement('span');
    br.className = 'kit-braille';
    br.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.maxLength = 48;
    txt.value = item.text;
    txt.setAttribute('aria-label', `Sign ${i + 1} text`);
    txt.addEventListener('input', () => {
      const v = cleanSignText(txt.value);
      if (!v) return;
      item.text = v;
      state.kit.pack = null;
      renderKitOutputs();
      syncHash();
    });
    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = String(MAX_QTY);
    qty.value = String(item.qty);
    qty.className = 'kit-qty';
    qty.setAttribute('aria-label', `Sign ${i + 1} copies`);
    qty.addEventListener('change', () => {
      item.qty = clampQty(qty.value);
      qty.value = String(item.qty);
      renderKitOutputs();
      syncHash();
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn kit-rm';
    rm.setAttribute('aria-label', `Remove ${item.text}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    rm.addEventListener('click', () => {
      state.kit.items.splice(i, 1);
      state.kit.pack = null;
      renderKitAll();
      syncHash();
      ($('kitSigns').querySelectorAll('input[type="text"]')[Math.min(i, state.kit.items.length - 1)] || $('kitNew')).focus();
    });
    li.append(txt, qty, rm, br);
    ol.appendChild(li);
  });
  $('kitNew').disabled = state.kit.items.length >= MAX_SIGNS;
}

function renderKitOutputs() {
  rebuildKit();
  const t = kitBuilt.totals;
  $('kPlates').textContent = t.plates;
  $('kDots').textContent = t.dots;
  $('kGrams').textContent = `${t.grams} g`;
  $('kBed').textContent = kitBed.placements.length ? `${Math.round(kitBed.width)}×${Math.round(kitBed.depth)}` : '0';
  $('kBed').classList.toggle('warn', !kitBed.fitsBed);
  const brs = $('kitSigns').querySelectorAll('.kit-braille');
  kitBuilt.signs.forEach((sg, i) => { if (brs[i]) brs[i].textContent = sg.unicode; });
  $('handoffPre').textContent = handoffLines(state.kit, kitBuilt, kitBed).join('\n');
  for (const r of ROLES) {
    const el = $(`role-${r}`);
    if (document.activeElement !== el) el.value = state.kit.roles[r] || '';
  }
  for (const b of $('kitPacks').querySelectorAll('.chip')) {
    b.setAttribute('aria-pressed', String(KIT_PACKS.find(p => p.title === b.textContent)?.id === state.kit.pack));
  }
  const empty = kitBuilt.signs.length === 0;
  for (const id of ['kitStl', 'kitSvg', 'kitJson', 'kitCopy', 'kitPrint']) $(id).disabled = empty;
  renderStudyCards();
}

function renderKitAll() {
  renderKitPacks();
  renderKitList();
  renderKitOutputs();
}

function cellDots(mask, cls = 'dcell') {
  const c = document.createElement('span');
  c.className = cls;
  for (const dn of [1, 4, 2, 5, 3, 6]) {
    const i = document.createElement('i');
    if (mask & (1 << (dn - 1))) i.className = 'on';
    c.appendChild(i);
  }
  return c;
}

function renderStudyCards() {
  const grid = $('studyGrid');
  grid.textContent = '';
  const cards = studyCards(state.kit);
  if (!cards.length) {
    const p = document.createElement('p');
    p.className = 'insp-idle';
    p.textContent = 'Add a sign with a word of two or more letters to get study cards.';
    grid.appendChild(p);
    return;
  }
  cards.forEach((card, idx) => {
    const art = document.createElement('article');
    art.className = 'study-card';
    const cells = document.createElement('div');
    cells.className = 'study-cells';
    cells.setAttribute('role', 'img');
    cells.setAttribute('aria-label', `Braille card ${idx + 1}: ${card.cells.map(c => `dots ${c.dots.join(' ')}`).join(', ')}`);
    for (const c of card.cells) cells.appendChild(cellDots(c.mask));
    const form = document.createElement('form');
    form.className = 'study-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'What does it say?';
    input.setAttribute('aria-label', `Answer for card ${idx + 1}`);
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'submit';
    btn.textContent = 'Check';
    const show = document.createElement('button');
    show.className = 'btn ghost-btn';
    show.type = 'button';
    show.textContent = 'Show';
    const res = document.createElement('p');
    res.className = 'study-res';
    res.setAttribute('role', 'status');
    const reveal = (ok) => {
      res.className = `study-res ${ok ? 'good' : 'shown'}`;
      res.textContent = `${ok ? 'Correct. ' : ''}${card.word} · ${card.rules.join(', ')}${card.saved ? ` · saves ${card.saved} cell${card.saved > 1 ? 's' : ''}` : ''}`;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (checkAnswer(card, input.value)) reveal(true);
      else { res.className = 'study-res bad'; res.textContent = input.value.trim() ? 'Not yet. Count the dots in each cell again.' : 'Type the word first.'; }
    });
    show.addEventListener('click', () => reveal(false));
    form.append(input, btn, show);
    const ans = document.createElement('p');
    ans.className = 'study-print-answer';
    ans.textContent = card.word;
    art.append(cells, form, res, ans);
    grid.appendChild(art);
  });
}

$('kitG1').addEventListener('click', () => { state.kit.grade = 1; renderKitPacks(); renderKitOutputs(); syncHash(); });
$('kitG2').addEventListener('click', () => { state.kit.grade = 2; renderKitPacks(); renderKitOutputs(); syncHash(); });
$('kitAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = cleanSignText($('kitNew').value);
  if (!v) { kitFlash('type the sign text first'); $('kitNew').focus(); return; }
  if (state.kit.items.length >= MAX_SIGNS) { kitFlash(`a kit holds up to ${MAX_SIGNS} signs`); return; }
  state.kit.items.push({ text: v, qty: 1 });
  state.kit.pack = null;
  $('kitNew').value = '';
  renderKitAll();
  syncHash();
  $('kitNew').focus();
});
for (const r of ROLES) {
  $(`role-${r}`).addEventListener('input', (e) => {
    const v = cleanRole(e.target.value);
    if (v) state.kit.roles[r] = v; else delete state.kit.roles[r];
    $('handoffPre').textContent = handoffLines(state.kit, kitBuilt, kitBed).join('\n');
    syncHash();
  });
}
$('kitStl').addEventListener('click', () => {
  const m = batchMesh(kitBuilt.signs, kitBed);
  download('braillecraft-kit-batch.stl', new Blob([toSTL(m, 'braillecraft-kit')], { type: 'model/stl' }));
  kitFlash(`saved ${kitBed.placements.length} plates in one STL`);
});
$('kitSvg').addEventListener('click', () => {
  download('braillecraft-kit-sheet.svg', new Blob([kitSheetSVG(kitBuilt.signs)], { type: 'image/svg+xml' }));
  kitFlash('saved the kit sheet');
});
$('kitJson').addEventListener('click', () => {
  download('braillecraft-kit.json', new Blob([JSON.stringify(kitJSON(state.kit, kitBuilt, kitBed), null, 2)], { type: 'application/json' }));
  kitFlash('saved the kit as JSON');
});
$('kitCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('handoffPre').textContent);
    kitFlash('handoff sheet copied');
  } catch {
    kitFlash('copy blocked by the browser');
  }
});
function printMode(cls) {
  document.body.classList.add(cls);
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('print-handoff', 'print-cards'));
$('kitPrint').addEventListener('click', () => printMode('print-handoff'));
$('printCards').addEventListener('click', () => printMode('print-cards'));
$('kitShare').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + encodeHash({ ...state, tab: 'kit', kit: packKit(state.kit) });
  try {
    await navigator.clipboard.writeText(url);
    kitFlash('kit link copied');
  } catch {
    history.replaceState(null, '', url);
    kitFlash('link updated, copy the address bar');
  }
});

// -------------------------------- how it works -------------------------------

function renderHow() {
  const cells = $('howCells');
  cells.textContent = '';
  const numbered = document.createElement('figure');
  numbered.className = 'how-cell';
  const big = cellDots(0x3f, 'dcell dcell-lg numbered');
  big.querySelectorAll('i').forEach((i, k) => { i.textContent = String([1, 4, 2, 5, 3, 6][k]); });
  const cap0 = document.createElement('figcaption');
  cap0.textContent = 'Dot numbers';
  numbered.append(big, cap0);
  cells.appendChild(numbered);
  for (const ch of ['a', 'b', 'c', 'l']) {
    const fig = document.createElement('figure');
    fig.className = 'how-cell';
    fig.append(cellDots(encode(ch, { grade: 1 }).cells[0], 'dcell dcell-lg'));
    const cap = document.createElement('figcaption');
    cap.textContent = ch;
    fig.appendChild(cap);
    cells.appendChild(fig);
  }

  const tb = $('howContractions').querySelector('tbody');
  tb.textContent = '';
  for (const w of ['and', 'the', 'for', 'with', 'library', 'restroom', 'station']) {
    const g1 = encode(w, { grade: 1 });
    const g2 = encode(w, { grade: 2 });
    const rules = [...new Set(g2.tokens.map(t => RULE_LABELS[t.rule] || t.rule))].join(', ');
    const tr = document.createElement('tr');
    for (const v of [w, `${g1.unicode} (${g1.cells.length})`, `${g2.unicode} (${g2.cells.length})`, rules]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }

  const ind = $('howIndicators');
  ind.textContent = '';
  for (const [mask, name, what] of [
    [CAP, 'Capital, dot 6', 'the next letter is uppercase; two in a row capitalize the whole word'],
    [NUM, 'Numeric, dots 3 4 5 6', 'the letters a to j that follow read as the digits 1 to 0'],
    [G1, 'Grade 1, dots 5 6', 'the next cell is a plain letter, not a contraction']
  ]) {
    const dt = document.createElement('dt');
    dt.append(cellDots(mask), document.createTextNode(name));
    const dd = document.createElement('dd');
    dd.textContent = what;
    ind.append(dt, dd);
  }

  const sp = $('howSpecs');
  sp.textContent = '';
  for (const [k, v] of [
    ['Dot base diameter', `${ADA.dotBaseMm} mm`], ['Dot height', `${ADA.dotHeightMm} mm`],
    ['Dot to dot in a cell', `${ADA.intraCellPitchMm} mm`], ['Cell to cell', `${ADA.interCellPitchMm} mm`],
    ['Line to line', `${ADA.linePitchMm} mm`], ['Plate thickness', `${ADA.plateThicknessMm} mm`],
    ['Mounting holes', `${ADA.mountHoleDiameterMm} mm, ${ADA.mountHoleInsetMm} mm in from each edge`],
    ['Standard', ADA.specName.replace(/ s(\d)/, ' §$1')]
  ]) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    sp.append(dt, dd);
  }
}

const howDialog = $('howDialog');
$('howOpen').addEventListener('click', () => {
  if (typeof howDialog.showModal === 'function') howDialog.showModal();
  else howDialog.setAttribute('open', '');
});
$('howClose').addEventListener('click', () => howDialog.close());
howDialog.addEventListener('click', (e) => { if (e.target === howDialog) howDialog.close(); });

// --------------------------------- tests ------------------------------------

$('runTests').addEventListener('click', () => {
  const { results, passed, total, allPass } = runSelfTests();
  const sum = $('testSummary');
  sum.textContent = `${passed} of ${total} checks passed${allPass ? ', all invariants hold' : ''}`;
  sum.className = `test-summary ${allPass ? 'good' : 'bad'}`;
  const list = $('testResults');
  list.textContent = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.pass ? 'pass' : 'fail';
    const badge = document.createElement('span');
    badge.className = 'tt-badge'; badge.textContent = r.pass ? 'PASS' : 'FAIL';
    const name = document.createElement('span'); name.textContent = r.name;
    const det = document.createElement('span'); det.className = 'tt-detail'; det.textContent = r.detail || '';
    li.append(badge, name, det);
    list.appendChild(li);
  }
});

// --------------------------- state & bootstrap ------------------------------

let hashTimer = null;
function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    history.replaceState(null, '', encodeHash({ ...state, kit: packKit(state.kit) }));
  }, 180);
}

function bootstrap() {
  const h = decodeHash(location.hash);
  if (h.text !== undefined) {
    state.text = h.text;
    state.preset = null; // a linked text only keeps a preset the link names
  }
  if (h.grade) state.grade = h.grade;
  if (h.maxCols) state.maxCols = h.maxCols;
  if (h.preset) state.preset = h.preset;
  if (h.lesson) state.lesson = h.lesson;
  if (h.muted) state.muted = h.muted;
  if (h.theme) state.theme = h.theme;
  if (h.kit) {
    const k = normalizeKit(h.kit);
    if (k.items.length) state.kit = k;
  }

  if (!state.theme) {
    state.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(state.theme);
  $('muteToggle').setAttribute('aria-pressed', String(state.muted));
  $('srcText').value = state.text;
  $('maxCols').value = String(state.maxCols);
  markGrade(); markPresets();
  startLesson();
  rerun();
  renderKitAll();
  renderHow();
  selectTab(h.tab || 'studio');
}
bootstrap();
