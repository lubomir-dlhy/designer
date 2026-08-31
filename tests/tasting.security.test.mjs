import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveTastingFile, tastingServerArgs } from '../tasting.ts';

test('the tasting preview launches with Bun', () => {
  assert.deepEqual(tastingServerArgs('/tmp/project', 8765).slice(1), ['--serve', '/tmp/project', '8765']);
});

test('the tasting server confines reads to the project directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'designer-tasting-'));
  const outside = path.join(path.dirname(root), 'designer-outside.txt');
  await fs.writeFile(path.join(root, 'index.html'), 'ok');
  await fs.writeFile(outside, 'secret');
  try {
    assert.equal(await resolveTastingFile(root, '/index.html'), await fs.realpath(path.join(root, 'index.html')));
    assert.equal(await resolveTastingFile(root, '/../designer-outside.txt'), null);

    const escapeLink = path.join(root, 'escape.txt');
    await fs.symlink(outside, escapeLink);
    assert.equal(await resolveTastingFile(root, '/escape.txt'), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});
