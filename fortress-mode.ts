import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cdpPort } from './cdp-port.ts';
import { nodeSpawnSync } from './cross-platform.ts';

// Fortress mode drives tiliondev's stealth Chromium (github.com/tiliondev/fortress)
// instead of local Chrome. It's the only headless option that clears Cloudflare
// on claude.ai (a Windows persona with a corrected fingerprint, no HeadlessChrome
// tell). Fortress ships only as a linux/amd64 Docker image, so on macOS/Windows
// it runs under emulation; its container profile is ephemeral, so the login is
// carried in by auto-reseed (see fortress-seed.ts) rather than a mounted volume.

export const FORTRESS_IMAGE = process.env.DESIGNER_FORTRESS_IMAGE || 'tilion/fortress:latest';
export const FORTRESS_CONTAINER = process.env.DESIGNER_FORTRESS_CONTAINER || 'designer-fortress';

/** True when the caller asked designer to drive Fortress instead of local Chrome. */
export function fortressEnabled(value = process.env.DESIGNER_BROWSER): boolean {
  return (value ?? '').toLowerCase() === 'fortress';
}

// amd64-only image: on Apple Silicon pin the platform so Docker runs it emulated
// rather than failing on a missing arm64 manifest.
export function fortressPlatformArgs(arch = process.arch): string[] {
  return arch === 'x64' ? [] : ['--platform', 'linux/amd64'];
}

export interface FortressRunOptions {
  port?: string;
  image?: string;
  container?: string;
  arch?: NodeJS.Architecture;
}

// `docker run` argv for a detached, loopback-only Fortress. The image's entrypoint
// bridges 0.0.0.0:9222 -> its internal DevTools port, so we publish the host CDP
// port to the container's 9222. Loopback publish keeps the stealth browser off
// the network.
export function fortressDockerRunArgs({
  port = cdpPort(process.env.DESIGNER_CDP),
  image = FORTRESS_IMAGE,
  container = FORTRESS_CONTAINER,
  arch = process.arch
}: FortressRunOptions = {}): string[] {
  const safePort = cdpPort(port);
  return [
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    ...fortressPlatformArgs(arch),
    '-p',
    `127.0.0.1:${safePort}:9222`,
    image
  ];
}

/** `docker rm -f` argv to tear a running Fortress down. */
export function fortressDockerStopArgs(container = FORTRESS_CONTAINER): string[] {
  return ['rm', '-f', container];
}

// Candidate docker binaries in preference order: explicit DOCKER_BIN, `docker`
// on PATH, then the Docker Desktop shim under ~/.docker/bin (not always on a
// non-login shell's PATH).
export function dockerCandidates(): string[] {
  const explicit = process.env.DOCKER_BIN?.trim();
  return [explicit || 'docker', path.join(os.homedir(), '.docker', 'bin', 'docker')];
}

// First candidate that actually runs (`docker --version` exits 0), else null.
// Synchronous so callers can gate cleanly before spawning.
export function resolveDockerBin(): string | null {
  for (const bin of dockerCandidates()) {
    try {
      if (bin.includes(path.sep) && !fs.existsSync(bin)) continue;
      if (nodeSpawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0) return bin;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
