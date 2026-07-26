import type { Selectors } from './selectors.ts';

// The "Pages" files switcher — the surface `deleteFile` drives, the
// `session.filesSwitcher` health anchor probes, and the delete e2e exercises.
//
// ONE source for all three, for the reason file-panel.ts exists: production and
// the probe once drifted apart and the probe went green while production
// silently no-op'd (PR #77). Every expression below is a FUNCTION of the
// selectors block, not a frozen string, so selectors.json stays the live source
// and a drift repair there propagates here without a second edit.
//
// Captured live 2026-07-26 (CDP probe + destructive rehearsal on a throwaway
// project). Two facts drive the whole design:
//
//   1. Rows exist ONLY while the popover is open, so "no rows" is ambiguous
//      between "popover shut" and "project empty" — it can never be read as
//      proof that a delete succeeded (see the cardinality settle in
//      designer-controller.deleteFile).
//   2. The menu items and the confirm dialog's buttons carry NO testids. They
//      are located by exact text INSIDE the page, and the verified node is
//      stamped with a `data-designer-target` attribute so the caller's trusted
//      click lands on the very node the assertion just checked. Verify-here /
//      click-there is the failure mode that deletes the wrong file.
//
// Synthetic `element.click()` silently no-ops on some of these menus (probe
// finding), so nothing here clicks: expressions READ and STAMP, the facade's
// trusted input (browser.hover / browser.click) does every actuation.

/** Attribute the stamping expressions write; the caller clicks the stamped node. */
export const STAMP_ATTR = 'data-designer-target';
export const STAMP_MENU_DELETE = 'menu-delete';
export const STAMP_CONFIRM_DELETE = 'confirm-delete';
export const STAMP_CONFIRM_CANCEL = 'confirm-cancel';

/** CSS selector for a stamped node. */
export const stampedSelector = (value: string): string => `[${STAMP_ATTR}="${value}"]`;

/** View-invariant menu/dialog TEXT (not selectors — these elements have no testids). */
export const MENU_ITEM_DELETE = 'Delete';
export const MENU_ITEM_DOWNLOAD = 'Download';
export const DIALOG_BUTTON_CANCEL = 'Cancel';
export const DIALOG_BUTTON_DELETE = 'Delete';

export interface SwitcherRow {
  label: string;
  editedText: string | null;
}

/**
 * Open the Pages popover if it isn't already open, and report whether rows are
 * reachable. Idempotent by row-presence: a blind click would TOGGLE an open
 * popover shut (the file-panel.ts lesson), which during a settle poll would
 * read as "the file is gone".
 */
export function openSwitcherExpr(f: Selectors['files']): string {
  return `(() => {
    if (document.querySelectorAll(${JSON.stringify(f.switcherRow)}).length > 0) return 'already-open';
    const t = document.querySelector(${JSON.stringify(f.switcherTrigger)});
    if (!t) return 'no-trigger';
    t.click();
    return 'clicked';
  })()`;
}

/** Close the popover (best-effort restoration; never throws). */
export function closeSwitcherExpr(f: Selectors['files']): string {
  return `(() => {
    const t = document.querySelector(${JSON.stringify(f.switcherTrigger)});
    if (t && document.querySelectorAll(${JSON.stringify(f.switcherRow)}).length > 0) t.click();
    return document.querySelectorAll(${JSON.stringify(f.switcherRow)}).length;
  })()`;
}

/**
 * Read the rows as `{label, editedText}`. Row text is "<label>\n<Edited X ago>"
 * — the label carries NO extension, which is why the confirm dialog (the only
 * surface naming the full filename) is the deletion authority, not this list.
 */
export function readRowsExpr(f: Selectors['files']): string {
  return `(() => {
    return Array.from(document.querySelectorAll(${JSON.stringify(f.switcherRow)})).map((r) => {
      const raw = (r.innerText || '').trim();
      const lines = raw.split('\\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length > 1) return { label: lines[0], editedText: lines[1] };
      // Single-line fallback: strip a trailing "Edited … ago" off the blob.
      const m = raw.match(/^(.*?)\\s*(Edited\\s.+\\sago)$/i);
      return m ? { label: m[1].trim(), editedText: m[2] } : { label: raw, editedText: null };
    });
  })()`;
}

/** The nth row, for hovering a resolved match (rows are 0-indexed here). */
export function rowSelector(f: Selectors['files'], index: number): string {
  return `${f.switcherRow}:nth-of-type(${index + 1})`;
}

/**
 * Assert the row-actions menu is open and stamp its "Delete" item.
 * Requires EXACTLY one exact-text match inside an open [role="menu"] — an
 * unscoped text search can reach the project menu's "Delete project" (probe
 * finding), and a loose match would let a future item ("Delete all") through.
 */
export function stampMenuDeleteExpr(): string {
  return `(() => {
    document.querySelectorAll('[${STAMP_ATTR}="${STAMP_MENU_DELETE}"]').forEach((n) => n.removeAttribute('${STAMP_ATTR}'));
    const menus = Array.from(document.querySelectorAll('[role="menu"]'));
    if (menus.length === 0) return 'no-menu';
    const items = menus.flatMap((m) => Array.from(m.querySelectorAll('[role="menuitem"], button')));
    if (items.length === 0) return 'no-items';
    const hits = items.filter((e) => (e.textContent || '').trim() === ${JSON.stringify(MENU_ITEM_DELETE)});
    if (hits.length !== 1) return 'items:' + items.map((e) => (e.textContent || '').trim()).join('|');
    hits[0].setAttribute('${STAMP_ATTR}', '${STAMP_MENU_DELETE}');
    return 'stamped';
  })()`;
}

/**
 * Read the confirm dialog, verify its filename echo, and stamp the button the
 * caller should click. Returns the parsed dialog filename either way so a
 * mismatch can be reported with evidence.
 *
 * The stamp is what makes this safe: the node whose text was just verified is
 * the node that gets clicked. Positional CSS (`button:first-of-type`) would let
 * an added close button turn the REFUSAL path into a deletion.
 */
export function verifyConfirmDialogExpr(f: Selectors['files'], legacyDialog: string | undefined, fileName: string): string {
  const dialogSelectors = [f.confirmDialog, legacyDialog].filter(Boolean) as string[];
  return `(() => {
    const clear = () => document.querySelectorAll('[${STAMP_ATTR}="${STAMP_CONFIRM_DELETE}"], [${STAMP_ATTR}="${STAMP_CONFIRM_CANCEL}"]')
      .forEach((n) => n.removeAttribute('${STAMP_ATTR}'));
    clear();
    const sels = ${JSON.stringify(dialogSelectors)};
    let dialog = null;
    for (const s of sels) { const d = document.querySelector(s); if (d) { dialog = d; break; } }
    if (!dialog) return { found: false, dialogFile: null, matched: false, stamped: null };
    const text = (dialog.innerText || '').trim();
    // Anchored capture — NOT a substring test. \`text.includes(fileName)\` is
    // satisfied by a dialog naming "old-index.html" when the caller asked for
    // "index.html", i.e. it fails OPEN in the one direction that destroys data.
    const m = text.match(/Delete\\s+"([^"]+)"/);
    const dialogFile = m ? m[1] : null;
    const matched = dialogFile !== null && dialogFile === ${JSON.stringify(fileName)};
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const byText = (t) => buttons.filter((b) => (b.textContent || '').trim() === t);
    const wanted = matched ? ${JSON.stringify(DIALOG_BUTTON_DELETE)} : ${JSON.stringify(DIALOG_BUTTON_CANCEL)};
    const hits = byText(wanted);
    if (hits.length !== 1) {
      return { found: true, dialogFile, matched, stamped: null,
               buttons: buttons.map((b) => (b.textContent || '').trim()) };
    }
    const stamp = matched ? '${STAMP_CONFIRM_DELETE}' : '${STAMP_CONFIRM_CANCEL}';
    hits[0].setAttribute('${STAMP_ATTR}', stamp);
    return { found: true, dialogFile, matched, stamped: stamp };
  })()`;
}

/** Is any confirm dialog still on screen? (post-cancel assertion) */
export function dialogPresentExpr(f: Selectors['files'], legacyDialog: string | undefined): string {
  const sels = [f.confirmDialog, legacyDialog].filter(Boolean) as string[];
  return `(() => ${JSON.stringify(sels)}.some((s) => !!document.querySelector(s)))()`;
}

/** Remove every stamp this module writes (cleanup; never throws). */
export function clearStampsExpr(): string {
  return `(() => { document.querySelectorAll('[${STAMP_ATTR}]').forEach((n) => n.removeAttribute('${STAMP_ATTR}')); return true; })()`;
}

// --- pure matchers (the unit-testable seam) ---

/**
 * Filename → the label the switcher shows: the full extension chain is dropped
 * ("home.dc.html" → "home"). Only the LAST run of extensions is stripped, so a
 * dotted stem ("v1.2-notes.html") keeps its dots.
 */
export function displayLabelFor(filename: string): string {
  return filename.replace(/(\.[A-Za-z0-9]+)+$/, '') || filename;
}

/**
 * Comparison key tolerant of humanized labels: the product may render
 * "delete-test.html" as "Delete Test". Lowercase, separators → space, collapse.
 * The dialog echo stays STRICT — this normalization is for locating a row, never
 * for authorizing a deletion.
 */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Indices of rows whose label matches the filename. 0 = not found, 2+ = ambiguous. */
export function matchRows(rows: SwitcherRow[], filename: string): number[] {
  const want = normalizeLabel(displayLabelFor(filename));
  const exact: number[] = [];
  rows.forEach((r, i) => {
    const label = normalizeLabel(r.label);
    // Accept the label with or without an extension chain — some views render
    // the full filename in the row.
    if (label === want || normalizeLabel(displayLabelFor(r.label)) === want) exact.push(i);
  });
  return exact;
}

/**
 * Extract the filename the confirm dialog names. Requires exactly one quoted
 * token; anything else is null (fail closed).
 */
export function parseConfirmDialog(text: string): { dialogFile: string | null } {
  const all = [...text.matchAll(/Delete\s+"([^"]+)"/g)];
  return { dialogFile: all.length === 1 ? (all[0]?.[1] ?? null) : null };
}

/**
 * Does the dialog name EXACTLY this file? Strict equality on the parsed capture
 * — never containment, in either direction.
 */
export function dialogNamesFile(text: string, filename: string): boolean {
  const { dialogFile } = parseConfirmDialog(text);
  return dialogFile !== null && dialogFile === filename;
}
