import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_AGENT_BROWSER_VERSION, REQUIRED_BUN_VERSION } from '../runtime-versions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

test('all direct package dependencies use exact versions', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg[group] ?? {})) {
      assert.match(version, exactVersion, `${group}.${name} must be exact, got ${version}`);
    }
  }
  assert.equal(pkg.packageManager, `bun@${REQUIRED_BUN_VERSION}`);
  assert.equal(pkg.engines?.bun, REQUIRED_BUN_VERSION);
});

test('Bun resolution denies scripts, saves exact pins, and enforces a cooldown', async () => {
  const config = await read('bunfig.toml');
  assert.match(config, /^exact = true$/m);
  assert.match(config, /^ignoreScripts = true$/m);
  const cooldown = Number(config.match(/^minimumReleaseAge = (\d+)$/m)?.[1] ?? 0);
  assert.ok(cooldown >= 604800, `minimumReleaseAge must be at least seven days, got ${cooldown}`);
});

test('GitHub Actions are immutable and hosted runners are versioned', async () => {
  const dir = path.join(root, '.github', 'workflows');
  for (const name of await readdir(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const source = await read(path.join('.github', 'workflows', name));
    assert.doesNotMatch(source, /runs-on:\s*ubuntu-latest/, `${name} uses a mutable hosted runner label`);
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)) {
      assert.match(match[2], /^[a-f0-9]{40}$/, `${name}: ${match[1]} must use a full commit SHA`);
    }
  }
});

test('dependency changes require human review and PR dependency scanning', async () => {
  assert.equal(existsSync(path.join(root, '.github/workflows/dependabot-automerge.yml')), false);
  assert.equal(existsSync(path.join(root, '.github/workflows/lockfile-refresh.yml')), false);
  const dependabot = await read('.github/dependabot.yml');
  assert.doesNotMatch(dependabot, /^\s*groups:/m);
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, /actions\/dependency-review-action@[a-f0-9]{40}/);
});

test('documented external tooling and release tooling are exactly pinned', async () => {
  const readme = await read('README.md');
  assert.doesNotMatch(readme, /@latest|chrome@stable|bun add --global agent-browser(?:\s|`)/);
  assert.match(readme, new RegExp(`agent-browser@${REQUIRED_AGENT_BROWSER_VERSION.replaceAll('.', '\\.')}`));
  assert.match(readme, /@puppeteer\/browsers@\d+\.\d+\.\d+ install chrome@\d+\.\d+\.\d+\.\d+/);

  const release = await read('.github/workflows/release-please.yml');
  assert.match(release, /node-version: '22\.14\.0'/);
  assert.match(release, /npm install -g npm@11\.5\.1/);
  assert.doesNotMatch(release, /npm@\^|npm@~|npm@latest/);

  const smoke = await read('scripts/install-smoke.sh');
  assert.match(smoke, /oven\/bun:1\.4\.0@sha256:[a-f0-9]{64}/);
});
