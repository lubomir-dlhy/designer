import test from 'node:test';
import assert from 'node:assert/strict';
import { tryAcquireDriverLock, releaseDriverLock } from '../designer-controller.ts';

// The lock that serializes tab-driving verbs. Its whole value is that check and
// set happen in ONE tick — a version that awaited between them would let two
// callers both see it free.

test('a second acquire on the same tab is refused and names the holder', () => {
  const locks = new Map();
  assert.equal(tryAcquireDriverLock(locks, 'sess::proj-a', 'iterate[a]'), null, 'first acquire succeeds');
  assert.equal(tryAcquireDriverLock(locks, 'sess::proj-a', 'deleteFile[b]'), 'iterate[a]', 'second is refused');
});

test('different tabs do not block each other (parallel --key work keeps working)', () => {
  const locks = new Map();
  assert.equal(tryAcquireDriverLock(locks, 'sess::proj-a', 'iterate[a]'), null);
  assert.equal(tryAcquireDriverLock(locks, 'sess::proj-b', 'iterate[b]'), null, 'a different project is a different tab');
});

test('a refused caller does not clear or overwrite the holder', () => {
  const locks = new Map();
  tryAcquireDriverLock(locks, 'sess::proj-a', 'iterate[a]');
  tryAcquireDriverLock(locks, 'sess::proj-a', 'deleteFile[b]');
  assert.equal(locks.get('sess::proj-a'), 'iterate[a]', 'holder is unchanged after a refusal');
});

test('release frees the tab for the next caller', () => {
  const locks = new Map();
  tryAcquireDriverLock(locks, 'sess::proj-a', 'iterate[a]');
  releaseDriverLock(locks, 'sess::proj-a');
  assert.equal(tryAcquireDriverLock(locks, 'sess::proj-a', 'deleteFile[b]'), null);
});

test('releasing a tab nobody holds is harmless', () => {
  const locks = new Map();
  releaseDriverLock(locks, 'sess::never-held');
  assert.equal(locks.size, 0);
});
