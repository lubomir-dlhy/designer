import test from 'node:test';
import assert from 'node:assert/strict';
import { designerHeadless, headlessChromeArgs, windowSizeArgs } from '../chrome-mode.ts';
import { isClaudeDesignUrl, isHeadlessBrowser } from '../cdp-ensure.ts';

test('headless mode requires an explicit accepted boolean', () => {
  for (const value of [undefined, '', '0', 'false', 'FALSE']) assert.equal(designerHeadless(value), false);
  for (const value of ['1', 'true', 'TRUE']) assert.equal(designerHeadless(value), true);
  assert.throws(() => designerHeadless('yes'), /Invalid DESIGNER_HEADLESS/);
});

test('headless launch flags are deterministic', () => {
  assert.deepEqual(headlessChromeArgs(false), []);
  assert.deepEqual(headlessChromeArgs(true), ['--headless=new']);
});

test('window size defaults to 1920x1080 and accepts overrides', () => {
  assert.deepEqual(windowSizeArgs(undefined), ['--window-size=1920,1080']);
  assert.deepEqual(windowSizeArgs(''), ['--window-size=1920,1080']);
  assert.deepEqual(windowSizeArgs('1600x1000'), ['--window-size=1600,1000']);
  assert.deepEqual(windowSizeArgs('1440,900'), ['--window-size=1440,900']);
  assert.deepEqual(windowSizeArgs('0'), []);
  assert.deepEqual(windowSizeArgs('off'), []);
  assert.throws(() => windowSizeArgs('huge'), /Invalid DESIGNER_WINDOW_SIZE/);
});

test('verification recovery only accepts Claude Design URLs', () => {
  assert.equal(isClaudeDesignUrl('https://claude.ai/design/p/abc?file=x'), true);
  assert.equal(isClaudeDesignUrl('https://claude.ai/designer'), false);
  assert.equal(isClaudeDesignUrl('https://example.com/design/p/abc'), false);
  assert.equal(isClaudeDesignUrl('not a URL'), false);
});

test('headless detection uses the browser user agent', () => {
  assert.equal(isHeadlessBrowser({ 'User-Agent': 'Mozilla/5.0 HeadlessChrome/152.0.0.0' }), true);
  assert.equal(isHeadlessBrowser({ 'User-Agent': 'Mozilla/5.0 Chrome/152.0.0.0' }), false);
});
