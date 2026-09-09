import test from 'node:test';
import assert from 'node:assert/strict';
import { fortressEnabled, fortressPlatformArgs, fortressDockerRunArgs, fortressDockerStopArgs } from '../fortress-mode.ts';

test('fortress mode is opt-in via DESIGNER_BROWSER=fortress', () => {
  for (const v of [undefined, '', 'chrome', 'Fortres']) assert.equal(fortressEnabled(v), false);
  for (const v of ['fortress', 'Fortress', 'FORTRESS']) assert.equal(fortressEnabled(v), true);
});

test('platform is pinned to amd64 off x64 hosts only', () => {
  assert.deepEqual(fortressPlatformArgs('x64'), []);
  assert.deepEqual(fortressPlatformArgs('arm64'), ['--platform', 'linux/amd64']);
});

test('docker run args publish the CDP port to loopback and run detached', () => {
  const args = fortressDockerRunArgs({ port: '9222', image: 'tilion/fortress:latest', container: 'designer-fortress', arch: 'arm64' });
  assert.ok(args.includes('-d') && args.includes('--rm'));
  assert.deepEqual(args.slice(0, 5), ['run', '-d', '--rm', '--name', 'designer-fortress']);
  assert.ok(args.includes('127.0.0.1:9222:9222'));
  assert.ok(args.includes('--platform') && args.includes('linux/amd64'));
  assert.ok(args.includes('--shm-size=2g'));
  // image, then chrome args passed through the entrypoint
  const img = args.indexOf('tilion/fortress:latest');
  assert.ok(img >= 0 && args.slice(img + 1).some((a) => a.startsWith('--window-size=')));
});

test('docker run args reject an invalid port', () => {
  assert.throws(() => fortressDockerRunArgs({ port: 'not-a-port' }), /invalid CDP port/);
});

test('stop args force-remove the named container', () => {
  assert.deepEqual(fortressDockerStopArgs('designer-fortress'), ['rm', '-f', 'designer-fortress']);
});
