import test from 'node:test';
import assert from 'node:assert/strict';
import { foldSettleRead, classifySettleRead, shouldCloseSwitcher } from '../files-switcher.ts';

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

// --- mutation-killing properties (round 5 criterion) ---
// Each of these must FAIL if the corresponding mutation is applied, or the
// runtime must collapse to outcome-unknown. See tests/mutation-harness.mjs.

test('M1/M4: a REUSED subtree is never evidence, whatever it shows', () => {
  // Close/reopen reusing the same DOM, or a no-op close, both surface as
  // reused=true. Two such reads must not add up to a verdict.
  const gone = classifySettleRead(rows('b'), 'a.html', 2, 1, true, true);
  const present = classifySettleRead(rows('a', 'b'), 'a.html', 2, 1, true, true);
  assert.deepEqual(gone, { kind: 'inconclusive' }, 'a reused "gone" read proves nothing');
  assert.deepEqual(present, { kind: 'inconclusive' }, 'a reused "present" read proves nothing');
  // …and therefore cannot reach the success bar.
  assert.equal(run('inconclusive', 'inconclusive').consecutive, 0);
});

test('M1/M4: a FRESH subtree is evidence — the guard is not simply always-off', () => {
  assert.deepEqual(classifySettleRead(rows('b'), 'a.html', 2, 1, true, false), { kind: 'gone' });
});

test('M5: no settle input throws, however malformed', () => {
  const junk = [null, undefined, 0, '', 'rows', {}, [], [null], [{}], [{ label: null }], NaN, true];
  for (const rowsIn of junk) {
    for (const open of [true, false]) {
      for (const reused of [true, false]) {
        assert.doesNotThrow(
          () => classifySettleRead(rowsIn, 'a.html', 2, 1, open, reused),
          `classify threw on ${JSON.stringify(rowsIn)}`
        );
        const k = classifySettleRead(rowsIn, 'a.html', 2, 1, open, reused);
        assert.doesNotThrow(() => foldSettleRead({ consecutive: 0, presentStreak: 0 }, k));
      }
    }
  }
});

test('M5: an unknown kind never advances a counter toward a verdict', () => {
  for (const kind of ['GONE', 'Present', '', null, undefined, 42]) {
    const out = foldSettleRead({ consecutive: 1, presentStreak: 1 }, { kind });
    assert.deepEqual(out, { consecutive: 0, presentStreak: 0 }, `kind ${String(kind)} must reset`);
  }
});

test('P1: an empty list read WITHOUT a real remount is not an observation', () => {
  // closeSwitcher used to ignore 'open-empty', leaving the last file's popover
  // mounted across polls — so one mount supplied two apparently fresh 'gone'
  // reads and success needed no second look.
  assert.deepEqual(
    classifySettleRead([], 'only.html', 1, 1, true, false, /* remounted */ false),
    { kind: 'inconclusive' }
  );
  assert.deepEqual(
    classifySettleRead([], 'only.html', 1, 1, true, false, /* remounted */ true),
    { kind: 'gone' }
  );
});

test('P1: two non-remounted empty reads cannot reach the success bar', () => {
  let c = { consecutive: 0, presentStreak: 0 };
  for (let i = 0; i < 5; i++) {
    c = foldSettleRead(c, classifySettleRead([], 'only.html', 1, 1, true, false, false));
  }
  assert.equal(c.consecutive, 0, 'no amount of re-reading one mount proves a deletion');
});

test('every open-ish popover state must be closed before a re-read', () => {
  // 'open-empty' is open. Treating it as closed is what let one mounted empty
  // popover supply two "independent" observations.
  assert.equal(shouldCloseSwitcher('open'), true);
  assert.equal(shouldCloseSwitcher('open-empty'), true);
  assert.equal(shouldCloseSwitcher('closed'), false);
  assert.equal(shouldCloseSwitcher('unknown'), false);
  assert.equal(shouldCloseSwitcher('no-trigger'), false);
});

// --- stored-session hygiene (Codex PR #134 review) ---
// createSession persists the raw post-generation URL, which carries
// `?file=<name>`, and resumeSession opens it verbatim. So the delete flow must
// consider the STORED url's file param, not only the tab's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../repo-root.ts';

test('the session reset considers the STORED url, not only the live tab', () => {
  const src = readFileSync(join(REPO_ROOT, 'designer-controller.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /storedNamesDeleted/, 'the stored designUrl file param is part of the decision');
  assert.match(
    src,
    /if \(tabOnDeleted \|\| storedNamesDeleted\)/,
    'either a stale tab OR a stale stored url triggers the rewrite'
  );
  // …and a stale stored url alone must not drag the tab around.
  assert.match(src, /if \(tabOnDeleted\) \{/, 'navigation happens only when the TAB is the problem');
});

test('createSession stores a URL that can carry ?file=, which is why the above matters', () => {
  const src = readFileSync(join(REPO_ROOT, 'designer-controller.ts'), 'utf8');
  assert.match(src, /upsertSession\(this\.key, \{ designUrl: url, name, fidelity/, 'designUrl is the raw current URL');
  assert.match(src, /await this\.openGuarded\(stored\.designUrl\)/, 'resumeSession opens it verbatim');
});
