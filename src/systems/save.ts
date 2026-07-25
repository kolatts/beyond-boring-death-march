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
import type { RoleId } from '../config';
import { fetchRecentDeaths } from './social';

const RUN_KEY = 'bbdm:run';
const TOMB_KEY = 'bbdm:tombstones';
export const SCHEMA_VERSION = 1;

/** How many other parties' graves the trail will hold at once. */
const REMOTE_TOMB_CAP = 15;

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
  // Run-start hook: the first save of a page load kicks off the remote
  // graveyard sync (fire-and-forget; see syncRemoteTombstones).
  void syncRemoteTombstones();
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

// ---------------------------------------------------------------------------
// Remote tombstones — other players' graves on YOUR trail
// ---------------------------------------------------------------------------

/**
 * A grave imported from the global death feed. Shape-compatible with
 * Tombstone so the existing trail-side surfacing (economy.ts reads the
 * store) shows it at its mile without knowing it is remote. The `cause`
 * carries the dead party's name so the trail notice names them.
 */
export interface RemoteTombstone extends Tombstone {
  name: string;
  remote: true;
}

function isRemote(t: Tombstone): t is RemoteTombstone {
  return (t as Partial<RemoteTombstone>).remote === true;
}

const API_TO_ROLE: Record<string, RoleId> = {
  'VP': 'vp',
  'VP of Adjacent Concerns': 'vp',
  'Staff Engineer': 'staff',
  'Contractor': 'contractor',
  'Contractor, 6-Week Statement of Work': 'contractor',
};

let syncStarted = false;

/**
 * Fetch recent real-player deaths once per page load and fold them into
 * the tombstone store marked `remote: true`, so later runs pass other
 * parties' graves at their mile. Replaces the previous remote batch
 * (never appends), dedupes by name+mile, caps at REMOTE_TOMB_CAP.
 * Fire-and-forget; failures leave the store untouched.
 */
export async function syncRemoteTombstones(): Promise<void> {
  if (syncStarted) return;
  syncStarted = true;
  const deaths = await fetchRecentDeaths();
  if (!deaths || deaths.length === 0) return;

  // Dedupe remote entries against LOCAL graves too: your own death comes
  // back from the server and would otherwise render twice at the same
  // mile. Local graves match by name+mile (post-fix graves carry the
  // leader's name); older name-less local graves match by epitaph+mile.
  const locals = loadTombstones().filter((t) => !isRemote(t));
  const localKeys = new Set<string>();
  for (const t of locals) {
    if (t.name) localKeys.add(`n:${t.name.toLowerCase()}@${t.mile}`);
    localKeys.add(`e:${t.epitaph.toLowerCase()}@${t.mile}`);
  }

  const seen = new Set<string>();
  const remotes: RemoteTombstone[] = [];
  for (const d of deaths) {
    const key = `${d.name}@${d.mile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mile = Math.max(0, Math.min(2000, Math.floor(d.mile)));
    if (
      localKeys.has(`n:${d.name.toLowerCase()}@${mile}`) ||
      (d.epitaph && localKeys.has(`e:${d.epitaph.toLowerCase()}@${mile}`))
    )
      continue;
    remotes.push({
      mile,
      day: Math.max(1, Math.floor(d.days || 1)),
      cause: `${d.name} — ${d.cause}`,
      epitaph: d.epitaph || 'No epitaph was filed.',
      role: API_TO_ROLE[d.role] ?? 'staff',
      when: d.timestamp || new Date().toISOString(),
      name: d.name,
      remote: true,
    });
    if (remotes.length >= REMOTE_TOMB_CAP) break;
  }

  write(TOMB_KEY, {
    v: SCHEMA_VERSION,
    tombstones: [...locals, ...remotes].slice(-100),
  } satisfies TombPayload);
}

/** Local (this-browser) tombstone count, for screens that report "your" graves. */
export function localTombstoneCount(): number {
  return loadTombstones().filter((t) => !isRemote(t)).length;
}
