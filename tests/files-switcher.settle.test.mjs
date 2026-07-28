import test from 'node:test';
import assert from 'node:assert/strict';
import { foldSettleRead, classifySettleRead } from '../files-switcher.ts';

// The evidence rule for an irreversible operation, in two halves that are BOTH
// tested: the classifier (observation -> kind) and the reducer (kind -> counters).
// Testing only the reducer is what let a mis-classification pass everything.

const rows = (...labels) => labels.map((label) => ({ label, editedText: 'Edited now' }));
const run = (...kinds) => kinds.reduce((c, kind) => foldSettleRead(c, { kind }), { consecutive: 0, presentStreak: 0 });

// --- classifier ---

test('an unreadable list is inconclusive, never evidence either way', () => {
  assert.deepEqual(classifySettleRead(null, 'a.html', 2, 1, true), { kind: 'inconclusive' });
});

test('zero rows with the popover SHUT is inconclusive — rows only exist while it is open', () => {
  assert.deepEqual(classifySettleRead([], 'a.html', 2, 1, false), { kind: 'inconclusive' });
});

test('zero rows with the popover OPEN proves the last file is gone', () => {
  // The old code intercepted every empty read as inconclusive before the "gone"
  // arithmetic ran, so deleting a project's only file could never be verified.
  assert.deepEqual(classifySettleRead([], 'only.html', 1, 1, true), { kind: 'gone' });
});

test('zero rows with the popover open but MORE than one file expected is not proof', () => {
  assert.deepEqual(classifySettleRead([], 'a.html', 3, 1, true), { kind: 'other' });
});

test('the row set shrinking by exactly one, target absent, is gone', () => {
  assert.deepEqual(classifySettleRead(rows('b'), 'a.html', 2, 1, true), { kind: 'gone' });
});

test('full cardinality with the target still listed is present', () => {
  assert.deepEqual(classifySettleRead(rows('a', 'b'), 'a.html', 2, 1, true), { kind: 'present' });
});

test('an unexpected shape supports neither claim', () => {
  assert.deepEqual(classifySettleRead(rows('b', 'c', 'd'), 'a.html', 2, 1, true), { kind: 'other' });
});

// --- reducer ---

test('two consecutive gone reads prove success', () => {
  assert.deepEqual(run('gone', 'gone'), { consecutive: 2, presentStreak: 0 });
});

test('an inconclusive read breaks BOTH streaks', () => {
  assert.equal(run('present', 'inconclusive', 'present').presentStreak, 1);
  assert.equal(run('gone', 'inconclusive', 'gone').consecutive, 1);
});

test('the two claims are mutually exclusive', () => {
  assert.deepEqual(run('gone', 'present'), { consecutive: 0, presentStreak: 1 });
  assert.deepEqual(run('present', 'gone'), { consecutive: 1, presentStreak: 0 });
});

test('foldSettleRead is TOTAL — an unknown kind cannot poison the next fold', () => {
  // It used to return undefined, and the next fold threw a TypeError that
  // escaped the declared result union after an irreversible click.
  const out = foldSettleRead({ consecutive: 1, presentStreak: 0 }, { kind: 'GONE' });
  assert.deepEqual(out, { consecutive: 0, presentStreak: 0 });
  assert.doesNotThrow(() => foldSettleRead(out, { kind: 'gone' }));
});
