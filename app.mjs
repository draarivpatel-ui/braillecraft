// app.mjs — BrailleCraft UI wiring. ES modules only, no dependencies.
import {
  encode, cellsToUnicode, describeCell, maskToUnicode
} from './src/ueb.mjs';
import {
  ADA, layoutPlaque, buildMesh, toSTL, toSVG
} from './src/tactile_geometry.mjs';
import {
  LESSONS, PerkinsSession, createClicker, maskToChordKeys, KEY_TO_DOT, DOT_TO_KEY
} from './src/perkins.mjs';
import { PRESETS, presetById, encodeHash, decodeHash } from './src/presets.mjs';
import { runSelfTests } from './src/selftest.mjs';

const $ = id => document.getElementById(id);
const state = {
  tab: 'studio', grade: 2, text: 'STEM CLUB ROOM 204', maxCols: 24,
  preset: 'stem-club', lesson: 'home-row', muted: false, theme: null,
  view3d: false, tilt: 28
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
  $('mCells').textContent = res.cells.length;
  $('mSaved').textContent = `${res.stats.cellsSaved} (${res.stats.savingPct}%)`;
  $('mPlate').textContent = `${lastLayout.plateW.toFixed(0)}×${lastLayout.plateH.toFixed(0)} mm`;
  $('mDots').textContent = lastLayout.dots.length;
  const seen = new Set(res.tokens.map(t => t.rule));
  $('legend').textContent = [...seen].map(r => RULE_LABELS[r] || r).join(' · ');
  if (state.view3d) drawIso(); else renderBlueprint();
  syncHash();
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
  const url = location.origin === 'null' ? location.href.split('#')[0] + encodeHash(state) : location.href.split('#')[0] + encodeHash(state);
  try {
    await navigator.clipboard.writeText(url);
    flash('share link copied');
  } catch {
    location.hash = encodeHash(state);
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
  state.maxCols = v; rerun();
});

// preset chips
const chipEls = new Map();
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = p.title; b.setAttribute('aria-pressed', 'false');
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
  else if (e.key === ' ') { e.preventDefault(); commitChord(true); }
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

// --------------------------------- tests ------------------------------------

$('runTests').addEventListener('click', () => {
  const { results, passed, total, allPass } = runSelfTests();
  const sum = $('testSummary');
  sum.textContent = `${passed} of ${total} checks passed${allPass ? ' — all invariants hold' : ''}`;
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
    history.replaceState(null, '', encodeHash(state));
  }, 180);
}

function bootstrap() {
  const h = decodeHash(location.hash);
  if (h.text !== undefined) state.text = h.text;
  if (h.grade) state.grade = h.grade;
  if (h.maxCols) state.maxCols = h.maxCols;
  if (h.preset) state.preset = h.preset;
  if (h.lesson) state.lesson = h.lesson;
  if (h.muted) state.muted = h.muted;
  if (h.theme) state.theme = h.theme;

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
  selectTab(h.tab || 'studio');
}
bootstrap();
