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
// deaths.json (optional until the content wave lands it)
// ---------------------------------------------------------------------------

const deathModules = import.meta.glob('../content/deaths.json', { eager: true }) as Record<
  string,
  { default?: unknown }
>;

function extractDeathLines(): string[] {
  const lines: string[] = [];
  for (const mod of Object.values(deathModules)) {
    const data = mod.default;
    if (!Array.isArray(data)) continue;
    for (const entry of data) {
      if (typeof entry === 'string') {
        lines.push(entry);
      } else if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        const text = o['text'] ?? o['line'] ?? o['title'] ?? o['cause'];
        if (typeof text === 'string') lines.push(text);
      }
    }
  }
  return lines;
}

const deathLines = extractDeathLines();

/**
 * Pick a death line from content if available; otherwise return the
 * generic cause supplied by the killing system.
 */
export function deathLineFor(fallbackCause: string, roll: number): string {
  if (deathLines.length === 0) return fallbackCause;
  const idx = Math.min(deathLines.length - 1, Math.floor(roll * deathLines.length));
  return deathLines[idx] ?? fallbackCause;
}
