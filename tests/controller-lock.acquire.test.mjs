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

// --- the epoch that lock-free readers use to detect ABA ---
import { driverEpoch } from '../designer-controller.ts';

test('every acquired lock advances the driver epoch', () => {
  const locks = new Map();
  const before = driverEpoch();
  tryAcquireDriverLock(locks, 'sess', 'iterate[a]');
  assert.equal(driverEpoch(), before + 1, 'an acquire is observable to lock-free readers');
});

test('a REFUSED acquire does not advance the epoch — nothing drove the tab', () => {
  const locks = new Map();
  tryAcquireDriverLock(locks, 'sess', 'iterate[a]');
  const after = driverEpoch();
  tryAcquireDriverLock(locks, 'sess', 'deleteFile[b]'); // refused
  assert.equal(driverEpoch(), after, 'a refusal is not a navigation');
});

test('an A -> B -> A round trip is still detectable, which URL equality alone is not', () => {
  const locks = new Map();
  const before = driverEpoch();
  // B drives, releases; A drives, releases. The URL ends where it started.
  tryAcquireDriverLock(locks, 'sess', 'openFile[b]');
  releaseDriverLock(locks, 'sess');
  tryAcquireDriverLock(locks, 'sess', 'openFile[a]');
  releaseDriverLock(locks, 'sess');
  assert.ok(driverEpoch() > before, 'the round trip is visible even though the endpoints match');
});
