import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from this file's location until we find package.json. Bun executes
// the TypeScript sources in place, while resources such as selectors.json and
// skills/ live at the package root.
//
// `fileURLToPath` is required (not `new URL(...).pathname`) because on Windows
// the URL pathname is `/C:/Users/...` which `path.join` cannot handle.
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo-root: could not find package.json walking up from ' + fileURLToPath(import.meta.url));
}

export const REPO_ROOT: string = findRepoRoot();
