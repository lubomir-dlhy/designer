#!/usr/bin/env node
/**
 * Mutation harness — the check that the tests are proofs rather than surfaces.
 *
 * Every mutation below is a plausible way this code could regress. For each, we
 * apply it to a scratch copy of the repo and require the suite to FAIL. A
 * mutation the suite survives is a hole: the property it breaks is asserted
 * somewhere, but nothing verifies it.
 *
 *   node tests/mutation-harness.mjs
 *
 * Exit 0 = every mutation killed. Exit 1 = at least one survived (named).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each mutation: a file, a literal to find, and the replacement that breaks it.
const MUTATIONS = [
  {
    id: 'M1/M4 — reads of a reused subtree count as observations',
    file: 'files-switcher.ts',
    from: '  if (reusedMount) return { kind: \'inconclusive\' };',
    to: '  if (false && reusedMount) return { kind: \'inconclusive\' };'
  },
  {
    id: 'M1/M4 — the reader stops detecting subtree reuse',
    file: 'files-switcher.ts',
    from: "const reused = !!container && container.getAttribute('${STAMP_ATTR}') === '${STAMP_MOUNT}';",
    to: 'const reused = false;'
  },
  {
    id: 'M2 — an undeterminable popover is reported as closed',
    file: 'files-switcher.ts',
    from: "    return 'unknown';",
    to: "    return 'closed';"
  },
  {
    id: 'M5 — the settle reducer stops being total',
    file: 'files-switcher.ts',
    from: '      const _exhaustive: never = read;\n      void _exhaustive;\n      return { consecutive: 0, presentStreak: 0 };',
    to: '      return undefined as unknown as SettleCounters;'
  },
  {
    id: 'M5 — a malformed row element is no longer skipped',
    file: 'files-switcher.ts',
    from: '    if (!r || typeof r.label !== \'string\') return;',
    to: '    if (false) return;'
  },
  {
    id: 'M3 — a public tab-mutating method is added with no lock',
    file: 'designer-controller.ts',
    from: '  async currentUrl(): Promise<string> {',
    to: '  async goAnywhere(url: string): Promise<void> {\n    await this.browser.open(url);\n  }\n\n  async currentUrl(): Promise<string> {'
  },
  {
    id: 'settle — success no longer requires two consecutive reads',
    file: 'designer-controller.ts',
    from: 'if (counters.consecutive >= 2) break;',
    to: 'if (counters.consecutive >= 1) break;'
  },
  {
    id: 'settle — the popover is not remounted between reads',
    file: 'designer-controller.ts',
    from: '        await closeSwitcher();\n        const state = await openSwitcher();',
    to: '        const state = await openSwitcher();'
  },
  {
    id: 'lock — the compound snapshot stops locking',
    file: 'designer-controller.ts',
    from: "    return this._withExclusive('snapshotFile', async () => {",
    to: '    return (async () => {'
  },
  {
    id: 'echo — the dialog check uses containment again',
    file: 'files-switcher.ts',
    from: '    const dialogFile = all.length === 1 ? all[0][1] : null;',
    to: '    const dialogFile = all.length >= 1 ? all[0][1] : null;'
  }
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-mutation-'));
const survived = [];
let killed = 0;

for (const m of MUTATIONS) {
  const dir = path.join(work, m.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', REPO, dir], { stdio: 'pipe' });
  fs.cpSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });

  const target = path.join(dir, m.file);
  const src = fs.readFileSync(target, 'utf8');
  if (!src.includes(m.from)) {
    survived.push(`${m.id}  [ANCHOR MISSING — mutation could not be applied]`);
    continue;
  }
  fs.writeFileSync(target, src.replace(m.from, m.to));

  let failed = false;
  let detail = '';
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    failed = true;
    detail = 'typecheck';
  }
  if (!failed) {
    try {
      // The REAL gate, not a hand-picked subset. A curated list is how this
      // harness reported a mutation as surviving that a manual run killed: the
      // test file that caught it had been added after the list was written.
      // Same defect class this harness exists to find.
      execFileSync('npm', ['test'], { cwd: dir, stdio: 'pipe' });
    } catch (e) {
      failed = true;
      detail = 'gate';
    }
  }
  if (failed) {
    killed++;
    console.log(`KILLED   ${m.id}  (by ${detail})`);
  } else {
    survived.push(m.id);
    console.log(`SURVIVED ${m.id}   <-- the property is asserted but not verified`);
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${killed}/${MUTATIONS.length} mutations killed`);
if (survived.length) {
  console.log('\nSurvivors:');
  for (const s of survived) console.log(`  - ${s}`);
  process.exit(1);
}
