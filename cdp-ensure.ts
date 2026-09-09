import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { defaultChromeBin, isAlternateChromeBinary, isChromeRunning, QUIT_CHROME_HINT } from './cross-platform.ts';
import { isCdpEnabled } from './cdp-env.ts';
import { assertLoopbackWebSocketUrl, cdpHttpUrl, cdpPort } from './cdp-port.ts';
import { designerHeadless, headlessChromeArgs } from './chrome-mode.ts';
import { stealthChromeArgs } from './stealth-mode.ts';
import { fortressDockerRunArgs, fortressEnabled, resolveDockerBin, FORTRESS_CONTAINER } from './fortress-mode.ts';
import { checkClaudeAuth, seedClaudeSession } from './fortress-seed.ts';

const PORT = cdpPort(process.env.DESIGNER_CDP);
const PROFILE = path.join(os.homedir(), '.chrome-designer-profile');
const CHROME_BIN = process.env.CHROME_BIN || defaultChromeBin();
const ALTERNATE_CHROME = isAlternateChromeBinary(process.env.CHROME_BIN);
const HEADLESS = designerHeadless();

async function isCdpUp(): Promise<boolean> {
  try {
    const res = await fetch(cdpHttpUrl(PORT, '/json/version'), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

interface CdpVersion {
  'User-Agent'?: string;
  webSocketDebuggerUrl?: string;
}

export function isHeadlessBrowser(version: CdpVersion): boolean {
  return /HeadlessChrome/i.test(version['User-Agent'] ?? '');
}

export function isClaudeDesignUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://claude.ai' && /^\/design(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function launchChrome(headless: boolean, url = 'https://claude.ai/design'): void {
  const child = spawn(
    CHROME_BIN,
    [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      ...stealthChromeArgs(),
      ...headlessChromeArgs(headless),
      url
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

async function waitForCdp(up: boolean, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if ((await isCdpUp()) === up) return true;
    await sleep(500);
  }
  return false;
}

async function closeBrowser(webSocketUrl: string): Promise<void> {
  const socket = new WebSocket(assertLoopbackWebSocketUrl(webSocketUrl));
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('Timed out closing headless Chrome')), 5000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    socket.addEventListener('message', () => finish(), { once: true });
    socket.addEventListener('close', () => finish(), { once: true });
    socket.addEventListener('error', () => finish(new Error('Could not close headless Chrome')), { once: true });
  });
}

export async function relaunchVisibleForVerification(url: string): Promise<boolean> {
  if (!isClaudeDesignUrl(url)) return false;

  const response = await fetch(cdpHttpUrl(PORT, '/json/version'), { signal: AbortSignal.timeout(1500) });
  if (!response.ok) return false;
  const version = (await response.json()) as CdpVersion;
  if (!HEADLESS || !isHeadlessBrowser(version) || !version.webSocketDebuggerUrl) return false;

  await closeBrowser(version.webSocketDebuggerUrl);
  if (!(await waitForCdp(false, 20))) throw new Error('Headless Chrome did not stop');
  launchChrome(false, url);
  if (!(await waitForCdp(true))) throw new Error('Visible Chrome did not start');
  return true;
}

// Make sure a debug Chrome is listening on CDP before the first tool call.
// Auto-launch is gated on three conditions:
//   1. CDP is down (no existing debug server)
//   2. The dedicated profile exists (user already consented once via `designer setup`)
//   3. No non-debug Chrome is running, unless CHROME_BIN selects a genuinely
//      different executable such as Chrome for Testing or Canary.
// Otherwise: return an actionable error the caller can surface to the user.
// Fortress mode: drive the stealth Chromium container. It's the only headless
// browser that clears Cloudflare on claude.ai, but its container profile can't
// decrypt the macOS login, so we carry the session in once per container:
//   1. launch (if the CDP endpoint isn't already up),
//   2. if already signed in (kept from an earlier seed) -> done,
//   3. else read the login from the persistent source profile via a transient
//      Chrome for Testing and inject it (fortress-seed.ts), over loopback.
// You log in once (the source profile persists it); reseeds are automatic.
async function isCdpUpOn(port: string): Promise<boolean> {
  try {
    const res = await fetch(cdpHttpUrl(port, '/json/version'), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdpOn(port: string, up: boolean, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if ((await isCdpUpOn(port)) === up) return true;
    await sleep(500);
  }
  return false;
}

async function closeBrowserOn(port: string): Promise<void> {
  try {
    const res = await fetch(cdpHttpUrl(port, '/json/version'), { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const version = (await res.json()) as CdpVersion;
    if (version.webSocketDebuggerUrl) await closeBrowser(version.webSocketDebuggerUrl);
  } catch {
    // already gone
  }
}

// A free loopback port for the transient reseed source, derived from the Fortress
// port so it stays deterministic and off the container's published port.
function seedSourcePort(): string {
  const n = Number(PORT);
  return cdpPort(String(n < 65435 ? n + 100 : n - 100));
}

function launchSeedSource(port: string): void {
  const child = spawn(
    CHROME_BIN,
    [
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + PROFILE,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      ...stealthChromeArgs(),
      '--headless=new',
      'about:blank'
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

export async function ensureFortressUp(): Promise<void> {
  const docker = resolveDockerBin();
  if (!docker) {
    throw new Error('DESIGNER_BROWSER=fortress but Docker was not found. Install Docker Desktop, or set DOCKER_BIN.');
  }
  if (!(await isCdpUp())) {
    spawn(docker, fortressDockerRunArgs({ port: PORT }), { detached: true, stdio: 'ignore' }).unref();
    if (!(await waitForCdp(true, 120))) {
      throw new Error(`Launched Fortress but CDP didn't come up on :${PORT} within 60s. Check: docker logs ${FORTRESS_CONTAINER}`);
    }
  }
  if ((await checkClaudeAuth(PORT)).authed) return;

  // Not signed in yet — carry the login in from the persistent source profile.
  if (!fs.existsSync(PROFILE)) {
    throw new Error(`Fortress is not signed in and no source profile at ${PROFILE}. Log in once: designer setup`);
  }
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(`Fortress needs a source browser to read the login, but CHROME_BIN not found at ${CHROME_BIN}.`);
  }
  const src = seedSourcePort();
  if (await isCdpUpOn(src)) {
    throw new Error(`Fortress reseed needs the free port :${src} for the source browser, but it is busy.`);
  }
  launchSeedSource(src);
  try {
    if (!(await waitForCdpOn(src, true))) {
      throw new Error(`Source browser for the Fortress reseed did not start on :${src}.`);
    }
    const r = await seedClaudeSession(src, PORT);
    if (!r.authed) {
      throw new Error(
        r.sourceSignedIn
          ? `Fortress reseed moved ${r.moved} cookies but claude.ai still rejected the session. Retry, or re-login: designer setup.`
          : `The source profile at ${PROFILE} is not signed in to claude.ai. Log in once: designer setup.`
      );
    }
  } finally {
    await closeBrowserOn(src);
  }
}

export async function ensureCdpUp(): Promise<void> {
  // Respect the explicit opt-out (DESIGNER_CDP=''): never probe or auto-launch
  // the debug Chrome for a user who chose the agent-browser session-managed flow.
  // Throwing here makes any stray CdpSession.attach() degrade to null cleanly.
  if (!isCdpEnabled()) {
    throw new Error("CDP explicitly disabled (DESIGNER_CDP=''); using the agent-browser session-managed flow.");
  }
  if (fortressEnabled()) return ensureFortressUp();
  if (await isCdpUp()) return;

  if (!fs.existsSync(PROFILE)) {
    throw new Error(
      `CDP not up on :${PORT} and no dedicated Chrome profile at ${PROFILE}. Run: designer setup`
    );
  }

  if (isChromeRunning() && !ALTERNATE_CHROME) {
    throw new Error(
      `CDP not up on :${PORT} and a non-debug Chrome is already running. ${QUIT_CHROME_HINT} Then retry, or run: designer setup`
    );
  }

  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(
      `CDP not up on :${PORT} and Chrome not found at ${CHROME_BIN}. Set CHROME_BIN or install Chrome.`
    );
  }

  launchChrome(HEADLESS);
  if (await waitForCdp(true)) return;
  throw new Error(
    `Auto-launched ${HEADLESS ? 'headless ' : ''}Chrome but CDP didn't come up on :${PORT} within 20s. Check the browser process, or run designer setup.`
  );
}
