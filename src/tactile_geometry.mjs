// tactile_geometry.mjs — ADA / ANSI A117.1 tactile Braille metrology,
// a watertight-manifold STL mesh generator, and a 1:1 mm SVG blueprint
// exporter for swell-paper embossers and laser-cut drill templates.
//
// Dimensions follow ADA 2010 Standards section 703.3 (Braille) with the
// Marburg Medium cell proportions used by US signage fabricators.

export const ADA = {
  specName: 'ADA 2010 s703.3 / Marburg Medium',
  dotBaseMm: 1.5, // dot base diameter (ADA: 1.5-1.6 mm)
  dotHeightMm: 0.6, // dot height above plate face (ADA: 0.6-0.9 mm)
  intraCellPitchMm: 2.34, // dot-to-dot distance within a cell (ADA: 2.3-2.54)
  interCellPitchMm: 6.2, // corresponding dots of adjacent cells (ADA: 6.1-7.6)
  linePitchMm: 10.0, // corresponding dots of adjacent lines (ADA: 10-10.7)
  marginMm: 12.0, // clear border around the cell field
  plateThicknessMm: 3.0,
  cornerRadiusMm: 2.0, // blueprint edge rounding note
  mountHoleDiameterMm: 4.0,
  mountHoleInsetMm: 8.0, // hole centre from each plate edge
  dotEmbedMm: 0.05 // dome skirt seated below plate face (keeps solids watertight)
};

// ---------------------------------------------------------------------------
// Layout: cell stream -> rows/columns on the plate
// ---------------------------------------------------------------------------

// input: array of tokens ({cells:[masks], src, rule}) or plain masks.
// Wraps at space cells up to maxCols cells per line (words are never split
// unless a single word is wider than the plate).
export function layoutPlaque(tokens, { maxCols = 32, spec = ADA } = {}) {
  // Word wrap: a token's cells stay together when possible; each placed cell
  // keeps its source text and UEB rule for the interactive inspector.
  const groups = [];
  for (const t of tokens) {
    const masks = typeof t === 'number' ? [t] : t.cells;
    groups.push({
      masks,
      src: typeof t === 'number' ? '' : t.src,
      rule: typeof t === 'number' ? 'letter' : t.rule,
      isSpace: typeof t !== 'number' && t.rule === 'space'
    });
  }
  const rows = [];
  let row = [];
  let rowLen = 0;
  const flush = () => { if (row.length) rows.push(row); row = []; rowLen = 0; };
  for (const g of groups) {
    if (rowLen + g.masks.length > maxCols && row.length) {
      // do not leave a leading space on the next row
      if (g.isSpace) { flush(); continue; }
      flush();
    }
    for (const m of g.masks) row.push({ mask: m, src: g.src, rule: g.rule });
    rowLen += g.masks.length;
  }
  flush();

  const cols = Math.max(1, ...rows.map(r => r.length));
  const nRows = Math.max(1, rows.length);
  const plateW = 2 * spec.marginMm + (cols - 1) * spec.interCellPitchMm + spec.intraCellPitchMm + spec.dotBaseMm;
  const plateH = 2 * spec.marginMm + (nRows - 1) * spec.linePitchMm + 2 * spec.intraCellPitchMm + spec.dotBaseMm;

  const out = { rows: [], cols, nRows, plateW, plateH, spec };
  const grid = rows.length ? rows : [[]];
  for (let r = 0; r < nRows; r++) {
    const line = [];
    const cells = grid[r] || [];
    for (let c = 0; c < cols; c++) {
      const e = cells[c] ?? { mask: 0, src: ' ', rule: 'space' };
      const x0 = spec.marginMm + c * spec.interCellPitchMm;
      const y0 = spec.marginMm + r * spec.linePitchMm;
      line.push({ mask: e.mask, src: e.src, rule: e.rule, row: r, col: c, x0: x0 + spec.dotBaseMm / 2, y0: y0 + spec.dotBaseMm / 2 });
    }
    out.rows.push(line);
  }
  out.holes = [
    { x: spec.mountHoleInsetMm, y: spec.mountHoleInsetMm },
    { x: plateW - spec.mountHoleInsetMm, y: spec.mountHoleInsetMm },
    { x: spec.mountHoleInsetMm, y: plateH - spec.mountHoleInsetMm },
    { x: plateW - spec.mountHoleInsetMm, y: plateH - spec.mountHoleInsetMm }
  ];
  out.dots = [];
  for (const line of out.rows) {
    for (const cell of line) {
      for (let d = 1; d <= 6; d++) {
        if (!(cell.mask & (1 << (d - 1)))) continue;
        const dx = cell.x0 + (d > 3 ? spec.intraCellPitchMm : 0);
        const dy = cell.y0 + ((d - 1) % 3) * spec.intraCellPitchMm;
        out.dots.push({ x: dx, y: dy, dot: d, cell });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mesh builder: indexed triangle soup with a shared vertex pool so
// edge-incidence (watertightness) checks measure real shared edges.
// ---------------------------------------------------------------------------

function newMesh() {
  return { positions: [], indices: [] };
}

function vert(mesh, x, y, z) {
  const i = mesh.positions.length / 3;
  mesh.positions.push(x, y, z);
  return i;
}

function tri(mesh, a, b, c) {
  mesh.indices.push(a, b, c);
}

function quad(mesh, a, b, c, d) {
  tri(mesh, a, b, c);
  tri(mesh, a, c, d);
}

// Rectangular baseplate: 8 vertices, 12 triangles, outward winding.
function addPlate(mesh, w, h, t) {
  const v = [
    vert(mesh, 0, 0, 0), vert(mesh, w, 0, 0), vert(mesh, w, h, 0), vert(mesh, 0, h, 0),
    vert(mesh, 0, 0, t), vert(mesh, w, 0, t), vert(mesh, w, h, t), vert(mesh, 0, h, t)
  ];
  quad(mesh, v[0], v[3], v[2], v[1]); // bottom (-z)
  quad(mesh, v[4], v[5], v[6], v[7]); // top (+z)
  quad(mesh, v[0], v[1], v[5], v[4]); // front (-y)
  quad(mesh, v[1], v[2], v[6], v[5]); // right (+x)
  quad(mesh, v[2], v[3], v[7], v[6]); // back (+y)
  quad(mesh, v[3], v[0], v[4], v[7]); // left (-x)
}

// Faceted spherical-cap dome, closed by a flat base fan seated below the
// plate face so every solid stays watertight under union.
function addDome(mesh, cx, cy, spec, { az = 12, rings = 3 } = {}) {
  const r = spec.dotBaseMm / 2;
  const zTop = spec.plateThicknessMm;
  const apex = zTop + spec.dotHeightMm;
  const zRim = zTop - spec.dotEmbedMm;
  const hCap = apex - zRim;
  const R = (r * r + hCap * hCap) / (2 * hCap); // osculating sphere radius
  const zc = apex - R;
  const thetaMax = Math.acos((zRim - zc) / R);

  const ringIdx = [];
  for (let k = 1; k <= rings; k++) {
    const th = (k / rings) * thetaMax;
    const rr = R * Math.sin(th);
    const zz = zc + R * Math.cos(th);
    const ring = [];
    for (let i = 0; i < az; i++) {
      const a = (i / az) * Math.PI * 2;
      ring.push(vert(mesh, cx + rr * Math.cos(a), cy + rr * Math.sin(a), zz));
    }
    ringIdx.push(ring);
  }
  const apexI = vert(mesh, cx, cy, apex);
  const baseC = vert(mesh, cx, cy, zRim);

  // apex fan
  const first = ringIdx[0];
  for (let i = 0; i < az; i++) {
    const j = (i + 1) % az;
    tri(mesh, apexI, first[i], first[j]);
  }
  // ring bands
  for (let k = 0; k + 1 < ringIdx.length; k++) {
    const up = ringIdx[k], lo = ringIdx[k + 1];
    for (let i = 0; i < az; i++) {
      const j = (i + 1) % az;
      tri(mesh, up[i], lo[i], lo[j]);
      tri(mesh, up[i], lo[j], up[j]);
    }
  }
  // flat base fan (normal -z)
  const rim = ringIdx[ringIdx.length - 1];
  for (let i = 0; i < az; i++) {
    const j = (i + 1) % az;
    tri(mesh, baseC, rim[j], rim[i]);
  }
}

export function buildMesh(layout, opts = {}) {
  const spec = layout.spec;
  const mesh = newMesh();
  addPlate(mesh, layout.plateW, layout.plateH, spec.plateThicknessMm);
  for (const d of layout.dots) addDome(mesh, d.x, d.y, spec, opts);
  const positions = new Float64Array(mesh.positions);
  const indices = new Uint32Array(mesh.indices);
  const out = {
    positions, indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    bounds: boundsOf(positions)
  };
  return out;
}

function boundsOf(pos) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < b.min[k]) b.min[k] = pos[i + k];
      if (pos[i + k] > b.max[k]) b.max[k] = pos[i + k];
    }
  }
  return b;
}

export function triNormal(pos, indices, t) {
  const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// Signed volume via the divergence theorem; positive = consistent outward winding.
export function meshVolume(mesh) {
  const { positions: p, indices: ix } = mesh;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
          - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return vol;
}

// Watertight check: every undirected edge belongs to exactly 2 triangles.
export function verifyWatertight(mesh) {
  const { positions: p, indices: ix } = mesh;
  const key = vi => `${p[vi * 3].toFixed(6)},${p[vi * 3 + 1].toFixed(6)},${p[vi * 3 + 2].toFixed(6)}`;
  const edges = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    const vs = [ix[t], ix[t + 1], ix[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = key(vs[e]), b = key(vs[(e + 1) % 3]);
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(id, (edges.get(id) || 0) + 1);
    }
  }
  let violations = 0;
  for (const n of edges.values()) if (n !== 2) violations++;
  return { edgeCount: edges.size, violations, watertight: violations === 0 };
}

// ---------------------------------------------------------------------------
// Binary STL writer
// ---------------------------------------------------------------------------

export function toSTL(mesh, name = 'braillecraft-plaque') {
  const { positions: p, indices: ix } = mesh;
  const nTri = ix.length / 3;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  const header = `BINARY STL ${name} tris=${nTri}`;
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  dv.setUint32(80, nTri, true);
  let o = 84;
  for (let t = 0; t < nTri; t++) {
    const n = triNormal(p, ix, t);
    dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true);
    o += 12;
    for (let k = 0; k < 3; k++) {
      const vi = ix[t * 3 + k] * 3;
      dv.setFloat32(o, p[vi], true); dv.setFloat32(o + 4, p[vi + 1], true); dv.setFloat32(o + 8, p[vi + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// SVG blueprint (1:1 millimetre) — swell-paper / laser drill template
// ---------------------------------------------------------------------------

const f3 = n => Math.round(n * 1000) / 1000;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DIM_STYLE = 'stroke="#b0482c" stroke-width="0.2"';
const DIMLABEL_STYLE = 'font-family="ui-monospace,Menlo,monospace" font-size="2.6" fill="#b0482c" text-anchor="middle"';
const NOTE_STYLE = 'font-family="ui-sans-serif,system-ui,sans-serif" font-size="2.6" fill="#5b6673"';

function dimArrow(x1, y1, x2, y2, label, { vertical = false, offset = 0 } = {}) {
  const lx = x1 + (vertical ? offset : (x2 - x1) / 2);
  const ly = y1 + (vertical ? (y2 - y1) / 2 : offset);
  return `<g class="dim" data-dim="${esc(label)}" pointer-events="none">
<line x1="${f3(x1)}" y1="${f3(y1)}" x2="${f3(x2)}" y2="${f3(y2)}" ${DIM_STYLE} marker-start="url(#ah)" marker-end="url(#ah)"/>
<text x="${f3(lx)}" y="${f3(ly)}" class="dimlabel" ${DIMLABEL_STYLE}>${f3(Math.abs(vertical ? y2 - y1 : x2 - x1))}</text>
</g>`;
}

export function toSVG(layout, { caption = '', spec = ADA } = {}) {
  const pad = 14; // drawing margin around the plate for callouts
  const W = layout.plateW + 2 * pad;
  const H = layout.plateH + 2 * pad;
  const ox = pad, oy = pad;
  const s = spec;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f3(W)}mm" height="${f3(H)}mm" viewBox="0 0 ${f3(W)} ${f3(H)}" role="img" aria-label="Braille plaque blueprint, true scale millimetres">`);
  out.push(`<title>BrailleCraft plaque blueprint</title>`);
  out.push(`<desc>${esc(s.specName)}. Units are millimetres at 1:1 scale.</desc>`);
  // All visuals use presentation attributes, not a <style> block: the file
  // renders identically standalone and inside a strict-CSP host page.
  out.push(`<defs>
<marker id="ah" markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 z" fill="#b0482c"/></marker>
</defs>`);
  out.push(`<rect width="${f3(W)}" height="${f3(H)}" fill="#ffffff"/>`);
  out.push(`<rect class="plate" x="${f3(ox)}" y="${f3(oy)}" width="${f3(layout.plateW)}" height="${f3(layout.plateH)}" rx="${f3(s.cornerRadiusMm)}" fill="#fdfdfb" stroke="#1b2430" stroke-width="0.3"/>`);

  // cell groups: dashed cell box + raised dots + transparent hit rect for
  // the interactive inspector (harmless in the exported file)
  for (const line of layout.rows) {
    for (const cell of line) {
      const bx = ox + cell.x0 - s.dotBaseMm / 2 - 0.4;
      const by = oy + cell.y0 - s.dotBaseMm / 2 - 0.4;
      const bw = s.intraCellPitchMm + s.dotBaseMm + 0.8;
      const bh = 2 * s.intraCellPitchMm + s.dotBaseMm + 0.8;
      out.push(`<g class="cellg" data-cell="${cell.row}.${cell.col}">`);
      out.push(`<rect class="cellbox" x="${f3(bx)}" y="${f3(by)}" width="${f3(bw)}" height="${f3(bh)}" fill="none" stroke="#8a97a8" stroke-width="0.15" stroke-dasharray="0.8,0.6"/>`);
      for (let d = 1; d <= 6; d++) {
        if (!(cell.mask & (1 << (d - 1)))) continue;
        const cx = ox + cell.x0 + (d > 3 ? s.intraCellPitchMm : 0);
        const cy = oy + cell.y0 + ((d - 1) % 3) * s.intraCellPitchMm;
        out.push(`<circle class="dot" data-dot="${cell.row}.${cell.col}.${d}" cx="${f3(cx)}" cy="${f3(cy)}" r="${f3(s.dotBaseMm / 2)}" fill="#1b2430"/>`);
      }
      out.push(`<rect class="cellhit" x="${f3(bx - 1)}" y="${f3(by - 1)}" width="${f3(bw + 2)}" height="${f3(bh + 2)}" fill="rgba(0,0,0,0)"/>`);
      out.push('</g>');
    }
  }

  // mounting holes with crosshairs
  for (const h of layout.holes) {
    out.push(`<g data-hole="1"><circle class="hole" cx="${f3(ox + h.x)}" cy="${f3(oy + h.y)}" r="${f3(s.mountHoleDiameterMm / 2)}" fill="none" stroke="#b0482c" stroke-width="0.25"/>
<line class="holecross" x1="${f3(ox + h.x - 3)}" y1="${f3(oy + h.y)}" x2="${f3(ox + h.x + 3)}" y2="${f3(oy + h.y)}" stroke="#b0482c" stroke-width="0.15"/>
<line class="holecross" x1="${f3(ox + h.x)}" y1="${f3(oy + h.y - 3)}" x2="${f3(ox + h.x)}" y2="${f3(oy + h.y + 3)}" stroke="#b0482c" stroke-width="0.15"/></g>`);
  }

  // dimension callouts on the first populated row
  const r0 = layout.rows.find(l => l.some(c => c.mask !== 0)) || layout.rows[0];
  const c0 = r0[0];
  out.push(dimArrow(ox + c0.x0, oy + c0.y0 - 1.4, ox + c0.x0 + s.intraCellPitchMm, oy + c0.y0 - 1.4, 'intraCell', { offset: -1.8 }));
  if (r0.length > 1) {
    out.push(dimArrow(ox + r0[0].x0, oy + r0[0].y0 - 4.4, ox + r0[1].x0, oy + r0[1].y0 - 4.4, 'interCell', { offset: -1.8 }));
  }
  if (layout.rows.length > 1) {
    out.push(dimArrow(ox + layout.rows[0][0].x0 - 5.4, oy + layout.rows[0][0].y0, ox + layout.rows[1][0].x0 - 5.4, oy + layout.rows[1][0].y0, 'linePitch', { vertical: true, offset: -1.8 }));
  }
  out.push(dimArrow(ox, oy - 6, ox + layout.plateW, oy - 6, 'plateW', { offset: -2 }));
  out.push(dimArrow(ox - 6, oy, ox - 6, oy + layout.plateH, 'plateH', { vertical: true, offset: -2 }));
  const hole0 = layout.holes[0];
  out.push(dimArrow(ox, oy + layout.plateH + 5, ox + hole0.x, oy + layout.plateH + 5, 'holeInset', { offset: 3 }));

  // high-contrast visual caption layer (ADA 703.4 raised/visual text note)
  if (caption) {
    out.push(`<g data-layer="caption" pointer-events="none"><text class="captext" font-family="ui-sans-serif,system-ui,sans-serif" font-size="5.5" font-weight="700" fill="#1b2430" letter-spacing="0.5" text-anchor="middle" x="${f3(ox + layout.plateW / 2)}" y="${f3(oy + layout.plateH - s.marginMm / 2 + 1)}">${esc(caption.toUpperCase())}</text></g>`);
  }
  out.push(`<text class="note" ${NOTE_STYLE} x="${f3(ox + 1)}" y="${f3(H - 3)}" pointer-events="none">BrailleCraft ${esc(s.specName)} | dot dia ${s.dotBaseMm} | dot ht ${s.dotHeightMm} | cell ${s.intraCellPitchMm}/${s.interCellPitchMm}/${s.linePitchMm} | hole dia ${s.mountHoleDiameterMm} @ ${s.mountHoleInsetMm} inset</text>`);
  out.push('</svg>');
  return out.join('\n');
}
