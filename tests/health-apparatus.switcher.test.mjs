import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_ANCHORS } from '../ui-anchors.ts';
import { getSelectors } from '../selectors.ts';

const SEL = getSelectors();
const anchor = UI_ANCHORS.find((a) => a.id === 'session.filesSwitcher');

/** Minimal Browser stub: only what this anchor touches. */
const stub = ({ url = 'https://claude.ai/design/p/abc12345-1111-2222-3333-444455556666', present = [] } = {}) => ({
  url: async () => url,
  evalValue: async (expr) => {
    if (expr.includes('querySelector(') && expr.includes('!!')) {
      return present.some((p) => expr.includes(p));
    }
    return null;
  },
  hover: async () => '',
  click: async () => '',
  press: async () => '',
  isVisible: async () => false
});

test('the switcher anchor FAILS when its trigger is gone from a project page', async () => {
  // The selector is production-required: without it deleteFile cannot run.
  // Returning 'skip' here let exactly the drift this probe exists to catch stay
  // green — the anchor would report healthy while the feature was dead.
  const r = await anchor.check(stub({ present: [] }), '');
  assert.equal(r.ok, false, 'a missing trigger on a project page is drift, not an inconclusive probe');
  assert.match(r.detail, /files-switcher-trigger|cannot run/, 'the failure names the selector and the consequence');
});

test('the switcher anchor SKIPS when the page is not a project at all', async () => {
  const r = await anchor.check(stub({ url: 'https://claude.ai/design', present: [] }), '');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'skip', 'no project surface is genuinely inconclusive');
});
