import assert from 'node:assert/strict';
import test from 'node:test';
import { agentBrowserCdp, assertLoopbackWebSocketUrl, cdpHttpUrl, cdpPort } from '../cdp-port.ts';

test('CDP ports are canonical integers in the TCP port range', () => {
  assert.equal(cdpPort(undefined), '9222');
  assert.equal(cdpPort('09333'), '9333');
  for (const value of ['0', '65536', '-1', '80@evil.example', '9222/path', 'auto']) {
    assert.throws(() => cdpPort(value));
  }
});

test('CDP HTTP URLs cannot escape the loopback origin', () => {
  assert.equal(cdpHttpUrl('9333', '/json/list').href, 'http://127.0.0.1:9333/json/list');
});

test('agent-browser retains explicit auto-connect modes but validates ports', () => {
  assert.equal(agentBrowserCdp(''), '');
  assert.equal(agentBrowserCdp('auto'), 'auto');
  assert.equal(agentBrowserCdp('9333'), '9333');
  assert.throws(() => agentBrowserCdp('9333@evil.example'));
});

test('CDP WebSocket targets must stay on loopback', () => {
  assert.equal(assertLoopbackWebSocketUrl('ws://localhost:9333/devtools/page/1'), 'ws://localhost:9333/devtools/page/1');
  assert.throws(() => assertLoopbackWebSocketUrl('wss://localhost:9333/devtools/page/1'));
  assert.throws(() => assertLoopbackWebSocketUrl('ws://evil.example/devtools/page/1'));
});
