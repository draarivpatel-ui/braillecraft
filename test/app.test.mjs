import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode } from '../src/ueb.mjs';
import { layoutPlaque, buildMesh, toSVG } from '../src/tactile_geometry.mjs';
import { PRESETS, presetById } from '../src/presets.mjs';

const app = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
const functionSource = name => {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  return app.slice(start, app.indexOf('\n}', start) + 2);
};

test('the first text input after a preset immediately updates the blueprint caption', () => {
  const controls = new Map();
  const element = () => ({
    listeners: new Map(), attributes: {}, children: [],
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    emit(type) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this }); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(child) { this.children.push(child); },
    querySelectorAll: () => [],
  });
  const $ = id => {
    if (!controls.has(id)) controls.set(id, element());
    return controls.get(id);
  };
  const state = { preset: null, text: '', grade: 2, maxCols: 24, view3d: false };
  const functions = ['rerun', 'currentCaption', 'renderBlueprint'].map(functionSource).join('\n');
  const inputs = app.slice(app.indexOf("// ------------------------------- inputs"),
    app.indexOf("// ------------------------------- trainer"));
  const bindings = { state, $, document: { createElement: element }, PRESETS, presetById,
    encode, layoutPlaque, buildMesh, toSVG, RULE_LABELS: {},
    renderBrailleCells: () => {}, syncHash: () => {}, renderKitOutputs: () => {} };
  const { chipEls } = Function(...Object.keys(bindings),
    'let lastResult, lastLayout, lastMesh;\n' + functions + '\n' + inputs + '\nreturn {chipEls};')(...Object.values(bindings));
  chipEls.get('restroom').emit('click');
  assert.ok($('svgStage').innerHTML.includes('>RESTROOM</text>'));
  $('srcText').value = 'NURSE';
  $('srcText').emit('input');
  assert.equal(state.preset, null);
  assert.equal(state.text, 'NURSE');
  assert.ok($('svgStage').innerHTML.includes('>NURSE</text>'));
  assert.ok(!$('svgStage').innerHTML.includes('>RESTROOM</text>'));
  assert.equal($('presetNote').textContent, '');
  assert.equal(chipEls.get('restroom').attributes['aria-pressed'], 'false');
});
