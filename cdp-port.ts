export function cdpPort(value: string | null | undefined, fallback = '9222'): string {
  const raw = value || fallback;
  if (!/^\d{1,5}$/.test(raw)) throw new TypeError(`invalid CDP port: ${raw}`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`CDP port out of range: ${raw}`);
  }
  return String(port);
}

export function cdpHttpUrl(port: string, route: '/json/list' | '/json/version'): URL {
  return new URL(route, `http://127.0.0.1:${cdpPort(port)}`);
}

export function agentBrowserCdp(value: string | null | undefined): string {
  if (!value) return '';
  if (value === 'auto' || value === 'true' || value === '1') return value;
  return cdpPort(value);
}

export function assertLoopbackWebSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new TypeError('CDP returned a non-loopback WebSocket endpoint');
  }
  return url.href;
}
