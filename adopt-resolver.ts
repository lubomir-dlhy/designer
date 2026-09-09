import type { StoredSession } from './session-store.ts';

export const SESSION_URL_RE = /^https:\/\/claude\.ai\/design\/p\/([a-f0-9-]+)/i;

type Candidate = { url: string };

export function projectRoot(url: string | null | undefined): string | null {
  const id = url?.match(SESSION_URL_RE)?.[1];
  return id ? `https://claude.ai/design/p/${id.toLowerCase()}` : null;
}

function keyTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 4);
}

export function resolveAdoptCandidate<T extends Candidate>(
  candidates: T[],
  key: string,
  requestedUrl: string | undefined,
  sessions: StoredSession[]
): T | null {
  const roots = new Set(candidates.map((candidate) => projectRoot(candidate.url)).filter(Boolean));
  if (roots.size === 1) return candidates[0] ?? null;

  const stored = sessions.find((session) => session.key === key);
  const wanted = projectRoot(requestedUrl) ?? projectRoot(stored?.designUrl);
  if (wanted) return candidates.find((candidate) => projectRoot(candidate.url) === wanted) ?? null;

  const tokens = keyTokens(key);
  if (tokens.length === 0) return null;

  const matches = candidates.filter((candidate) =>
    sessions.some(
      (session) =>
        projectRoot(session.designUrl) === projectRoot(candidate.url) &&
        tokens.every((token) => keyTokens(session.key).includes(token))
    )
  );
  const matchedRoots = new Set(matches.map((candidate) => projectRoot(candidate.url)));
  return matchedRoots.size === 1 ? (matches[0] ?? null) : null;
}
