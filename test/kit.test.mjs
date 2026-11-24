// kit.test.mjs: Community Tactile Kit batches, bed packing, batch STL,
// combined SVG sheet, handoff sheet, link codec and study cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIT_PACKS, packById, kitFromPack, normalizeKit, packKit, buildKit, packBed, batchMesh,
  kitSheetSVG, handoffLines, kitJSON, studyCards, checkAnswer, cleanSignText, cleanRole,
  clampQty, MAX_SIGNS, MAX_QTY, MAX_SIGN_LEN, ROLES, BED_MM, PLA_DENSITY_G_CM3
} from '../src/kit.mjs';
import { verifyWatertight, meshVolume, toSTL, ADA } from '../src/tactile_geometry.mjs';
import { encode } from '../src/ueb.mjs';
import { encodeHash, decodeHash } from '../src/presets.mjs';

const DASHES = /[\u2013\u2014]/;

test('three community packs ship', () => assert.equal(KIT_PACKS.length, 3));
test('pack ids are unique', () => assert.equal(new Set(KIT_PACKS.map(p => p.id)).size, 3));
test('packById returns null for unknown', () => assert.equal(packById('nope'), null));
test('kitFromPack returns null for unknown', () => assert.equal(kitFromPack('nope'), null));

for (const pack of KIT_PACKS) {
  for (const grade of [1, 2]) {
    const kit = kitFromPack(pack.id, grade);
    const built = buildKit(kit);
    const bed = packBed(built.signs);
    const tag = `${pack.id} G${grade}`;

    test(`${tag}: one sign per pack item`, () => {
      assert.equal(built.signs.length, pack.items.length);
      built.signs.forEach((s, i) => { assert.equal(s.text, pack.items[i][0]); assert.equal(s.qty, pack.items[i][1]); });
    });
    test(`${tag}: braille matches the encoder exactly`, () => {
      for (const s of built.signs) assert.equal(s.unicode, encode(s.text, { grade }).unicode);
    });
    test(`${tag}: totals add up`, () => {
      assert.equal(built.totals.plates, pack.items.reduce((n, [, q]) => n + q, 0));
      assert.equal(built.totals.dots, built.signs.reduce((n, s) => n + s.dots * s.qty, 0));
      const g = built.signs.reduce((n, s) => n + s.gramsEach * s.qty, 0);
      assert.ok(Math.abs(built.totals.grams - g) < 0.06);
    });
    test(`${tag}: PLA grams follow volume times density`, () => {
      for (const s of built.signs) {
        assert.ok(s.volumeMm3 > 0);
        assert.ok(Math.abs(s.gramsEach - (s.volumeMm3 / 1000) * PLA_DENSITY_G_CM3) <= 0.05);
      }
    });
    test(`${tag}: every plate copy lands on the bed without overlap`, () => {
      assert.equal(bed.placements.length, built.totals.plates);
      for (let i = 0; i < bed.placements.length; i++) {
        for (let j = i + 1; j < bed.placements.length; j++) {
          const a = bed.placements[i], b = bed.placements[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          assert.ok(apart, `${i} overlaps ${j}`);
        }
      }
    });
    test(`${tag}: pack fits one ${BED_MM} mm bed`, () => assert.ok(bed.fitsBed, `${bed.width} x ${bed.depth}`));
    test(`${tag}: batch mesh is watertight`, () => {
      const m = batchMesh(built.signs, bed);
      assert.equal(verifyWatertight(m).violations, 0);
    });
    test(`${tag}: batch mesh volume equals the sum of its plates`, () => {
      const m = batchMesh(built.signs, bed);
      const sum = built.signs.reduce((n, s) => n + s.volumeMm3 * s.qty, 0);
      assert.ok(Math.abs(meshVolume(m) - sum) < 1e-6 * sum);
    });
    test(`${tag}: batch STL has the right triangle count`, () => {
      const m = batchMesh(built.signs, bed);
      const tris = built.signs.reduce((n, s) => n + s.mesh.triangleCount * s.qty, 0);
      assert.equal(m.triangleCount, tris);
      assert.equal(new DataView(toSTL(m)).getUint32(80, true), tris);
    });
    test(`${tag}: combined SVG sheet has one blueprint per sign and unique markers`, () => {
      const svg = kitSheetSVG(built.signs);
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.equal((svg.match(/<title>BrailleCraft plaque blueprint<\/title>/g) || []).length, built.signs.length);
      const ids = svg.match(/id="ah\d+"/g) || [];
      assert.equal(ids.length, built.signs.length);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(!/url\(#ah\)/.test(svg));
    });
    test(`${tag}: handoff sheet lists every sign, spec and role line`, () => {
      const text = handoffLines(kit, built, bed).join('\n');
      for (const s of built.signs) { assert.ok(text.includes(`${s.n}. ${s.text}`)); assert.ok(text.includes(s.unicode)); }
      assert.ok(text.includes(`dot base ${ADA.dotBaseMm} mm`));
      assert.ok(text.includes('Checked by a braille reader'));
      assert.ok(!DASHES.test(text));
    });
    test(`${tag}: study cards come from the kit's words`, () => {
      const words = new Set(kit.items.flatMap(i => i.text.toLowerCase().split(/\s+/)));
      for (const c of studyCards(kit)) {
        assert.ok(words.has(c.word), c.word);
        assert.equal(c.unicode, encode(c.word, { grade }).unicode);
        assert.ok(checkAnswer(c, c.word.toUpperCase()));
      }
    });
  }
}

test('grade 1 never contracts, grade 2 saves cells on the classroom pack', () => {
  const g1 = buildKit(kitFromPack('classroom', 1));
  const g2 = buildKit(kitFromPack('classroom', 2));
  assert.equal(g1.totals.cellsSaved, 0);
  assert.ok(g2.totals.cellsSaved > 0);
  for (const c of studyCards(kitFromPack('classroom', 1))) assert.equal(c.contracted, false);
});
test('known contractions appear on study cards', () => {
  const cards = studyCards(kitFromPack('classroom', 2));
  const by = Object.fromEntries(cards.map(c => [c.word, c]));
  assert.equal(by.library.unicode, '⠇⠊⠃⠗⠜⠽');
  assert.ok(by.library.contracted);
  assert.ok(by.restroom.contracted);
  assert.equal(by.room.contracted, false);
});
test('study cards dedupe and cap', () => {
  const kit = { grade: 2, items: Array.from({ length: 16 }, (_, i) => ({ text: `word${String.fromCharCode(97 + i)} wordb`, qty: 1 })) };
  const cards = studyCards(kit, { max: 5 });
  assert.equal(cards.length, 5);
  assert.equal(new Set(cards.map(c => c.word)).size, 5);
});
test('study cards skip one-letter words', () => {
  assert.deepEqual(studyCards({ grade: 2, items: [{ text: 'B', qty: 1 }] }), []);
});
test('checkAnswer ignores case and punctuation, rejects empty', () => {
  const c = { word: 'library' };
  assert.ok(checkAnswer(c, ' Library! '));
  assert.ok(!checkAnswer(c, 'librery'));
  assert.ok(!checkAnswer(c, ''));
  assert.ok(!checkAnswer(c, null));
});

test('a plate wider than the bed is reported as not fitting', () => {
  const kit = { grade: 1, items: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJ', qty: 1 }], roles: {} };
  const built = buildKit(kit, { maxCols: 40 });
  const bed = packBed(built.signs);
  assert.equal(bed.fitsBed, false);
  assert.ok(handoffLines(kit, built, bed).join('\n').includes('more than one'));
});
test('an empty kit builds to zero', () => {
  const built = buildKit({ grade: 2, items: [] });
  assert.deepEqual(built.totals, { signs: 0, plates: 0, dots: 0, cellsSaved: 0, grams: 0 });
  const bed = packBed(built.signs);
  assert.equal(bed.placements.length, 0);
  assert.equal(batchMesh(built.signs, bed).triangleCount, 0);
});

test('cleanSignText strips markup and caps length', () => {
  assert.equal(cleanSignText('<b>Exit</b>'), 'bExit/b');
  assert.equal([...cleanSignText('x'.repeat(200))].length, MAX_SIGN_LEN);
  assert.equal(cleanSignText('  Room \n 5  '), 'Room 5');
  assert.equal(cleanSignText(42), '');
});
test('cleanRole caps length and drops control chars', () => {
  assert.equal(cleanRole('Ana\u0000'), 'Ana');
  assert.equal([...cleanRole('y'.repeat(90))].length, 32);
});
test('clampQty clamps and rounds', () => {
  assert.equal(clampQty(0), 1);
  assert.equal(clampQty(999), MAX_QTY);
  assert.equal(clampQty('3.6'), 4);
  assert.equal(clampQty('abc'), 1);
});
test('normalizeKit rejects junk shapes', () => {
  for (const v of [null, 5, 'x', []]) assert.deepEqual(normalizeKit(v), { pack: null, grade: 2, items: [], roles: {} });
});
test('normalizeKit keeps only known packs, grades and roles', () => {
  const k = normalizeKit({ pack: 'evil', grade: 3, items: [['Exit', 2]], roles: { design: 'Ana', admin: 'x', check: '<i>Sam</i>' } });
  assert.equal(k.pack, null);
  assert.equal(k.grade, 2);
  assert.deepEqual(k.items, [{ text: 'Exit', qty: 2 }]);
  assert.deepEqual(k.roles, { design: 'Ana', check: 'iSam/i' });
});
test('normalizeKit caps sign count and drops empty signs', () => {
  const items = Array.from({ length: 40 }, (_, i) => [i % 2 ? `Sign ${i}` : '   ', 1]);
  assert.equal(normalizeKit({ items }).items.length, Math.min(20, MAX_SIGNS));
});
test('normalizeKit accepts object items too', () => {
  assert.deepEqual(normalizeKit({ items: [{ text: 'Nurse', qty: 50 }] }).items, [{ text: 'Nurse', qty: MAX_QTY }]);
});
test('roles list is fixed', () => assert.deepEqual([...ROLES], ['design', 'print', 'check', 'mount']));

test('kit survives the real URL hash round trip', () => {
  const kit = kitFromPack('science', 1);
  kit.items.push({ text: 'Café 3', qty: 2 });
  kit.roles = { design: 'Ana', print: 'Leo', check: 'Sam' };
  const h = encodeHash({ tab: 'kit', grade: 2, maxCols: 24, text: 'EXIT', kit: packKit(kit) });
  const d = decodeHash(h);
  assert.equal(d.tab, 'kit');
  assert.equal(d.text, 'EXIT');
  assert.deepEqual(normalizeKit(d.kit), kit);
});
test('a broken kit param does not wipe the rest of the hash', () => {
  const h = encodeHash({ tab: 'kit', grade: 1, text: 'STAIRS' }) + '&k=%%%notbase64';
  const d = decodeHash(h);
  assert.equal(d.tab, 'kit');
  assert.equal(d.grade, 1);
  assert.equal(d.kit, undefined);
});
test('hostile kit text from a link is cleaned', () => {
  const h = encodeHash({ kit: { grade: 2, items: [['<img src=x onerror=alert(1)>', 1]], roles: { mount: '<script>' } } });
  const k = normalizeKit(decodeHash(h).kit);
  assert.ok(!JSON.stringify(k).includes('<'));
});

test('kit JSON mirrors the build and is stable', () => {
  const kit = kitFromPack('center', 2);
  const built = buildKit(kit);
  const bed = packBed(built.signs);
  const j = kitJSON(kit, built, bed);
  assert.equal(j.kind, 'community-kit');
  assert.equal(j.signs.length, built.signs.length);
  assert.equal(j.totals.plates, built.totals.plates);
  assert.equal(j.spec.dotBaseMm, ADA.dotBaseMm);
  assert.equal(JSON.stringify(j), JSON.stringify(kitJSON(kit, built, bed)));
});
