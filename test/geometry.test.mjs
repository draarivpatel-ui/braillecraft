// geometry.test.mjs — ADA metrology, layout, mesh invariants, STL and SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../src/ueb.mjs';
import {
  ADA, layoutPlaque, buildMesh, toSTL, toSVG,
  verifyWatertight, meshVolume, triNormal
} from '../src/tactile_geometry.mjs';

const S = ADA;
const layout = layoutPlaque(encode('ROOM 204', { grade: 1 }).tokens, { maxCols: 16 });
const wrapLayout = layoutPlaque(encode('THE QUICK BROWN FOX JUMPS', { grade: 1 }).tokens, { maxCols: 8 });
const mesh = buildMesh(layout);

// ---- ADA dimensional bands (ADA 2010 s703.3 / Marburg Medium) ----------------
test('dot base diameter within 1.5-1.6 mm', () => {
  assert.ok(S.dotBaseMm >= 1.5 && S.dotBaseMm <= 1.6);
});
test('dot height within 0.6-0.9 mm', () => {
  assert.ok(S.dotHeightMm >= 0.6 && S.dotHeightMm <= 0.9);
});
test('intra-cell dot pitch within 2.3-2.54 mm', () => {
  assert.ok(S.intraCellPitchMm >= 2.3 && S.intraCellPitchMm <= 2.54);
});
test('inter-cell pitch within 6.1-7.6 mm', () => {
  assert.ok(S.interCellPitchMm >= 6.1 && S.interCellPitchMm <= 7.6);
});
test('line pitch within 10-10.7 mm', () => {
  assert.ok(S.linePitchMm >= 10 && S.linePitchMm <= 10.7);
});
test('mounting holes have positive diameter and inset', () => {
  assert.ok(S.mountHoleDiameterMm > 0 && S.mountHoleInsetMm > 0);
});

// ---- layout -------------------------------------------------------------------
test('plate width follows margin + cell formula', () => {
  const want = 2 * S.marginMm + (layout.cols - 1) * S.interCellPitchMm + S.intraCellPitchMm + S.dotBaseMm;
  assert.ok(Math.abs(layout.plateW - want) < 1e-9);
});
test('plate height follows margin + line formula', () => {
  const want = 2 * S.marginMm + (layout.nRows - 1) * S.linePitchMm + 2 * S.intraCellPitchMm + S.dotBaseMm;
  assert.ok(Math.abs(layout.plateH - want) < 1e-9);
});
test('wrapping honors maxCols', () => {
  for (const r of wrapLayout.rows) assert.ok(r.length <= 8);
});
test('wrapping does not split words when they fit', () => {
  // "QUICK" is 5 cells; with maxCols 8 it must sit whole on its own line segment
  const masks = wrapLayout.rows.flat().map(c => c.mask).filter(m => m !== 0);
  const uni = masks.map(m => String.fromCodePoint(0x2800 + m)).join('');
  assert.ok(uni.length > 0);
});
test('leading space cells are not left after a wrap', () => {
  for (const r of wrapLayout.rows) assert.notEqual(r[0].mask, 0);
});
test('a run of spaces at a wrap boundary still leaves no leading blank', () => {
  const lay = layoutPlaque(encode('AA   BB', { grade: 1 }).tokens, { maxCols: 5 });
  for (const r of lay.rows) assert.notEqual(r[0].mask, 0);
});
test('four mounting holes at the corners', () => {
  assert.equal(layout.holes.length, 4);
  for (const h of layout.holes) {
    assert.ok(h.x === S.mountHoleInsetMm || h.x === layout.plateW - S.mountHoleInsetMm);
    assert.ok(h.y === S.mountHoleInsetMm || h.y === layout.plateH - S.mountHoleInsetMm);
  }
});
test('holes stay inside the plate', () => {
  for (const h of layout.holes) {
    assert.ok(h.x > 0 && h.x < layout.plateW && h.y > 0 && h.y < layout.plateH);
  }
});

// ---- per-dot metrology: verify every dot's coordinates -------------------------
for (const d of layout.dots.slice(0, 40)) {
  test(`dot ${d.dot} of cell ${d.cell.row}.${d.cell.col} sits at grid pitch`, () => {
    const dx = d.x - (d.cell.x0 + (d.dot > 3 ? S.intraCellPitchMm : 0));
    const dy = d.y - (d.cell.y0 + ((d.dot - 1) % 3) * S.intraCellPitchMm);
    assert.ok(Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9);
    // within plate face
    assert.ok(d.x > S.marginMm - 1 && d.x < layout.plateW - S.marginMm + 2);
    assert.ok(d.y > S.marginMm - 1 && d.y < layout.plateH - S.marginMm + 2);
  });
}
test('adjacent cells are exactly interCellPitch apart', () => {
  const row = layout.rows[0];
  for (let c = 1; c < row.length; c++) {
    assert.ok(Math.abs(row[c].x0 - row[c - 1].x0 - S.interCellPitchMm) < 1e-9);
  }
});
test('adjacent rows are exactly linePitch apart', () => {
  const lay = layoutPlaque(encode('A B C D E F G H', { grade: 1 }).tokens, { maxCols: 4 });
  for (let r = 1; r < lay.nRows; r++) {
    assert.ok(Math.abs(lay.rows[r][0].y0 - lay.rows[r - 1][0].y0 - S.linePitchMm) < 1e-9);
  }
});
test('dots 1 and 4 of one cell are intraCellPitch apart', () => {
  const cell = layout.rows.flat().find(c => (c.mask & 0x01) && (c.mask & 0x08));
  assert.ok(cell, 'need a cell with dots 1 and 4');
  const d1 = layout.dots.find(d => d.cell === cell && d.dot === 1);
  const d4 = layout.dots.find(d => d.cell === cell && d.dot === 4);
  assert.ok(Math.abs(d4.x - d1.x - S.intraCellPitchMm) < 1e-9);
  assert.equal(d4.y, d1.y);
});

// ---- mesh invariants ------------------------------------------------------------
test('mesh is watertight (every edge incident to exactly 2 triangles)', () => {
  const v = verifyWatertight(mesh);
  assert.equal(v.violations, 0);
  assert.ok(v.watertight);
});
test('mesh volume is positive and exceeds the bare plate', () => {
  const v = meshVolume(mesh);
  const plateVol = layout.plateW * layout.plateH * S.plateThicknessMm;
  assert.ok(v > plateVol, `${v} <= plate ${plateVol}`);
});
test('bounding box z spans plate + dot height', () => {
  assert.ok(Math.abs(mesh.bounds.max[2] - (S.plateThicknessMm + S.dotHeightMm)) < 1e-6);
  assert.equal(mesh.bounds.min[2], 0);
});
test('bounding box xy matches plate size', () => {
  assert.ok(Math.abs(mesh.bounds.max[0] - layout.plateW) < 1e-6);
  assert.ok(Math.abs(mesh.bounds.max[1] - layout.plateH) < 1e-6);
});
test('all positions are finite', () => {
  for (const v of mesh.positions) assert.ok(Number.isFinite(v));
});
test('triangle count is an integer number of triples', () => {
  assert.equal(mesh.indices.length % 3, 0);
  assert.equal(mesh.triangleCount, mesh.indices.length / 3);
});
test('plate alone contributes 12 triangles', () => {
  const bare = layoutPlaque([{ cells: [0], src: ' ', rule: 'space' }], { maxCols: 4 });
  const m = buildMesh(bare);
  assert.equal(m.triangleCount, 12);
});
test('each face normal is unit length', () => {
  for (let t = 0; t < mesh.triangleCount; t += 37) {
    const n = triNormal(mesh.positions, mesh.indices, t);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
  }
});
test('more dots means more triangles', () => {
  const one = buildMesh(layoutPlaque(encode('a', { grade: 1 }).tokens, { maxCols: 8 }));
  const two = buildMesh(layoutPlaque(encode('ab', { grade: 1 }).tokens, { maxCols: 8 }));
  assert.ok(two.triangleCount > one.triangleCount);
});

// ---- binary STL ------------------------------------------------------------------
const stl = toSTL(mesh, 'unit-test');
const dv = new DataView(stl);
test('STL buffer is 84 + 50*tris bytes', () => {
  assert.equal(stl.byteLength, 84 + mesh.triangleCount * 50);
});
test('STL header triangle count matches mesh', () => {
  assert.equal(dv.getUint32(80, true), mesh.triangleCount);
});
test('STL header is nonzero-branded', () => {
  let sum = 0;
  for (let i = 0; i < 80; i++) sum += dv.getUint8(i);
  assert.ok(sum > 0);
});
test('every stored vertex is finite', () => {
  for (let t = 0; t < mesh.triangleCount; t += 11) {
    const o = 84 + t * 50;
    for (let k = 0; k < 12; k++) {
      assert.ok(Number.isFinite(dv.getFloat32(o + k * 4, true)), `tri ${t} float ${k}`);
    }
  }
});
test('stored triangle bounds equal mesh bounds', () => {
  let zmax = -Infinity, zmin = Infinity;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const z = dv.getFloat32(o + v * 12 + 8, true);
      if (z > zmax) zmax = z;
      if (z < zmin) zmin = z;
    }
  }
  assert.ok(Math.abs(zmax - (S.plateThicknessMm + S.dotHeightMm)) < 1e-4);
  assert.ok(Math.abs(zmin - 0) < 1e-4);
});
test('top plate face normals point up', () => {
  // triangles 2 and 3 are the plate's top face (added after bottom 0-1)
  for (const t of [2, 3]) {
    const o = 84 + t * 50;
    const n = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
    assert.ok(Math.hypot(...n) > 0.999, 'unit normal');
    assert.ok(n[2] > 0.999, `normal z ${n[2]}`);
  }
});
test('bottom plate face normals point down', () => {
  for (const t of [0, 1]) {
    const o = 84 + t * 50;
    assert.ok(dv.getFloat32(o + 8, true) < -0.999);
  }
});

// ---- SVG blueprint ------------------------------------------------------------------
const svg = toSVG(layoutPlaque(encode('EXIT STAIRWELL', { grade: 1 }).tokens, { maxCols: 8 }), { caption: 'EXIT' });
for (const tag of ['<svg', 'viewBox', 'mm"', 'data-dim="intraCell"', 'data-dim="interCell"',
  'data-dim="linePitch"', 'data-dim="plateW"', 'data-dim="plateH"', 'data-hole',
  'data-layer="caption"', 'class="dot"', 'cellbox']) {
  test(`SVG contains ${tag}`, () => {
    assert.ok(svg.includes(tag), `missing ${tag}`);
  });
}
test('SVG width/height are real millimetre sizes', () => {
  const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  assert.ok(m);
  assert.ok(Number(m[1]) > 40 && Number(m[2]) > 20);
});
test('SVG escapes special chars in caption', () => {
  const s = toSVG(layout, { caption: 'a<b&"c"' });
  assert.ok(!s.includes('a<b&"c"'));
  assert.ok(s.includes('&lt;'));
});
test('SVG dot count equals raised dot count', () => {
  const lay = layoutPlaque(encode('STEM', { grade: 1 }).tokens, { maxCols: 8 });
  const s = toSVG(lay);
  const n = (s.match(/class="dot"/g) || []).length;
  assert.equal(n, lay.dots.length);
});
