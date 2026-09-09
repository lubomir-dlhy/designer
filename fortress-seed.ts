// Auto-reseed for Fortress mode. Fortress runs as an ephemeral linux/amd64
// container that cannot decrypt the macOS profile, so the claude.ai session is
// carried in over loopback CDP: a source browser that CAN decrypt the profile
// (Chrome for Testing) hands over the *decrypted* cookie values, which Fortress
// re-encrypts with its own key. Nothing is written to disk; the plaintext values
// live only in memory for the duration of the move. You log in once (the source
// profile persists it); designer reseeds Fortress automatically after that.
import { cdpHttpUrl, cdpPort } from './cdp-port.ts';

interface Cookie {
  name: string;
  domain: string;
  [k: string]: unknown;
}

function isClaudeCookie(c: Cookie): boolean {
  return /claude\.(ai|com)$/.test(String(c.domain).replace(/^\./, ''));
}

async function browserWs(port: string): Promise<string> {
  const res = await fetch(cdpHttpUrl(port, '/json/version'), { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`CDP /json/version on :${port} returned ${res.status}`);
  const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!webSocketDebuggerUrl) throw new Error(`CDP on :${port} exposed no browser WebSocket`);
  const url = new URL(webSocketDebuggerUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('CDP returned a non-loopback WebSocket endpoint');
  }
  return webSocketDebuggerUrl;
}

class Cdp {
  private id = 0;
  private waiters = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e: MessageEvent) => {
      const m = JSON.parse(String(e.data));
      if (m.id && this.waiters.has(m.id)) {
        const w = this.waiters.get(m.id)!;
        this.waiters.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
  }
  static async open(port: string): Promise<Cdp> {
    const wsUrl = await browserWs(cdpPort(port));
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true });
      ws.addEventListener('error', () => rej(new Error(`could not open CDP WebSocket ${wsUrl}`)), { once: true });
    });
    return new Cdp(ws);
  }
  send<T = any>(method: string, params?: unknown, sessionId?: string): Promise<T> {
    const id = ++this.id;
    const msg: Record<string, unknown> = { id, method };
    if (params) msg.params = params;
    if (sessionId) msg.sessionId = sessionId;
    return new Promise<T>((res, rej) => {
      this.waiters.set(id, { res: res as (v: unknown) => void, rej });
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id);
          rej(new Error(`${method} timed out`));
        }
      }, 20000);
      this.ws.send(JSON.stringify(msg));
    });
  }
  close(): void {
    this.ws.close();
  }
}

// Open a fresh tab on claude.ai/design and return its target + session ids. The
// caller closes the target when done (closeTab) so we never leave orphan tabs
// behind — several of them would make agent-browser's --pin-tab ambiguous or
// bind a tab that then vanishes (tab_gone).
async function openDesignTab(c: Cdp): Promise<{ targetId: string; sessionId: string }> {
  const { targetId } = await c.send<{ targetId: string }>('Target.createTarget', { url: 'https://claude.ai/design' });
  const { sessionId } = await c.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  await c.send('Page.enable', {}, sessionId);
  await c.send('Network.enable', {}, sessionId);
  await c.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function closeTab(c: Cdp, targetId: string): Promise<void> {
  await c.send('Target.closeTarget', { targetId }).catch(() => {});
}

export interface ClaudeAuth {
  authed: boolean;
  org: string | null;
}

// Is the browser on `port` signed in to claude.ai? Asks the app's own API from a
// page on the claude.ai origin, so it reflects the real session, not just a cookie.
export async function checkClaudeAuth(port: string, settleMs = 4000): Promise<ClaudeAuth> {
  const c = await Cdp.open(port);
  try {
    const { targetId, sessionId } = await openDesignTab(c);
    try {
      await new Promise((r) => setTimeout(r, settleMs));
      const r = await c.send<{ result: { value: string } }>(
        'Runtime.evaluate',
        {
          expression: `(async()=>{try{const r=await fetch('/api/organizations',{headers:{accept:'application/json'},credentials:'include'});if(!r.ok)return JSON.stringify({status:r.status});const o=await r.json();return JSON.stringify({status:200,org:Array.isArray(o)&&o[0]?(o[0].name||o[0].uuid):null});}catch(e){return JSON.stringify({status:0});}})()`,
          returnByValue: true,
          awaitPromise: true
        },
        sessionId
      );
      const parsed = JSON.parse(r.result?.value ?? '{"status":0}') as { status: number; org?: string | null };
      return { authed: parsed.status === 200, org: parsed.org ?? null };
    } finally {
      await closeTab(c, targetId);
    }
  } finally {
    c.close();
  }
}

export interface SeedResult {
  moved: number;
  sourceSignedIn: boolean;
  authed: boolean;
  org: string | null;
}

// Move the claude.ai session from `fromPort` (a browser that can decrypt the
// profile) into `toPort` (Fortress), then confirm the destination is signed in.
export async function seedClaudeSession(fromPort: string, toPort: string): Promise<SeedResult> {
  const src = await Cdp.open(fromPort);
  let claude: Cookie[];
  try {
    const { targetId, sessionId } = await openDesignTab(src);
    try {
      await new Promise((r) => setTimeout(r, 6000));
      const { cookies } = await src.send<{ cookies: Cookie[] }>('Network.getAllCookies', {}, sessionId);
      claude = cookies.filter(isClaudeCookie);
    } finally {
      await closeTab(src, targetId);
    }
  } finally {
    src.close();
  }
  const sourceSignedIn = claude.some((c) => c.name === 'sessionKey');
  if (!claude.length) return { moved: 0, sourceSignedIn, authed: false, org: null };

  const dst = await Cdp.open(toPort);
  try {
    await dst.send('Storage.setCookies', { cookies: claude });
  } finally {
    dst.close();
  }
  const auth = await checkClaudeAuth(toPort);
  return { moved: claude.length, sourceSignedIn, authed: auth.authed, org: auth.org };
}
