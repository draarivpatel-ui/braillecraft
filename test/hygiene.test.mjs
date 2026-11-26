// hygiene.test.mjs: static guarantees: files exist, zero external fetches,
// no CDNs, no frameworks, CSP present, accessibility hooks in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(join(ROOT, f), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const app = read('app.mjs');

for (const f of ['index.html', 'styles.css', 'app.mjs', 'src/ueb.mjs',
  'src/tactile_geometry.mjs', 'src/perkins.mjs', 'src/presets.mjs',
  'src/selftest.mjs', 'LICENSE', 'README.md', 'package.json']) {
  test(`repo ships ${f}`, () => assert.ok(existsSync(join(ROOT, f))));
}

// ---- zero external network surface ------------------------------------------------
const EXTERNAL = /(https?:)?\/\/(?!www\.w3\.org\/2000\/svg)(?!aariv\.me)[a-z0-9.-]+\.[a-z]{2,}/i;
for (const f of ['index.html', 'styles.css', 'app.mjs']) {
  test(`${f} references no external origins`, () => {
    const hits = read(f).split('\n').filter(l => EXTERNAL.test(l) && !l.includes('xmlns'));
    assert.deepEqual(hits, [], hits.join('\n'));
  });
}
test('no Google Fonts or CDN link/script tags', () => {
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr|cdnjs/i.test(html));
});
test('no <img>, <link rel="stylesheet"> remote, or fetch calls', () => {
  assert.ok(!/<script(?![^>]*src="app\.mjs")[^>]*src=/i.test(html));
  assert.ok(!/fetch\s*\(|XMLHttpRequest|import\(https?:/i.test(app));
  assert.ok(!/fetch\s*\(|XMLHttpRequest/i.test(read('src/ueb.mjs')));
});
test('CSP meta is present and denies connect-src', () => {
  assert.ok(/Content-Security-Policy/.test(html));
  assert.ok(/connect-src 'none'/.test(html));
  assert.ok(/script-src 'self'/.test(html));
});
test('styles use system font stacks only', () => {
  assert.ok(!/@font-face|fonts\./.test(css));
  assert.ok(/ui-sans-serif|system-ui/.test(css));
});

// ---- accessibility hooks ---------------------------------------------------------
for (const hook of ['role="tablist"', 'role="tab"', 'aria-selected', 'aria-live',
  'role="tabpanel"', 'aria-label', 'lang="en"', 'meta name="viewport"',
  'prefers-reduced-motion']) {
  const src = hook === 'prefers-reduced-motion' ? css : html;
  test(`markup contains ${hook}`, () => assert.ok(src.includes(hook)));
}
test('every interactive button has an accessible name path', () => {
  const btns = html.match(/<button[^>]*>/g) || [];
  assert.ok(btns.length > 10, 'expected many buttons');
});
test('theme toggle and mute toggle exist', () => {
  assert.ok(html.includes('themeToggle') && html.includes('muteToggle'));
});
test('trainer space handler does not steal Space from focused buttons', () => {
  assert.ok(/e\.key === ' ' && tag !== 'BUTTON'/.test(app),
    'space keydown must let focused buttons activate natively');
});
test('keycap buttons are keyboard-activatable (click detail 0 path)', () => {
  const keycapBlock = app.slice(
    app.indexOf("querySelectorAll('.keycap[data-key]')"),
    app.indexOf("$('spaceBtn')")
  );
  assert.ok(/b\.addEventListener\('click'/.test(keycapBlock), 'keycap needs a click listener');
  assert.ok(/e\.detail === 0/.test(keycapBlock), 'keycap click must accept keyboard-initiated clicks only');
});
test('dark theme is implemented via data-theme', () => {
  assert.ok(css.includes('html[data-theme="dark"]'));
});

// ---- module graph ------------------------------------------------------------------
test('app.mjs is a module with no bare imports', () => {
  assert.ok(html.includes('type="module"'));
  const imports = app.match(/from\s+'([^']+)'/g) || [];
  for (const i of imports) assert.ok(i.includes("'./"), i);
});
test('src modules import only relative paths', () => {
  for (const f of readdirSync(join(ROOT, 'src'))) {
    const src = read(`src/${f}`);
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(m[1].startsWith('./'), `${f} -> ${m[1]}`);
    }
  }
});
test('no TODO/FIXME left in shipped source', () => {
  for (const f of ['index.html', 'styles.css', 'app.mjs', ...readdirSync(join(ROOT, 'src')).map(x => `src/${x}`)]) {
    assert.ok(!/\bTODO\b|\bFIXME\b|\bXXX\b/.test(read(f)), f);
  }
});
test('package.json declares node:test and module type', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /node --test/);
});

test('mobile touch target regression keeps controls at least 44px tall', () => {
  const block = css.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(block.includes('.btn, .tab, .seg-btn, .chip, .keycap'), 'interactive controls are not covered');
  assert.ok(block.includes('min-height: 44px'), '44px minimum height rule missing');
  assert.ok(block.includes('min-width: 44px'), '44px minimum width rule missing');
  assert.ok(block.includes('input:not([type="checkbox"])'), 'text and numeric inputs are not covered');
});

test('print handoff regression compacts the monospace sheet for one-page pagination', () => {
  const printRule = css.match(/body\.print-handoff \.handoff \{([^}]*)\}/)?.[1] || '';
  assert.ok(printRule.includes('font-size: 10pt'), 'print handoff font rule missing');
  assert.ok(printRule.includes('line-height: 1.38'), 'print handoff must use compact line-height');
});

test('blueprint inspector regression uses one large touch surface with keyboard cell navigation', () => {
  const renderBlock = app.slice(app.indexOf('function renderBlueprint()'), app.indexOf('function currentCaption()'));
  assert.ok(!renderBlock.includes("g.setAttribute('tabindex'"), 'individual blueprint cells must not be tiny focus targets');
  assert.ok(renderBlock.includes("svgNode.setAttribute('tabindex', '0')"), 'blueprint surface must be keyboard focusable');
  assert.ok(app.includes("addEventListener('pointerdown'"), 'whole blueprint surface must accept touch input');
  assert.ok(app.includes('function nearestBlueprintCell('), 'touch input must resolve the nearest cell');
  assert.ok(app.includes("addEventListener('keydown'"), 'arrow-key cell navigation missing');
  assert.ok(css.includes('.cellg.inspecting .cellbox'), 'selected cell highlight missing');
  assert.ok(html.includes('Hover or tap the blueprint'), 'inspector instructions must match the large touch surface');
});
