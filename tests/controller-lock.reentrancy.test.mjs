import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../repo-root.ts';

const raw = fs.readFileSync(path.join(REPO_ROOT, 'designer-controller.ts'), 'utf8');

// Match CODE, not prose. These files carry dense incident comments that name the
// very APIs under test ("...calls listFiles(), which navigates (openGuarded)"),
// so a source scan that includes comments reports the explanation as a
// violation — the same read-the-prose-not-the-code mistake these tests exist to
// catch elsewhere.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = stripComments(raw);

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

// Methods that may mutate the tab without locking, each with the reason. A
// PUBLIC method reaching a mutation and absent from this list fails the test
// below — the point is that a future author cannot add one silently, which a
// hand-maintained "must lock" list could not catch (it only checked names it
// already knew).
const MUTATION_OK = {
  _openGuarded: 'the navigation primitive itself; every caller is wrapped',
  openGuarded: 'the navigation primitive itself; every caller is wrapped',
  _submitPrompt: 'private; only reached from iterate/ask bodies, which hold the lock',
  sendPrompt: 'thin private-ish wrapper over _submitPrompt, same callers',
  _clickButtonByText: 'private helper; only reached from locked bodies',
  _waitForInterstitialClear: 'private; reached from clearInterstitials body',
  snapshotFile: 'IS the locked compound entry point',
  deleteFile: 'takes the lock via its own busy pre-check + _withExclusive',
  iterate: 'wrapped',
  ask: 'wrapped'
};

const MUTATORS = /openGuarded\(|browser\.open\(|activateTab\(|browser\.click\(|browser\.clickAt\(|browser\.hover\(|browser\.press\(|browser\.fill\(|browser\.type\(/;

/** Split the controller class into (methodName -> body) by top-level members. */
function methodBodies(source) {
  const out = {};
  const re = /^  (?:private |protected )?(?:async )?(?:get )?([A-Za-z_][A-Za-z0-9_]*)\s*[(<]/gm;
  const hits = [...source.matchAll(re)];
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : source.length;
    out[m[1]] = source.slice(m.index, end);
  });
  return out;
}

test('every method that mutates the tab either locks or is explicitly exempt', () => {
  const bodies = methodBodies(src);
  const offenders = [];
  for (const [name, body] of Object.entries(bodies)) {
    if (!MUTATORS.test(body)) continue;
    if (name in MUTATION_OK) continue;
    // A body that IS the implementation behind a wrapper is fine — the wrapper
    // holds the lock. Those are named _xxxBody by convention.
    if (/^_.*Body$/.test(name)) {
      const verb = name.replace(/^_/, '').replace(/Body$/, '');
      if (new RegExp(`_withExclusive\\('${verb}'`).test(src)) continue;
      offenders.push(`${name} (no _withExclusive('${verb}') wrapper)`);
      continue;
    }
    if (new RegExp(`_withExclusive\\('${name}'`).test(src)) continue;
    offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `these methods drive the tab without the lock and are not exempt: ${offenders.join(', ')}`
  );
});

test('status stays lock-free — it is documented as safe to call at any time', () => {
  const body = src.slice(src.indexOf('async session(opts:'), src.indexOf('async ensureReady()'));
  assert.match(body, /=== 'status'\) return this\._sessionBody/, "action='status' must bypass the lock");
  // …and it must be genuinely read-only, or bypassing the lock reopens a
  // navigation escape.
  const status = src.slice(src.indexOf('async getStatus()'), src.indexOf('private async detectAwaitingClarification'));
  assert.match(status, /_scrapeVisibleFiles/, 'getStatus must not call the navigating listFiles');
  assert.ok(!/openGuarded|this\.listFiles\(/.test(status), 'getStatus must not navigate');
});

test('the commit boundary begins at the first dispatch, not at actuate()s return', () => {
  const body = stripComments(raw.slice(raw.indexOf('const actuate = async'), raw.indexOf('--- RESOLVE')));
  assert.match(body, /dispatched: boolean/, 'actuate reports whether it issued a click');
  // Every click site must mark dispatched BEFORE issuing.
  const clicks = [...body.matchAll(/dispatched = true;\s*\n\s*(await )?(this\.browser\.click|const res)/g)];
  assert.ok(clicks.length >= 2, 'each dispatch path marks dispatched before clicking');
});

test('the settle uses the shared counter reducer rather than ad-hoc arithmetic', () => {
  // The arithmetic itself is unit-tested in files-switcher.settle.test.mjs;
  // this only proves the controller routes through it.
  // Slice by the comment landmarks in RAW source, then strip comments inside it.
  const body = stripComments(raw.slice(raw.indexOf('POSITIVE SETTLE'), raw.indexOf('POST-SUCCESS')));
  assert.match(body, /foldSettleRead\(/, 'every settle observation goes through the reducer');
  assert.match(body, /counters\.consecutive >= 2/, 'success needs two consecutive reads');
  assert.match(body, /counters\.presentStreak >= 2/, 'still-present needs two consecutive reads too');
  assert.ok(!/sawTargetPresent/.test(body), 'the single-read latch is gone');
});
