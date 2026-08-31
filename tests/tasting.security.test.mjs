import assert from 'node:assert/strict';
import test from 'node:test';
import { tastingServerArgs } from '../tasting.ts';

test('the tasting preview binds Python http.server to loopback only', () => {
  assert.deepEqual(tastingServerArgs(8765), [
    '-m',
    'http.server',
    '--bind',
    '127.0.0.1',
    '8765'
  ]);
});
