import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../repo-root.ts';

const src = fs.readFileSync(path.join(REPO_ROOT, 'designer-controller.ts'), 'utf8');

// The lock's three load-bearing properties. Each is asserted structurally
// because the behaviour needs a live browser; the acquire/release arithmetic
// itself is unit-tested in controller-lock.acquire.test.mjs.

test('the lock resource is the SESSION (the active tab), not the key or the project', () => {
  const body = src.slice(src.indexOf('private _lockKey()'), src.indexOf('private _busyHolder()'));
  assert.match(body, /this\.browser\.driverId/, 'lock keys on the driver session');
  assert.ok(!/designUrl/.test(body), 'project root must NOT scope the lock — openGuarded navigates the ACTIVE tab');
  assert.ok(!/this\.key/.test(body), 'controller key must not scope the lock — keys share one session in CDP mode');
});

test('re-entrancy is per async OPERATION, not per controller instance', () => {
  const body = src.slice(src.indexOf('private async _withExclusive'), src.indexOf('/** The operation currently driving'));
  assert.match(body, /LOCK_CTX\.getStore\(\)/, 're-entrancy is decided from the async context');
  assert.match(body, /LOCK_CTX\.run\(/, 'the held set is propagated to nested calls');
  // An instance flag would let two concurrent calls on ONE controller both
  // proceed — the MCP server caches one controller per key, so that is reachable.
  assert.ok(!/this\._held|this\._depth/.test(body), 'must not use an instance-level re-entrancy flag');
});

test('every entry point that navigates the tab takes the lock', () => {
  // Derived from the navigation call sites: anything reaching openGuarded /
  // browser.open / activateTab mutates the shared active tab.
  const mustLock = [
    'session', 'ensureReady', 'createSession', 'resumeSession', 'adoptSession',
    'clearInterstitials', 'selectDesignTab', 'listProjects', 'listFiles',
    'listFilesDetailed', 'openFile', 'fetchFile', 'handoff', 'iterate', 'ask', 'deleteFile'
  ];
  const missing = mustLock.filter((m) => !new RegExp(`_withExclusive\\('${m}'`).test(src));
  assert.deepEqual(missing, [], `tab-driving verbs missing the lock: ${missing.join(', ')}`);
});

test('read-only verbs are deliberately NOT locked', () => {
  // Locking these would serialize harmless reads behind a 20-minute generation.
  for (const m of ['getStatus', 'getChatTurns', 'getIframeSrc', 'fetchServedHtml', 'currentUrl']) {
    assert.ok(!new RegExp(`_withExclusive\\('${m}'`).test(src), `${m} must stay lock-free`);
  }
});

test('the commit boundary begins at the first dispatch, not at actuate()s return', () => {
  const body = src.slice(src.indexOf('const actuate = async'), src.indexOf('// --- RESOLVE'));
  assert.match(body, /dispatched: boolean/, 'actuate reports whether it issued a click');
  // Every click site must mark dispatched BEFORE issuing.
  const clicks = [...body.matchAll(/dispatched = true;\s*\n\s*(await )?(this\.browser\.click|const res)/g)];
  assert.ok(clicks.length >= 2, 'each dispatch path marks dispatched before clicking');
});

test('positive and negative outcomes require symmetric evidence', () => {
  const body = src.slice(src.indexOf('// --- POSITIVE SETTLE ---'), src.indexOf('// --- POST-SUCCESS'));
  assert.match(body, /consecutive >= 2/, 'success needs two consecutive reads');
  assert.match(body, /presentStreak >= 2/, 'still-present needs two consecutive reads too');
  assert.ok(!/sawTargetPresent/.test(body), 'the single-read latch is gone');
});
