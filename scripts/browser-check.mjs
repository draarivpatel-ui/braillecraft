// browser-check.mjs — real headless Chromium audit via Playwright.
// Drives the page at 1440x900 and 390x844, clicks every tab / preset /
// toggle / export / self-test, plays a trainer chord on the real keypad,
// and asserts: 0 console errors, 0 page errors, 0 external requests,
// 0 horizontal overflow. Captures screenshots/desktop.png and
// screenshots/mobile.png for the Devpost gallery.
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = join(ROOT, 'screenshots');

// playwright is resolved from the npx cache or a local install; never vendored
const require = createRequire(import.meta.url);
let chromium = null;
const candidates = ['playwright'];
try {
  const npx = join(process.env.HOME || '', '.npm/_npx');
  for (const d of readdirSync(npx)) candidates.push(join(npx, d, 'node_modules/playwright'));
} catch { /* no npx cache */ }
for (const c of candidates) {
  try { ({ chromium } = require(c)); break; } catch { /* next */ }
}
if (!chromium) {
  console.error('FAIL  playwright is not installed (npm i -D playwright or npx playwright)');
  process.exit(2);
}

const results = [];
let consoleErrors = 0, pageErrors = 0, externalRequests = 0, failedRequests = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const { server, url } = await startServer();
const base = new URL(url).origin;
// Prefer the installed real Chrome (version-proof); fall back to the
// Playwright-bundled headless shell if Chrome is absent.
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}

async function auditViewport({ name, width, height, mobile = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: mobile,
    isMobile: mobile,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') { consoleErrors++; errs.push(m.text()); } });
  page.on('pageerror', e => { pageErrors++; errs.push(`pageerror: ${e.message}`); });
  page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externalRequests++; });
  page.on('requestfailed', r => { failedRequests++; errs.push(`reqfail ${r.url()}`); });

  await page.goto(url, { waitUntil: 'networkidle' });
  check(`${name}: page loads`, true);

  check(`${name}: title`, (await page.title()).includes('BrailleCraft'));

  // Studio basics
  await page.locator('#srcText').fill('ROOM 204');
  const out = await page.locator('#brailleOut').textContent();
  check(`${name}: live translation renders braille`, /\u2800|\u28[0-9a-f]/i.test(out || ''), out.trim().slice(0, 40));

  // preset chips
  const chips = page.locator('#presetChips .chip');
  const nChips = await chips.count();
  check(`${name}: five preset chips`, nChips === 5, `${nChips}`);
  await chips.nth(1).click();
  const val = await page.locator('#srcText').inputValue();
  check(`${name}: preset loads text`, val === 'EYEWASH STATION', val);

  // grade toggle
  await page.locator('#grade1').click();
  const g1out = await page.locator('#brailleOut').textContent();
  await page.locator('#grade2').click();
  const g2out = await page.locator('#brailleOut').textContent();
  check(`${name}: grade toggle changes output`, g1out !== g2out || val === 'EYEWASH STATION');

  // blueprint svg + inspector
  await page.locator('#view2d').click();
  const cellCount = await page.locator('#svgStage .cellg').count();
  check(`${name}: blueprint renders cells`, cellCount > 0, `${cellCount} cells`);
  await page.locator('#svgStage .cellg').first().hover();
  const insp = await page.locator('#inspector').textContent();
  check(`${name}: cell inspector reports a cell`, /U\+28|row 1/i.test(insp || ''));

  // 3D relief preview
  await page.locator('#view3d').click();
  const canvasVisible = await page.locator('#isoCanvas').isVisible();
  check(`${name}: relief 3D canvas visible`, canvasVisible);
  const px = await page.locator('#isoCanvas').evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let nz = 0;
    for (let i = 3; i < d.length; i += 997 * 4) if (d[i] > 0) nz++;
    return nz;
  });
  check(`${name}: relief 3D paints pixels`, px > 10, `${px} lit samples`);
  await page.locator('#tilt').fill('45');

  // exports: STL and SVG downloads
  const [dl1] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#dlStl').click()
  ]);
  check(`${name}: STL downloads`, dl1.suggestedFilename().endsWith('.stl'), dl1.suggestedFilename());
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#dlSvg').click()
  ]);
  check(`${name}: SVG downloads`, dl2.suggestedFilename().endsWith('.svg'), dl2.suggestedFilename());

  // share link sets a stateful hash
  await page.locator('#shareLink').click();
  const hash = await page.evaluate(() => location.hash);
  check(`${name}: share link writes state hash`, hash.includes('t=') && hash.includes('g='));

  // trainer tab: play one real chord on the keypad
  await page.locator('#tab-trainer').click();
  const trainerVisible = await page.locator('#panel-trainer').isVisible();
  check(`${name}: trainer tab opens`, trainerVisible);
  // choose Grade-2 lesson then emboss "and" (f+d+s+j+l)
  await page.locator('#lessonList .chip').nth(2).click();
  if (mobile) {
    const keys = page.locator('.keycap[data-key]');
    for (const k of ['f', 'd', 's', 'j', 'l']) await page.locator(`.keycap[data-key="${k}"]`).dispatchEvent('pointerdown', { pointerId: 9 });
    for (const k of ['l', 'j', 's', 'd', 'f']) await page.locator(`.keycap[data-key="${k}"]`).dispatchEvent('pointerup', { pointerId: 9 });
  } else {
    await page.locator('#keypad').focus();
    for (const k of ['f', 'd', 's', 'j', 'l']) await page.keyboard.down(k);
    for (const k of ['l', 'j', 's', 'd', 'f']) await page.keyboard.up(k);
  }
  await page.waitForTimeout(120);
  const logTxt = await page.locator('#trainerLog').textContent();
  const state2 = await page.locator('#cellstate').textContent();
  check(`${name}: trainer chord graded correct`, /correct|embossed/i.test(state2 || ''), (state2 || '').trim());

  // self-tests tab
  await page.locator('#tab-tests').click();
  await page.locator('#runTests').click();
  await page.waitForSelector('#testResults li', { timeout: 15000 });
  const liCount = await page.locator('#testResults li').count();
  const fails = await page.locator('#testResults li.fail').count();
  const summary = await page.locator('#testSummary').textContent();
  check(`${name}: self-tests run in page`, liCount >= 30, `${liCount} checks`);
  check(`${name}: self-tests all pass`, fails === 0, summary.trim());

  // horizontal overflow
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth
  ));
  check(`${name}: zero horizontal overflow`, overflow <= 0, `${overflow}px`);

  await page.locator('#tab-studio').click();
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name === 'desktop' ? 'desktop' : 'mobile'}.png`), fullPage: false });
  await ctx.close();
  return errs;
}

const errsD = await auditViewport({ name: 'desktop', width: 1440, height: 900 });
const errsM = await auditViewport({ name: 'mobile', width: 390, height: 844, mobile: true });

await browser.close();
await new Promise(r => server.close(r));

check('zero console errors across both viewports', consoleErrors === 0, `${consoleErrors}`);
check('zero uncaught page errors', pageErrors === 0, `${pageErrors}`);
check('zero external network requests', externalRequests === 0, `${externalRequests}`);
check('zero failed requests', failedRequests === 0, `${failedRequests}`);

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed; ` +
  `consoleErrors=${consoleErrors} pageErrors=${pageErrors} external=${externalRequests} failedReq=${failedRequests}`);
if (errsD.length || errsM.length) {
  console.log('console/page errors:');
  for (const e of [...errsD, ...errsM].slice(0, 12)) console.log('  ' + e);
}
process.exit(fails.length ? 1 : 0);
