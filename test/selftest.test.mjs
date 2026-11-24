// selftest.test.mjs: the in-page suite must pass identically in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTests } from '../src/selftest.mjs';

test('in-page self-test suite passes 100% under Node', () => {
  const r = runSelfTests();
  const fails = r.results.filter(x => !x.pass);
  assert.equal(fails.length, 0, fails.map(f => `${f.name}: ${f.detail}`).join('; '));
  assert.ok(r.total >= 30);
});
