import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveDoctorBin } from '../scripts/ci-health.ts';
import { findAnchor, canPatch } from '../scripts/anchor-patcher.ts';
import { classifyCandidates, isStructurallyBlind, patchableAnchorIds } from '../scripts/auto-heal.ts';
import { orderedBranches, presenceSelector } from '../selectors.ts';
import { UI_ANCHORS } from '../ui-anchors.ts';
import { REPO_ROOT } from '../repo-root.ts';

// Regression coverage for the 2026-07-25 audit: three layers of the health
// apparatus each reported success while asserting nothing.
//   * ci-health spawned `bin/designer`, which does not exist -> `designer doctor`
//     never ran for ~2 months and reported exitCode -1 forever (#130).
//   * auto-heal ran daily with conclusion "success" while unable to patch a
//     single anchor, because centralizing selectors into selectors.json removed
//     the inline string literals its AST patcher rewrites (#129 item 0).
// The through-line: "never ran" was indistinguishable from "healthy". These
// tests make each layer assert its own capability.

// --- #130: the doctor spawn path ---

test('resolveDoctorBin points at a file that actually exists', () => {
  const bin = resolveDoctorBin();
  assert.ok(fs.existsSync(bin), `resolved doctor bin does not exist: ${bin}`);
});

test('resolveDoctorBin is executable (spawnSync would otherwise EACCES)', () => {
  const bin = resolveDoctorBin();
  assert.doesNotThrow(() => fs.accessSync(bin, fs.constants.X_OK), `doctor bin is not executable: ${bin}`);
});

test('resolveDoctorBin tracks package.json bin, not a guessed filename', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const declared = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.designer;
  assert.equal(resolveDoctorBin(), path.join(REPO_ROOT, declared));
  // The exact bug: the old code joined 'bin', 'designer' and that path is absent.
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'bin', 'designer')), 'bin/designer exists — update this regression test');
});

test('importing ci-health does not run the probe (module must be side-effect free)', () => {
  // If the import at the top of this file had launched Chrome and driven
  // claude.ai, the suite would hang or mutate today's artifact. Reaching this
  // assertion at all is the check.
  assert.equal(typeof resolveDoctorBin, 'function');
});

// --- #129 item 0: auto-heal must know what it can and cannot patch ---

const ALWAYS = () => true;
const NEVER = () => false;

test('a candidate that cannot be patched is classified apart from one in cooldown', () => {
  // The 9-day bug in one assertion: the old triage logged both as "complex or
  // in cooldown" and skipped. One resolves itself; the other never will.
  const c = classifyCandidates(['stuck', 'waiting'], {
    canPatch: (id) => id !== 'stuck',
    inCooldown: (id) => id === 'waiting',
    isValidId: ALWAYS
  });
  assert.deepEqual(c.unpatchable, ['stuck']);
  assert.deepEqual(c.cooling, ['waiting']);
  assert.deepEqual(c.eligible, []);
});

test('isStructurallyBlind fires when work is queued and nothing is patchable', () => {
  const blind = classifyCandidates(['a', 'b'], { canPatch: NEVER, inCooldown: NEVER, isValidId: ALWAYS });
  assert.equal(isStructurallyBlind(blind), true, 'unpatchable backlog must be loud');
});

test('isStructurallyBlind does NOT fire for a pure cooldown wait', () => {
  // Cooldown is a healthy, self-resolving state — escalating it would train
  // everyone to ignore the alarm, which is how we got here.
  const cooling = classifyCandidates(['a'], { canPatch: ALWAYS, inCooldown: ALWAYS, isValidId: ALWAYS });
  assert.equal(isStructurallyBlind(cooling), false);
});

test('isStructurallyBlind does NOT fire when something is still healable', () => {
  const mixed = classifyCandidates(['ok', 'stuck'], {
    canPatch: (id) => id === 'ok',
    inCooldown: NEVER,
    isValidId: ALWAYS
  });
  assert.deepEqual(mixed.eligible, ['ok']);
  assert.equal(isStructurallyBlind(mixed), false);
});

test('an id failing shape validation is quarantined, never healed', () => {
  const c = classifyCandidates(['evil; rm -rf /'], { canPatch: ALWAYS, inCooldown: NEVER, isValidId: NEVER });
  assert.deepEqual(c.invalid, ['evil; rm -rf /']);
  assert.deepEqual(c.eligible, []);
});

test('patchableAnchorIds reports reality — today the real anchors are all unpatchable', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'ui-anchors.ts'), 'utf8');
  const ids = UI_ANCHORS.map((a) => a.id);
  const patchable = patchableAnchorIds(src, ids);
  // Every reported id must genuinely resolve — no claiming coverage it lacks.
  for (const id of patchable) {
    assert.ok(findAnchor(src, id), `${id} reported patchable but findAnchor returned null`);
  }
  // Documents the standing limitation this PR makes visible rather than hides:
  // anchors read selectors from selectors.json (SEL.*), which the literal-only
  // patcher cannot rewrite. If someone extends the patcher, this flips and the
  // assertion below should be updated deliberately, not by accident.
  assert.equal(
    patchable.length,
    0,
    `patcher now covers ${patchable.join(', ')} — auto-heal is no longer fully blind; update this test and #129 item 0.`
  );
});

test('findAnchor rejects a selector-key anchor rather than silently mispatching', () => {
  // `hasSelector(b, SEL.home.creator)` is a PropertyAccessExpression, not a
  // string literal. The patcher must return null (not guess), so auto-heal can
  // report blindness instead of pretending success.
  const src = `
    export const UI_ANCHORS = [
      { id: 'x.viaSelectorKey', category: 'home', description: 'd', requires: 'home',
        check: async (b) => ({ ok: await hasSelector(b, SEL.home.creator) }) },
      { id: 'x.viaLiteral', category: 'home', description: 'd', requires: 'home',
        check: async (b) => ({ ok: await hasSelector(b, '[data-testid="literal"]') }) }
    ];`;
  assert.equal(findAnchor(src, 'x.viaSelectorKey'), null, 'selector-key anchor must not be reported patchable');
  assert.equal(findAnchor(src, 'x.viaLiteral')?.currentSelector, '[data-testid="literal"]');
});

// --- #129 items 1+2: legacy branches must degrade, not mask ---

const anchor = (id) => {
  const a = UI_ANCHORS.find((x) => x.id === id);
  if (!a) throw new Error(`anchor not found: ${id}`);
  return a;
};
// The stub decides from the evaluated expression, so "which selector is present"
// is expressed as a predicate over the probe source.
const stubBrowser = (present) => ({ evalValue: async (expr) => present.some((s) => expr.includes(s)) });

test('canonical selector present => plain ok', async () => {
  const b = stubBrowser(['home-composer-send']);
  const r = await anchor('home.createButton').check(b, 'https://claude.ai/design');
  assert.equal(r.ok, true);
  assert.equal(r.status, undefined, 'canonical match must not be marked degraded');
});

test('canonical GONE but legacy present => degraded, not ok', async () => {
  // This is the whole point: the old comma-OR selector reported a clean `ok`
  // here, so the canonical selector could rot indefinitely without a signal.
  const b = stubBrowser(['Create']);
  const r = await anchor('home.createButton').check(b, 'https://claude.ai/design');
  assert.equal(r.ok, true, 'tool still works, so this must not fail the run');
  assert.equal(r.status, 'degraded');
  assert.match(r.detail, /canonical/i);
});

test('neither branch present => fail', async () => {
  const b = stubBrowser([]);
  const r = await anchor('home.createButton').check(b, 'https://claude.ai/design');
  assert.equal(r.ok, false);
});

test('projectsList degrades onto the bare project-link branch', async () => {
  const b = stubBrowser(['design/p/']);
  const r = await anchor('home.projectsList').check(b, 'https://claude.ai/design');
  assert.equal(r.status, 'degraded', 'a stray project link must not read as a healthy list container');
});

test('login.signedIn degrades on the weaker Create-button marker instead of claiming signed-out', async () => {
  const b = stubBrowser(['Create']);
  const r = await anchor('login.signedIn').check(b, 'https://claude.ai/design');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'degraded');
  assert.doesNotMatch(r.detail, /designer setup/, 'must never send the user to re-login on a marker rot');
});

// --- branch resolution helpers ---

test('orderedBranches keeps canonical first and drops a duplicate legacy', () => {
  assert.deepEqual(orderedBranches('#a', '#b'), ['#a', '#b']);
  assert.deepEqual(orderedBranches('#a', '#a'), ['#a'], 'identical legacy is not a second branch');
  assert.deepEqual(orderedBranches('#a', null), ['#a']);
});

test('presenceSelector joins branches for existence-only checks', () => {
  assert.equal(presenceSelector('#a', '#b'), '#a, #b');
  assert.equal(presenceSelector('#a', null), '#a');
});

test('no canonical selector smuggles a comma-OR legacy branch back in', () => {
  // Guards the regression directly: if someone re-packs a fallback into a
  // canonical selector, querySelector's document-order semantics silently
  // return again and the anchors stop degrading.
  const sel = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'selectors.json'), 'utf8'));
  for (const [key, value] of Object.entries(sel.home)) {
    assert.ok(!String(value).includes(','), `home.${key} packs multiple branches into one selector: ${value}`);
  }
});
