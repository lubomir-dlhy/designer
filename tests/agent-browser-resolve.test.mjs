import test from 'node:test';
import assert from 'node:assert/strict';
import { agentBrowserCandidates, resolveAgentBrowserBin, managedChromeForTesting, resolveChromeBin } from '../cross-platform.ts';

test('candidate locations are platform-appropriate absolute paths', () => {
  const mac = agentBrowserCandidates('/Users/x', 'darwin');
  assert.ok(mac.includes('/opt/homebrew/bin/agent-browser'));
  assert.ok(mac.includes('/Users/x/.bun/bin/agent-browser'));
  assert.ok(mac.every((p) => p.startsWith('/')));

  const lin = agentBrowserCandidates('/home/x', 'linux');
  assert.ok(lin.includes('/usr/local/bin/agent-browser'));
  assert.ok(lin.includes('/home/x/.bun/bin/agent-browser'));

  const win = agentBrowserCandidates('C:\\Users\\x', 'win32');
  assert.ok(win.some((p) => p.endsWith('agent-browser.cmd') || p.endsWith('agent-browser.exe')));
});

test('an explicit DESIGNER_AGENT_BROWSER_BIN override wins', () => {
  const prev = process.env.DESIGNER_AGENT_BROWSER_BIN;
  try {
    process.env.DESIGNER_AGENT_BROWSER_BIN = '/custom/path/to/agent-browser';
    assert.equal(resolveAgentBrowserBin(), '/custom/path/to/agent-browser');
  } finally {
    if (prev === undefined) delete process.env.DESIGNER_AGENT_BROWSER_BIN;
    else process.env.DESIGNER_AGENT_BROWSER_BIN = prev;
  }
});

test('resolution always yields a non-empty command', () => {
  const prev = process.env.DESIGNER_AGENT_BROWSER_BIN;
  try {
    delete process.env.DESIGNER_AGENT_BROWSER_BIN;
    const bin = resolveAgentBrowserBin();
    assert.equal(typeof bin, 'string');
    assert.ok(bin.length > 0);
  } finally {
    if (prev !== undefined) process.env.DESIGNER_AGENT_BROWSER_BIN = prev;
  }
});

test('managedChromeForTesting returns null when the cache dir is absent', () => {
  assert.equal(managedChromeForTesting('/no/such/designer-cft/dir'), null);
});

test('resolveChromeBin honors an explicit CHROME_BIN override', () => {
  const prev = process.env.CHROME_BIN;
  try {
    process.env.CHROME_BIN = '/custom/Google Chrome for Testing';
    assert.equal(resolveChromeBin(), '/custom/Google Chrome for Testing');
  } finally {
    if (prev === undefined) delete process.env.CHROME_BIN;
    else process.env.CHROME_BIN = prev;
  }
});
