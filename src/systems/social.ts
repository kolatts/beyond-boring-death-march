/**
 * social — the graveyard client. The game is static; only the graveyard
 * has a server (docs/DECISIONS.md). Talks to the death feed and hall of
 * fame endpoints described in api/README.md.
 *
 * DESIGN RULES (do not bend them):
 *  - Nothing here may ever block or break gameplay. Every network call
 *    has a 3s timeout and swallows every failure into `null`/`false`.
 *  - GETs are cached once per page load (60s TTL) so each screen costs
 *    at most one request.
 *  - POSTs are fire-and-forget. A failed POST is queued in localStorage
 *    (`bbdm:social-outbox`) and retried opportunistically the next time
 *    any social call runs. Queue-and-forget: no retry loops, no timers.
 *
 * Dev note: the Function App's CORS allowlist covers the Pages origin and
 * localhost:5173 only, so in dev we go through Vite's `/api` proxy
 * (vite.config.ts) instead of calling the app cross-origin.
 */

import type { RoleId } from '../config';

export const API_BASE = import.meta.env.DEV
  ? '/api'
  : 'https://death-march-prod-functions.azurewebsites.net/api';

const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const OUTBOX_KEY = 'bbdm:social-outbox';
const OUTBOX_CAP = 10;

// ---------------------------------------------------------------------------
// Wire types (api/README.md)
// ---------------------------------------------------------------------------

export interface RemoteDeath {
  name: string;
  cause: string;
  mile: number;
  epitaph: string;
  role: string;
  days: number;
  timestamp: string;
}

export interface RemoteScore {
  name: string;
  score: number;
  role: string;
  days: number;
  miles: number;
  deadlinesMet: number;
  deadlinesMissed: number;
  businessDeadlineMet: boolean;
  timestamp: string;
}

export interface DeathSubmission {
  name: string;
  cause: string;
  mile: number;
  epitaph: string;
  role: string;
  days: number;
}

export interface ScoreSubmission {
  name: string;
  score: number;
  role: string;
  days: number;
  miles: number;
  deadlinesMet: number;
  deadlinesMissed: number;
  businessDeadlineMet: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** API role strings (short forms accepted by the server). */
export function roleApiName(role: RoleId): string {
  switch (role) {
    case 'vp':
      return 'VP';
    case 'contractor':
      return 'Contractor';
    default:
      return 'Staff Engineer';
  }
}

/**
 * Printable ASCII only (server rejects anything else), trimmed to a cap.
 * Common typography is transliterated before filtering (dashes, curly
 * quotes, ellipsis) so punctuation degrades instead of vanishing, and the
 * cap cuts at a word boundary — the feed never shows a mid-word chop.
 */
export function asciiClamp(s: string, max: number): string {
  const ascii = [...s
    .replace(/[—–―]/g, '--') // em/en/horizontal-bar dashes
    .replace(/[‘’‚′]/g, "'") // curly single quotes, prime
    .replace(/[“”„″]/g, '"') // curly double quotes, double prime
    .replace(/…/g, '...') // ellipsis
    .replace(/[  -​ 　]/g, ' ')] // exotic spaces
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 && c <= 0x7e;
    })
    .join('')
    .trim();
  if (ascii.length <= max) return ascii;
  const hard = ascii.slice(0, max);
  if (ascii.charAt(max) === ' ') return hard.trimEnd(); // cut fell exactly on a boundary
  // Mid-word cut: back up to the last space; a single unbroken word keeps the hard cut.
  const lastSpace = hard.lastIndexOf(' ');
  return (lastSpace > 0 ? hard.slice(0, lastSpace) : hard).trimEnd();
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // Offline, timeout, CORS, DNS, anything: the trail goes on.
  }
}

// ---------------------------------------------------------------------------
// GETs — cached once per screen
// ---------------------------------------------------------------------------

interface Cache<T> {
  at: number;
  data: T;
}

let deathsCache: Cache<RemoteDeath[]> | null = null;
let scoresCache: Cache<RemoteScore[]> | null = null;
let deathsInFlight: Promise<RemoteDeath[] | null> | null = null;
let scoresInFlight: Promise<RemoteScore[] | null> | null = null;

/** The 50 most recent deaths, newest first, or null when unreachable. */
export function fetchRecentDeaths(): Promise<RemoteDeath[] | null> {
  if (deathsCache && Date.now() - deathsCache.at < CACHE_TTL_MS) {
    return Promise.resolve(deathsCache.data);
  }
  if (deathsInFlight) return deathsInFlight;
  void flushOutbox();
  deathsInFlight = request<RemoteDeath[]>('/deaths').then((data) => {
    deathsInFlight = null;
    if (Array.isArray(data)) {
      const clean = data.filter(
        (d) => typeof d?.name === 'string' && typeof d?.mile === 'number',
      );
      deathsCache = { at: Date.now(), data: clean };
      return clean;
    }
    return null;
  });
  return deathsInFlight;
}

/** The top 100 scores, highest first, or null when unreachable. */
export function fetchTopScores(): Promise<RemoteScore[] | null> {
  if (scoresCache && Date.now() - scoresCache.at < CACHE_TTL_MS) {
    return Promise.resolve(scoresCache.data);
  }
  if (scoresInFlight) return scoresInFlight;
  void flushOutbox();
  scoresInFlight = request<RemoteScore[]>('/scores').then((data) => {
    scoresInFlight = null;
    if (Array.isArray(data)) {
      const clean = data.filter(
        (s) => typeof s?.name === 'string' && typeof s?.score === 'number',
      );
      scoresCache = { at: Date.now(), data: clean };
      return clean;
    }
    return null;
  });
  return scoresInFlight;
}

// ---------------------------------------------------------------------------
// POSTs — fire-and-forget with a localStorage outbox
// ---------------------------------------------------------------------------

interface OutboxEntry {
  path: '/deaths' | '/scores';
  body: DeathSubmission | ScoreSubmission;
}

function readOutbox(): OutboxEntry[] {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-OUTBOX_CAP)));
  } catch {
    // Storage blocked: the grave goes unrecorded. The trail goes on.
  }
}

async function post(path: '/deaths' | '/scores', body: DeathSubmission | ScoreSubmission): Promise<boolean> {
  const result = await request<unknown>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return result !== null;
}

/** Retry anything queued from earlier failures. Fire-and-forget. */
export async function flushOutbox(): Promise<void> {
  const entries = readOutbox();
  if (entries.length === 0) return;
  writeOutbox([]); // Take the batch; re-queue only what fails again.
  const stillFailing: OutboxEntry[] = [];
  for (const entry of entries) {
    const ok = await post(entry.path, entry.body);
    if (!ok) stillFailing.push(entry);
  }
  if (stillFailing.length > 0) writeOutbox([...readOutbox(), ...stillFailing]);
}

/**
 * POST a death. Resolves true only on a confirmed 2xx — callers show the
 * "recorded" line on true and stay silent otherwise. Failures are queued.
 */
export async function postDeath(death: DeathSubmission): Promise<boolean> {
  const body: DeathSubmission = {
    name: asciiClamp(death.name, 24) || 'Anonymous',
    cause: asciiClamp(death.cause, 90) || 'Died of the trail',
    mile: Math.max(0, Math.min(2000, Math.floor(death.mile))),
    epitaph: asciiClamp(death.epitaph, 120),
    role: death.role,
    days: Math.max(1, Math.floor(death.days)),
  };
  const ok = await post('/deaths', body);
  if (ok) {
    deathsCache = null; // The feed just changed; next screen refetches.
  } else {
    writeOutbox([...readOutbox(), { path: '/deaths', body }]);
  }
  return ok;
}

/** POST a score. Same contract as postDeath. */
export async function postScore(score: ScoreSubmission): Promise<boolean> {
  const body: ScoreSubmission = {
    name: asciiClamp(score.name, 24) || 'Anonymous',
    score: Math.max(0, Math.floor(score.score)),
    role: score.role,
    days: Math.max(1, Math.floor(score.days)),
    miles: Math.max(0, Math.min(2000, Math.floor(score.miles))),
    deadlinesMet: Math.max(0, Math.min(1000, Math.floor(score.deadlinesMet))),
    deadlinesMissed: Math.max(0, Math.min(1000, Math.floor(score.deadlinesMissed))),
    businessDeadlineMet: score.businessDeadlineMet,
  };
  const ok = await post('/scores', body);
  if (ok) {
    scoresCache = null;
  } else {
    writeOutbox([...readOutbox(), { path: '/scores', body }]);
  }
  return ok;
}
