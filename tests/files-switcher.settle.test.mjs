import test from 'node:test';
import assert from 'node:assert/strict';
import { foldSettleRead } from '../files-switcher.ts';

// The evidence rule for an irreversible operation, as arithmetic.
// Both claims — "the file is gone" and "the file is still there" — must clear
// the SAME bar: two consecutive supporting reads.

const run = (...kinds) => kinds.reduce((c, kind) => foldSettleRead(c, { kind }), { consecutive: 0, presentStreak: 0 });

test('two consecutive gone reads prove success', () => {
  assert.deepEqual(run('gone', 'gone'), { consecutive: 2, presentStreak: 0 });
});

test('two consecutive present reads prove the file survived', () => {
  assert.deepEqual(run('present', 'present'), { consecutive: 0, presentStreak: 2 });
});

test('an inconclusive read breaks the NEGATIVE streak, not just the positive one', () => {
  // The bug: resetting only `consecutive` let [present, unreadable, present]
  // satisfy "nothing was deleted" from two NON-consecutive reads — a
  // guaranteed-clean verdict returned after an irreversible click.
  assert.equal(run('present', 'inconclusive', 'present').presentStreak, 1);
  assert.equal(run('present', 'inconclusive', 'present').consecutive, 0);
});

test('an inconclusive read breaks the positive streak too', () => {
  assert.equal(run('gone', 'inconclusive', 'gone').consecutive, 1);
});

test('the two claims are mutually exclusive — a read supporting one clears the other', () => {
  assert.deepEqual(run('gone', 'present'), { consecutive: 0, presentStreak: 1 });
  assert.deepEqual(run('present', 'gone'), { consecutive: 1, presentStreak: 0 });
});

test('an unrecognised shape supports neither claim', () => {
  assert.deepEqual(run('gone', 'other'), { consecutive: 0, presentStreak: 0 });
  assert.deepEqual(run('present', 'other'), { consecutive: 0, presentStreak: 0 });
});
