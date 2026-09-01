// Reviewed runtime/toolchain pins. Update these only in a dedicated dependency
// PR together with package.json, README instructions, CI, and verification.
export const REQUIRED_BUN_VERSION = '1.4.0';
export const REQUIRED_AGENT_BROWSER_VERSION = '0.35.2';

export function agentBrowserVersionSupported(output: string): boolean {
  const detected = output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0];
  return detected === REQUIRED_AGENT_BROWSER_VERSION;
}
