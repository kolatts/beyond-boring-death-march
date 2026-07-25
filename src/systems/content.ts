/**
 * Typed loaders for /src/content/*.json.
 *
 * landmarks.json is a hard dependency (the content agent landed it in
 * Wave 1) and is statically imported — a missing file fails the build,
 * which is what we want.
 *
 * deaths.json may not exist yet (content agent, later wave), so it is
 * loaded through import.meta.glob, which resolves to an empty record when
 * the file is absent and never breaks the build.
 */

import rawLandmarks from '../content/landmarks.json';
import rawEvents from '../content/events.json';
import rawDeadlines from '../content/deadlines.json';
import rawNpcs from '../content/npcs.json';
import rawBB from '../content/boring-brilliant.json';
import type { DeadlineSource } from './state';

export interface Landmark {
  id: string;
  mile: number;
  name: string;
  mechanic: string;
  blurb: string;
}

/** The twelve landmarks (§6), sorted by mile. */
export const LANDMARKS: readonly Landmark[] = [...(rawLandmarks as Landmark[])].sort(
  (a, b) => a.mile - b.mile,
);

// ---------------------------------------------------------------------------
// events.json (§8.1) — consumed by systems/eventEngine.ts
// ---------------------------------------------------------------------------

export interface RangeReq {
  gt?: number;
  lt?: number;
}

/** Preconditions shared by events, choices, and deadline definitions.
 * Party member names use the CONTENT ids (e.g. `security_champion`);
 * eventEngine maps them onto state specializations. */
export interface Requires {
  milesTraveled?: RangeReq;
  day?: RangeReq;
  hasFlag?: string;
  notFlag?: string;
  partyMemberAlive?: string;
  partyMemberDead?: string;
  resource?: { name: 'tokens' | 'context' | 'trust' | 'greenBuilds' | 'morale' | 'credibility'; lt?: number; gt?: number };
}

export interface EventEffects {
  tokens?: number;
  context?: number;
  trust?: number;
  greenBuilds?: number;
  morale?: number;
  credibility?: number;
  days?: number;
  miles?: number;
  setFlag?: string;
  /** Content member id, or 'random' for a random non-player member. */
  loseMember?: string;
}

export interface EventChoice {
  id: string;
  label: string;
  requires?: Requires;
  effects: EventEffects;
  outcome?: string;
  /** Starts a registered minigame mechanic after the choice (CAB re-trigger). */
  startsMechanic?: string;
}

export interface TrailEvent {
  id: string;
  /** Weight 0 = NEVER drawn randomly; fired only by id (DECISIONS.md). */
  weight: number;
  requires?: Requires;
  title: string;
  body: string;
  effects: EventEffects;
  choices: EventChoice[];
}

export const EVENTS: readonly TrailEvent[] = rawEvents as TrailEvent[];

const eventsById = new Map(EVENTS.map((e) => [e.id, e]));

export function eventById(id: string): TrailEvent | undefined {
  return eventsById.get(id);
}

// ---------------------------------------------------------------------------
// deadlines.json — consumed by systems/deadlines.ts
// ---------------------------------------------------------------------------

export interface DeadlineDef {
  id: string;
  source: DeadlineSource;
  title: string;
  body: string;
  dueInDays: number;
  complyCost: { days: number; tokens: number };
  deferPenalty: { trust: number; credibility: number };
  /** Weight-0 event fired through the engine when the deadline expires. */
  escalationEventId: string;
  weight: number;
  requires: Requires;
}

export const DEADLINE_DEFS: readonly DeadlineDef[] = rawDeadlines as DeadlineDef[];

// ---------------------------------------------------------------------------
// npcs.json (§7.8) — consumed by LandmarkScene
// ---------------------------------------------------------------------------

export interface NpcOption {
  id: string;
  label: string;
  response: string;
  effects: EventEffects;
}

export interface Npc {
  id: string;
  landmarkId: string;
  name: string;
  intro: string;
  /** One true, one confidently wrong. Rendered UNMARKED, shuffled (§7.8). */
  advice: { correct: string; wrong: string };
  options: NpcOption[];
}

export const NPCS: readonly Npc[] = rawNpcs as Npc[];

export function npcForLandmark(landmarkId: string): Npc | undefined {
  return NPCS.find((n) => n.landmarkId === landmarkId);
}

// ---------------------------------------------------------------------------
// boring-brilliant.json (§9) — consumed by LandmarkScene + TrailScene
// ---------------------------------------------------------------------------

export interface BBExchange {
  landmarkId: string;
  boring: string;
  brilliant: string;
  /** Which advice is right HERE (BXXBBXXBBXBX across the trail). Marked in
   * data, never in prose (DECISIONS.md). */
  correct: 'boring' | 'brilliant';
  reaction: { boring: string; brilliant: string };
}

interface BBData {
  landmarks: BBExchange[];
  endgame: { boring: string; brilliant: string };
}

const bbData = rawBB as BBData;

export const BB_EXCHANGES: readonly BBExchange[] = bbData.landmarks;

export function bbForLandmark(landmarkId: string): BBExchange | undefined {
  return BB_EXCHANGES.find((x) => x.landmarkId === landmarkId);
}

// ---------------------------------------------------------------------------
// Campfire reaction rotation (playtest fix: dying early and restarting made
// the same Legacy Junction / Fort Prompt exchanges repeat verbatim run
// after run). boring-brilliant.json carries ONE reaction pair per landmark,
// so rotation works across the table: shown pairs are tracked per browser
// (localStorage), and a landmark whose pair was already heard swaps in an
// UNSHOWN landmark's pair as a fallback — existing prose only, no new
// lines in .ts. When every pair has been heard, the ledger resets.
// ---------------------------------------------------------------------------

const BB_SHOWN_KEY = 'bbdm:bbreactions';

function readShownReactions(): string[] {
  try {
    const raw = window.localStorage.getItem(BB_SHOWN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeShownReactions(ids: string[]): void {
  try {
    window.localStorage.setItem(BB_SHOWN_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: reactions may repeat. Non-fatal.
  }
}

/**
 * Pick the campfire reaction pair for a landmark, avoiding verbatim
 * repeats across runs. `roll` (seeded rand) picks among unshown fallbacks.
 * Marks the returned pair as shown.
 */
export function campfireReactionFor(landmarkId: string, roll: number): BBExchange | undefined {
  const own = bbForLandmark(landmarkId);
  if (!own) return undefined;

  let shown = readShownReactions();
  const unshown = BB_EXCHANGES.filter((x) => !shown.includes(x.landmarkId));

  // Everything has been heard: reset the ledger and start over with the
  // landmark's own pair.
  if (unshown.length === 0) {
    writeShownReactions([landmarkId]);
    return own;
  }

  let chosen: BBExchange;
  if (!shown.includes(landmarkId)) {
    chosen = own;
  } else {
    // Fallback: another landmark's not-yet-heard pair (existing prose).
    const idx = Math.min(unshown.length - 1, Math.max(0, Math.floor(roll * unshown.length)));
    chosen = unshown[idx] ?? own;
  }
  if (!shown.includes(chosen.landmarkId)) shown = [...shown, chosen.landmarkId];
  writeShownReactions(shown);
  return chosen;
}

// ---------------------------------------------------------------------------
// deaths.json (optional until the content wave lands it)
// ---------------------------------------------------------------------------

const deathModules = import.meta.glob('../content/deaths.json', { eager: true }) as Record<
  string,
  { default?: unknown }
>;

/** A deaths.json entry: id (stable key), cause (category), display text. */
interface DeathEntry {
  id: string;
  cause: string;
  text: string;
}

function extractDeathEntries(): DeathEntry[] {
  const entries: DeathEntry[] = [];
  for (const mod of Object.values(deathModules)) {
    const data = mod.default;
    if (!Array.isArray(data)) continue;
    for (const entry of data) {
      if (typeof entry === 'string') {
        entries.push({ id: '', cause: '', text: entry });
      } else if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        const text = o['text'] ?? o['line'] ?? o['title'];
        if (typeof text !== 'string') continue;
        entries.push({
          id: typeof o['id'] === 'string' ? o['id'] : '',
          cause: typeof o['cause'] === 'string' ? o['cause'] : '',
          text,
        });
      }
    }
  }
  return entries;
}

const deathEntries = extractDeathEntries();

function pick(roll: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(roll * length)));
}

/**
 * Resolve the tombstone's cause line. THE FAILURE MODES ARE THE
 * CURRICULUM: when the killing system passed a real cause, the tombstone
 * must show THAT cause — never a random draw.
 *
 * Resolution order for a non-empty cause:
 *  1. a deaths.json entry whose `id` matches the cause key exactly;
 *  2. an entry whose `text` matches the passed line exactly (already a
 *     content line — e.g. re-rendering a persisted tombstone);
 *  3. the generic starvation cause ('TOKEN EXHAUSTION') maps to a line
 *     drawn from the `cause: "tokens"` starvation pool;
 *  4. an entry whose text CONTAINS the cause phrase (Loop Builder passes
 *     "AN UNBOUNDED LOOP" etc., which the content lines embed verbatim);
 *  5. no content match: display the passed text itself.
 *
 * A random draw from the whole table happens ONLY when no cause was
 * provided at all.
 */
export function deathLineFor(cause: string | null | undefined, roll: number): string {
  const passed = (cause ?? '').trim();

  if (passed.length > 0) {
    const upper = passed.toUpperCase();

    const byId = deathEntries.find((e) => e.id.toUpperCase() === upper);
    if (byId) return byId.text;

    const byText = deathEntries.find((e) => e.text.toUpperCase() === upper);
    if (byText) return byText.text;

    if (upper === 'TOKEN EXHAUSTION') {
      const pool = deathEntries.filter((e) => e.cause === 'tokens');
      const drawn = pool[pick(roll, pool.length)];
      if (drawn) return drawn.text;
    }

    const byPhrase = deathEntries.find((e) => e.text.toUpperCase().includes(upper));
    if (byPhrase) return byPhrase.text;

    return upper.startsWith('YOU HAVE') ? passed : `YOU HAVE DIED OF ${upper}.`;
  }

  // No cause supplied: any line from the table (or the trail itself).
  const drawn = deathEntries[pick(roll, deathEntries.length)];
  return drawn ? drawn.text : 'YOU HAVE DIED OF THE TRAIL.';
}
