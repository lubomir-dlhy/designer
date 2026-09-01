import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './repo-root.ts';

export interface SaveIterationInput {
  prompt: string;
  fidelity: string | null;
  html: string | null | undefined;
  screenshotPath: string | null | undefined;
  url: string | null | undefined;
  meta?: unknown;
}

export interface IterationRecord {
  at: string;
  key: string;
  prompt: string;
  fidelity: string | null;
  url: string | null | undefined;
  meta: unknown;
  files: { html?: string; screenshot?: string };
}

const ARTIFACTS_ROOT = process.env.DESIGNER_ARTIFACTS_DIR || path.join(REPO_ROOT, 'artifacts');
const MAX_HTML_ARTIFACT_BYTES = 10 * 1024 * 1024;

function slug(s: string | null | undefined): string {
  return String(s || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'session';
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function sessionDir(key: string): string {
  const dir = path.join(ARTIFACTS_ROOT, slug(key));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveIteration(key: string, input: SaveIterationInput): IterationRecord {
  const dir = sessionDir(key);
  const stamp = ts();
  const base = path.join(dir, stamp);
  const record: IterationRecord = {
    at: new Date().toISOString(),
    key,
    prompt: input.prompt,
    fidelity: input.fidelity,
    url: input.url,
    meta: input.meta ?? null,
    files: {}
  };
  if (input.html) {
    const htmlBytes = Buffer.byteLength(input.html, 'utf8');
    if (htmlBytes > MAX_HTML_ARTIFACT_BYTES) {
      throw new Error(`refusing HTML artifact larger than ${MAX_HTML_ARTIFACT_BYTES} bytes`);
    }
    const p = `${base}.html`;
    fs.writeFileSync(p, input.html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    record.files.html = p;
  }
  if (input.screenshotPath) {
    record.files.screenshot = input.screenshotPath;
  }
  fs.writeFileSync(`${base}.json`, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return record;
}

export function artifactsRoot(): string {
  return ARTIFACTS_ROOT;
}
