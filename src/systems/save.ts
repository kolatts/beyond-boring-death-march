/**
 * Versioned localStorage persistence.
 *
 * Two independent stores:
 *  - The RUN save (one active run; cleared on death or completion).
 *  - The TOMBSTONES (append-only; survive new runs and render at their
 *    mile marker on later playthroughs — spec §8.3).
 *
 * Payloads carry a schema version; a mismatch is ignored (treated as no
 * save), never migrated. Bumping SCHEMA_VERSION intentionally orphans old
 * saves — cheap and safe while the shape is still moving.
 */

import type { GameState, Tombstone } from './state';

const RUN_KEY = 'bbdm:run';
const TOMB_KEY = 'bbdm:tombstones';
export const SCHEMA_VERSION = 1;

interface RunPayload {
  v: number;
  state: GameState;
}

interface TombPayload {
  v: number;
  tombstones: Tombstone[];
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the run simply doesn't persist. Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Run save
// ---------------------------------------------------------------------------

export function saveRun(state: GameState): void {
  write(RUN_KEY, { v: SCHEMA_VERSION, state } satisfies RunPayload);
}

export function loadRun(): GameState | null {
  const payload = read<RunPayload>(RUN_KEY);
  if (!payload || payload.v !== SCHEMA_VERSION) return null;
  const s = payload.state;
  // Minimal shape check — enough to reject garbage without a full schema.
  if (typeof s?.mile !== 'number' || typeof s?.day !== 'number' || !s.resources) return null;
  return s;
}

export function clearRun(): void {
  try {
    window.localStorage.removeItem(RUN_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------

export function loadTombstones(): Tombstone[] {
  const payload = read<TombPayload>(TOMB_KEY);
  if (!payload || payload.v !== SCHEMA_VERSION || !Array.isArray(payload.tombstones)) return [];
  return payload.tombstones.filter(
    (t) => typeof t?.mile === 'number' && typeof t?.epitaph === 'string',
  );
}

export function addTombstone(tombstone: Tombstone): void {
  const all = loadTombstones();
  all.push(tombstone);
  // Keep the graveyard bounded; the trail holds the most recent hundred.
  write(TOMB_KEY, { v: SCHEMA_VERSION, tombstones: all.slice(-100) } satisfies TombPayload);
}
