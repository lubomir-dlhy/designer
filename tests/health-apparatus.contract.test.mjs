import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveDoctorBin, probeVerdict, EXIT_CODE } from '../scripts/ci-health.ts';
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

// --- PR #131 review (Codex P2 x2) ---

// A home dir survives scrubbing only as the literal `<redacted>` token.
const LEAKED_MACOS = /\/Users\/(?!<redacted>)[^/\s]+/;
const LEAKED_LINUX = /\/home\/(?!<redacted>)[^/\s]+/;

test('the scrubber redacts home-dir paths in spawn errors', async () => {
  // Node embeds the absolute executable path in spawn errors. The health
  // artifact is world-downloadable for 30 days, and the same string also reaches
  // the run summary + a ::warning annotation, so the scrub happens at the source.
  //
  // Synthetic inputs on purpose: asserting against THIS checkout's real path
  // would make the test pass or fail on where the repo happens to live (it would
  // fail outright in a /workspace or Windows checkout), which is the
  // green-by-accident failure this whole PR is about.
  const { scrubForTest } = await import('../scripts/ci-health.ts');
  for (const raw of [
    'ENOENT: spawnSync /Users/alice/dev/designer/bin/designer ENOENT',
    'ENOENT: spawnSync /home/runner/work/designer/designer/bin/designer ENOENT'
  ]) {
    const scrubbed = scrubForTest(raw);
    assert.doesNotMatch(scrubbed, LEAKED_MACOS, `macOS username leaked from: ${raw}`);
    assert.doesNotMatch(scrubbed, LEAKED_LINUX, `Linux username leaked from: ${raw}`);
    assert.match(scrubbed, /ENOENT/, 'scrubbing must preserve the diagnostic');
  }
});

test('a real spawn failure is publishable — no unredacted home dir, whatever the checkout path', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(path.join(REPO_ROOT, 'bin', 'designer'), ['doctor']);
  assert.ok(r.error, 'expected ENOENT for the extensionless path');
  // No precondition on the raw message's shape — the invariant is about what
  // gets PUBLISHED, and it must hold from any checkout location.
  const { scrubForTest } = await import('../scripts/ci-health.ts');
  const published = scrubForTest(`${r.error.code}: ${r.error.message}`);
  assert.doesNotMatch(published, LEAKED_MACOS, 'macOS username leaked');
  assert.doesNotMatch(published, LEAKED_LINUX, 'Linux username leaked');
  assert.match(published, /ENOENT/, 'scrubbing must preserve the diagnostic');
});

test('every ProbeStatus is rendered distinctly by the CLI health reporter', () => {
  // Guards the enum-widening gap: `degraded` was added to ProbeStatus but the
  // `designer health` reporter still hardcoded ok/fail/skip, so counts did not
  // add up to results.length and degraded shared an icon with skip.
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'cli.ts'), 'utf8');
  for (const status of ['ok', 'degraded', 'fail', 'skip']) {
    assert.ok(
      cli.includes(`counts['${status}']`),
      `cli.ts health output does not account for the '${status}' status — totals will not add up`
    );
  }
  // Distinct glyphs: degraded must not collapse into the skip fallback.
  const icons = cli.match(/const icon = \(s: string\) => \(([^;]+)\);/);
  assert.ok(icons, 'icon renderer not found — update this test');
  assert.match(icons[1], /'degraded'/, "degraded has no glyph of its own");
});

// --- PR #131 review round 3: the probe needs a third outcome ---

test('a clean run with a working doctor is ok', () => {
  assert.equal(probeVerdict({ anchorFail: false, doctorSpawnError: null, doctorExitCode: 0 }), 'ok');
});

test('anchor regressions are drift — the selectors-drift-PR path', () => {
  assert.equal(probeVerdict({ anchorFail: true, doctorSpawnError: null, doctorExitCode: 0 }), 'drift');
});

test('a doctor that never launched is incomplete, NOT green and NOT drift', () => {
  // The bug this closes: exit 0 made `Close stale drift PRs on green` fire while
  // half the probe was broken, so a legitimate open drift PR could be
  // auto-closed. Exit 2 would have been just as wrong — it would file a tooling
  // fault as a claude.ai redesign.
  const v = probeVerdict({ anchorFail: false, doctorSpawnError: 'ENOENT: ...', doctorExitCode: -1 });
  assert.equal(v, 'incomplete');
  assert.notEqual(v, 'ok');
  assert.notEqual(v, 'drift');
});

test('a doctor that ran but reported a broken toolchain is incomplete', () => {
  assert.equal(probeVerdict({ anchorFail: false, doctorSpawnError: null, doctorExitCode: 2 }), 'incomplete');
});

test('anchor drift outranks a broken doctor — the actionable signal wins', () => {
  // Both broken: still file the drift PR. Drift is what a human can act on, and
  // the doctor fault is recorded in the artifact either way.
  assert.equal(probeVerdict({ anchorFail: true, doctorSpawnError: 'ENOENT: ...', doctorExitCode: -1 }), 'drift');
});

test('each verdict maps to a distinct exit code, and only ok is zero', () => {
  assert.equal(EXIT_CODE.ok, 0);
  assert.notEqual(EXIT_CODE.drift, 0);
  assert.notEqual(EXIT_CODE.incomplete, 0);
  assert.notEqual(EXIT_CODE.drift, EXIT_CODE.incomplete, 'drift and incomplete must be distinguishable');
  assert.equal(new Set(Object.values(EXIT_CODE)).size, 3);
});

test('the workflow gates on the verdict, never on the raw step outcome', () => {
  // `outcome` is only success/failure, so it cannot separate drift from a broken
  // probe — and the probe step runs with continue-on-error, so a bare outcome
  // check let an incomplete run pass as green.
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/daily-health.yml'), 'utf8');
  for (const v of ['ok', 'drift', 'incomplete']) {
    assert.ok(wf.includes(`steps.probe.outputs.verdict == '${v}'`), `no workflow step handles verdict '${v}'`);
  }
  // Scoped to `if:` CONDITIONS, not the whole file — naming `outcome` inside a
  // diagnostic message is fine; gating on it is what cannot happen, because
  // outcome collapses drift and a broken probe into one `failure`.
  const lines = wf.split('\n');
  const conditions = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)if:(.*)$/);
    if (!m) continue;
    let cond = m[2];
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next.trim()) break;
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent <= indent) break;
      cond += ' ' + next.trim();
    }
    conditions.push(cond);
  }
  assert.ok(conditions.length >= 3, 'expected at least the three verdict gates');
  for (const c of conditions) {
    assert.ok(!c.includes('steps.probe.outcome'), `a gate still keys on step outcome: ${c.trim().slice(0, 80)}`);
  }
});

// --- PR #131 review round 4: no exit path may skip the verdict ---

test('every process exit in ci-health goes through exitWith', () => {
  // The regression this closes: the CDP-unreachable path and the main().catch
  // handler exited without publishing a verdict. With `continue-on-error: true`
  // on the probe step, an unset verdict left all gates false and the job GREEN —
  // strictly worse than before, when a bare non-zero exit at least went red.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/ci-health.ts'), 'utf8');
  const bare = src
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.includes('process.exit('))
    // The single legitimate call is the one inside exitWith itself.
    .filter(({ n }) => {
      const fnStart = src.slice(0, src.indexOf('function exitWith')).split('\n').length;
      return !(n >= fnStart && n <= fnStart + 8);
    });
  assert.deepEqual(bare, [], `these exits bypass exitWith and would publish no verdict: ${JSON.stringify(bare)}`);
});

test('the workflow fails closed on an unrecognized or missing verdict', () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/daily-health.yml'), 'utf8');
  // A hard kill (OOM / runner timeout) writes no output at all, so the guard
  // cannot live in the script — the workflow must reject anything unknown.
  for (const v of ['ok', 'drift', 'incomplete']) {
    assert.ok(wf.includes(`steps.probe.outputs.verdict != '${v}'`), `backstop does not exclude the known verdict '${v}'`);
  }
});

test('CDP-unreachable is incomplete, never drift', () => {
  // A dead browser is an environment fault. It used to exit 2, which opened a
  // selectors-drift PR blaming claude.ai for a Chrome that would not start.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/ci-health.ts'), 'utf8');
  // Anchored on the FAIL log specifically — an earlier line logs the benign
  // "attempting relaunch" case with nearly the same wording.
  const at = src.indexOf('FAIL — CDP unreachable on');
  assert.notEqual(at, -1, 'CDP-unreachable failure log not found — update this test');
  const cdpBlock = src.slice(at, at + 600);
  assert.match(cdpBlock, /exitWith\('incomplete'\)/, 'CDP-unreachable must resolve to incomplete');
});

test('the auto-heal workflow fails the job when triage reports structural blindness', () => {
  // ::error is an annotation; it does not change a step's outcome. Without an
  // explicit gate the workflow still concluded success in exactly the
  // blind-while-anchors-fail scenario this PR exists to surface.
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/auto-heal.yml'), 'utf8');
  assert.ok(
    wf.includes("steps.triage.outputs.reason == 'blind-unpatchable'"),
    'no workflow gate on the blind-unpatchable reason — auto-heal would stay green while blind'
  );
  const gateIdx = wf.indexOf("steps.triage.outputs.reason == 'blind-unpatchable'");
  assert.match(wf.slice(gateIdx, gateIdx + 500), /exit 1/, 'the blind gate must actually fail the job');
});

test('the blind reason string is emitted by triage exactly as the workflow expects', () => {
  // Guards the two halves drifting apart: a renamed reason would silently make
  // the gate dead, restoring the green-while-blind behaviour.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/auto-heal.ts'), 'utf8');
  assert.match(src, /ghOutput\('reason', 'blind-unpatchable'\)/, 'triage no longer emits the reason the workflow gates on');
});

test('no health-apparatus script keeps its own hardcoded readiness selector', () => {
  // There were two stale copies of these gates — ci-health.ts and auto-heal.ts —
  // and the home one pointed at `project-creator`, dead since a redesign. Both
  // burned the full timeout waiting for an element that could never appear and
  // then proceeded with no readiness guarantee.
  for (const f of ['scripts/ci-health.ts', 'scripts/auto-heal.ts']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    const decls = src.match(/^const (?:HOME|SESSION)_READY_SEL = .*$/gm) || [];
    assert.ok(decls.length > 0, `${f}: readiness selectors not found — update this test`);
    for (const d of decls) {
      assert.ok(/= SEL\./.test(d), `${f} hardcodes a readiness selector instead of reading selectors.json: ${d}`);
    }
  }
});
