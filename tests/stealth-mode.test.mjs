import test from 'node:test';
import assert from 'node:assert/strict';
import { stealthEnabled, stealthChromeArgs } from '../stealth-mode.ts';

test('stealth is on by default and opts out on explicit false', () => {
  for (const value of [undefined, '', '1', 'true', 'TRUE']) assert.equal(stealthEnabled(value), true);
  for (const value of ['0', 'false', 'FALSE']) assert.equal(stealthEnabled(value), false);
  assert.throws(() => stealthEnabled('nope'), /Invalid DESIGNER_STEALTH/);
});

test('stealth launch flags are deterministic', () => {
  assert.deepEqual(stealthChromeArgs(false), []);
  assert.deepEqual(stealthChromeArgs(true), ['--disable-blink-features=AutomationControlled']);
});
