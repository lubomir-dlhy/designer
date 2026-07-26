import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displayLabelFor,
  normalizeLabel,
  matchRows,
  parseConfirmDialog,
  dialogNamesFile,
  readRowsExpr,
  switcherStateExpr,
  verifyConfirmDialogExpr,
  stampMenuDeleteExpr,
  rowSelector,
  stampRowExpr,
} from '../files-switcher.ts';
import { getSelectors } from '../selectors.ts';

const SEL = getSelectors();
const rows = (...labels) => labels.map((label) => ({ label, editedText: 'Edited 2m ago' }));

// --- displayLabelFor: switcher rows carry no extension ---

test('displayLabelFor strips the full extension chain', () => {
  assert.equal(displayLabelFor('index.html'), 'index');
  assert.equal(displayLabelFor('Canvas.dc.html'), 'Canvas');
  assert.equal(displayLabelFor('no-extension'), 'no-extension');
});

test('displayLabelFor keeps dots inside the stem', () => {
  assert.equal(displayLabelFor('v1.2-notes.html'), 'v1.2-notes');
});

// --- matchRows: resolution, ambiguity, and the prefix trap ---

test('matchRows finds the one row for a unique label', () => {
  assert.deepEqual(matchRows(rows('index', 'about'), 'index.html'), [0]);
});

test('matchRows reports BOTH indices when two files share a label (ambiguous → refuse)', () => {
  // Canvas.dc.html and Canvas.html both display as "Canvas".
  assert.deepEqual(matchRows(rows('Canvas', 'Canvas'), 'Canvas.html'), [0, 1]);
});

test('matchRows does not cross-match a label that is a prefix of another', () => {
  assert.deepEqual(matchRows(rows('index2'), 'index.html'), []);
  assert.deepEqual(matchRows(rows('index'), 'index2.html'), []);
});

test('matchRows tolerates a humanized label (hyphens rendered as words)', () => {
  assert.deepEqual(matchRows(rows('Delete Test'), 'delete-test.dc.html'), [0]);
});

test('matchRows also matches a row that renders the full filename', () => {
  assert.deepEqual(matchRows(rows('index.html'), 'index.html'), [0]);
});

test('matchRows returns empty for a file that is not listed', () => {
  assert.deepEqual(matchRows(rows('index', 'about'), 'missing.html'), []);
});

// --- parseConfirmDialog / dialogNamesFile: the deletion authority ---

test('dialogNamesFile accepts the exact echoed filename', () => {
  assert.equal(dialogNamesFile('Delete file?\nDelete "Canvas.dc.html"?\nCancel\nDelete', 'Canvas.dc.html'), true);
});

test('dialogNamesFile fails CLOSED when the dialog names a longer name containing the request', () => {
  // The fail-open direction that destroys data: `text.includes("index.html")`
  // is TRUE for a dialog naming "old-index.html".
  assert.equal(dialogNamesFile('Delete "old-index.html"?', 'index.html'), false);
});

test('dialogNamesFile fails when the request contains the dialog name (other direction)', () => {
  assert.equal(dialogNamesFile('Delete "index.html"?', 'old-index.html'), false);
});

test('dialogNamesFile fails when the filename is not quoted', () => {
  assert.equal(dialogNamesFile('Delete index.html?', 'index.html'), false);
});

test('parseConfirmDialog returns null when two quoted tokens are present (ambiguous → fail closed)', () => {
  assert.deepEqual(parseConfirmDialog('Delete "a.html"? Delete "b.html"?'), { dialogFile: null });
});

test('parseConfirmDialog exposes the dialog filename for mismatch evidence', () => {
  assert.deepEqual(parseConfirmDialog('Delete "other.html"?'), { dialogFile: 'other.html' });
});

test('normalizeLabel collapses separators and case', () => {
  assert.equal(normalizeLabel('Delete_Test  Page'), 'delete test page');
});

// --- expressions: parameterized by selectors.json, not frozen literals ---

test('expressions interpolate the live selectors (no hardcoded testids)', () => {
  // Selectors are embedded JSON-encoded (quotes escaped) so they survive as
  // string literals inside the evaluated page expression.
  const enc = (s) => JSON.stringify(s);
  const open = switcherStateExpr(SEL.files);
  assert.ok(open.includes(enc(SEL.files.switcherTrigger)), 'trigger selector must come from selectors.json');
  assert.ok(readRowsExpr(SEL.files).includes(enc(SEL.files.switcherRow)), 'row selector must come from selectors.json');
  // Rows are addressed by STAMP, never by index CSS: the popover interleaves
  // rows with other elements, so `[data-testid=…]:nth-of-type(1)` matches
  // nothing. The live e2e caught that as a silent 'menu-unavailable'.
  assert.ok(!/nth-of-type/.test(rowSelector()), 'row must not be addressed by nth-of-type');
  assert.ok(rowSelector().includes('data-designer-target'), 'row is addressed by the stamp');
  assert.ok(stampRowExpr(SEL.files, 2).includes('rows[2]'), 'stamp picks the nth MATCHING row');
  assert.ok(stampRowExpr(SEL.files, 2).includes(JSON.stringify(SEL.files.switcherRow)), 'row selector from selectors.json');
});

test('switcherStateExpr only READS state — the open is a trusted facade click', () => {
  const expr = switcherStateExpr(SEL.files);
  // Opening synthetically strands the row menu's `fixed inset-0` scrim above
  // the confirm dialog, so every later click (facade AND raw CDP) lands on the
  // scrim and the delete silently never happens (live e2e 2026-07-26).
  assert.ok(!/\.click\(\)/.test(expr), 'must not click — the caller uses trusted input');
  assert.match(expr, /'open'/);
  assert.match(expr, /'closed'/);
  assert.match(expr, /'no-trigger'/);
});

test('verifyConfirmDialogExpr stamps cancel on mismatch and delete on match', () => {
  const expr = verifyConfirmDialogExpr(SEL.files, SEL.filesLegacy?.confirmDialog, 'index.html');
  assert.ok(expr.includes('confirm-cancel'), 'must be able to stamp the cancel button');
  assert.ok(expr.includes('confirm-delete'), 'must be able to stamp the delete button');
  assert.ok(expr.includes('"index.html"'), 'the requested filename is compared inside the page');
  assert.ok(expr.includes(JSON.stringify(SEL.files.confirmDialog).slice(1, -1)), 'dialog selector from selectors.json');
  // The echo check must be strict equality on an anchored capture, never
  // containment — `text.includes(name)` fails OPEN on a longer filename.
  const code = expr.replace(/\/\/.*$/gm, '');
  assert.ok(/dialogFile === /.test(code), 'echo check must compare with strict equality');
  assert.ok(!/includes\(/.test(code), 'must not use substring containment for the echo check');
  assert.ok(/match\(\/Delete/.test(code), 'the dialog filename must be parsed with an anchored regex');
});

test('stampMenuDeleteExpr scopes to an open role=menu and demands a single exact hit', () => {
  const expr = stampMenuDeleteExpr();
  assert.ok(expr.includes('[role="menu"]'), 'unscoped text search can reach "Delete project"');
  assert.ok(expr.includes('hits.length !== 1'), 'exactly one exact-text match is required');
});
