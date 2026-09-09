import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cdpDriverSessionName } from '../browser.ts';
import { resolveAdoptCandidate } from '../adopt-resolver.ts';
import { REPO_ROOT } from '../repo-root.ts';

test('two Designer keys on one CDP endpoint receive different driver sessions', () => {
  const a = cdpDriverSessionName('9333', 'designer-project-a');
  const b = cdpDriverSessionName('9333', 'designer-project-b');
  assert.notEqual(a, b);
  assert.equal(a, cdpDriverSessionName('9333', 'designer-project-a'), 'binding is stable across calls');
});

test('normalized key collisions remain isolated', () => {
  assert.notEqual(
    cdpDriverSessionName('9333', 'designer-a/b'),
    cdpDriverSessionName('9333', 'designer-a_b')
  );
});

test('CDP sessions use strict tab pinning and resume prefers an existing target', () => {
  const browser = fs.readFileSync(path.join(REPO_ROOT, 'browser.ts'), 'utf8');
  const controller = fs.readFileSync(path.join(REPO_ROOT, 'designer-controller.ts'), 'utf8');
  assert.match(browser, /\['--session', cdpSessionName as string, '--pin-tab'\]/);

  const start = controller.indexOf('private async _resumeSessionBody');
  const end = controller.indexOf('// Fill the composer', start);
  assert.ok(start >= 0 && end > start);
  const resume = controller.slice(start, end);
  assert.match(resume, /candidateTabs/);
  assert.match(resume, /if \(!existing\.active\) await this\.browser\.activateTab\(existing\.targetId \|\| existing\.index\)/);
  assert.match(resume, /else \{[\s\S]*newTab\(stored\.designUrl\)/);
  assert.doesNotMatch(resume, /openGuarded\(stored\.designUrl\)/);
});

test('already-bound targets are not reactivated and cannot steal OS focus', () => {
  const controller = fs.readFileSync(path.join(REPO_ROOT, 'designer-controller.ts'), 'utf8');
  assert.match(controller, /if \(top && !top\.active\) await this\.browser\.activateTab/);
  assert.match(controller, /if \(!cand\.active\) await this\.browser\.activateTab/);
  assert.match(controller, /if \(!recoveryTab\.active\) await this\.browser\.activateTab/);
  assert.match(controller, /if \(!existing\.active\) await this\.browser\.activateTab/);
});

test('adopt reuses a unique stored key alias without guessing by tab order', () => {
  const finance = { url: 'https://claude.ai/design/p/11111111-1111-1111-1111-111111111111', index: 0 };
  const arena = { url: 'https://claude.ai/design/p/22222222-2222-2222-2222-222222222222?file=Insights.dc.html', index: 1 };
  const sessions = [
    { key: 'finance-app', createdAt: '', history: [], name: 'MoneyMate Design', designUrl: finance.url },
    { key: 'arena-ui', createdAt: '', history: [], name: 'Arena UI Mockup Directions', designUrl: arena.url.split('?')[0] }
  ];
  assert.equal(resolveAdoptCandidate([finance, arena], 'arena', undefined, sessions), arena);
});

test('adopt accepts an exact project URL and refuses ambiguous aliases', () => {
  const a = { url: 'https://claude.ai/design/p/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?file=A.dc.html' };
  const b = { url: 'https://claude.ai/design/p/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
  const sessions = [
    { key: 'alpha-ui', createdAt: '', history: [], name: 'Shared Product', designUrl: a.url.split('?')[0] },
    { key: 'beta-ui', createdAt: '', history: [], name: 'Shared Product', designUrl: b.url }
  ];
  assert.equal(resolveAdoptCandidate([a, b], 'new-key', b.url, sessions), b);
  assert.equal(resolveAdoptCandidate([a, b], 'shared-product', undefined, sessions), null);
  assert.equal(resolveAdoptCandidate([a, b], 'new-key', 'https://example.com/not-a-project', sessions), null);
});

test('adopt treats query variants of one project as one identity', () => {
  const root = 'https://claude.ai/design/p/cccccccc-cccc-cccc-cccc-cccccccccccc';
  const first = { url: `${root}?file=First.dc.html` };
  const second = { url: `${root}?file=Second.dc.html` };
  assert.equal(resolveAdoptCandidate([first, second], 'new-key', undefined, []), first);
});
