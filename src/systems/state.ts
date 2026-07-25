/**
 * Single typed GameState + reducer-style actions.
 *
 * STORE CHOICE (documented per spec): this is a MODULE SINGLETON, not the
 * Phaser registry. Scenes import { getState, actions } directly; nothing
 * else holds game state. Rationale: the registry is stringly-typed and
 * this project runs strict TS — a typed module wins. Actions are pure
 * reducers internally (state in → new state out); `commit` swaps the
 * singleton and notifies subscribers.
 */

import type { Pace, RoleId, Specialization, ResourceSet } from '../config';
import { PACES, PARTY_TEMPLATE, ROLES } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Resources = ResourceSet;

export interface PartyMember {
  name: string;
  specialization: Specialization;
  title: string;
  alive: boolean;
}

/** A grave on the trail. Persists across runs (see systems/save.ts). */
export interface Tombstone {
  mile: number;
  day: number;
  cause: string;
  epitaph: string;
  role: RoleId;
  /** ISO timestamp, for eventual social-feed use. */
  when: string;
}

export type DeadlineSource =
  | 'InfoSec'
  | 'Compliance'
  | 'Architecture Review Board'
  | 'PMO'
  | 'The Standards Body';

/**
 * A surprise deadline (the Death March mechanic). Spawned by the event
 * engine in a later wave; systems/deadlines.ts owns add/tick/expire.
 */
export interface SurpriseDeadline {
  id: string;
  source: DeadlineSource;
  title: string;
  dueOnDay: number;
  complyCost: { days?: number; tokens?: number };
  /** Applied as signed deltas when the deadline expires unresolved. */
  deferPenalty: { trust?: number; credibility?: number; morale?: number };
  escalated: boolean;
}

export interface GameState {
  mile: number;
  day: number;
  pace: Pace;
  role: RoleId;
  resources: Resources;
  party: PartyMember[];
  activeDeadlines: SurpriseDeadline[];
  deadlinesMet: number;
  deadlinesMissed: number;
  /** Boolean flags (businessDeadlineMissed, trustExhausted, noGreenBuilds, ...). */
  flags: Record<string, true>;
  /** Index into content LANDMARKS of the next landmark not yet reached. */
  nextLandmarkIndex: number;
  /** Mulberry32 seed; advanced by rand(). Persisted for reproducible runs. */
  rngSeed: number;
  alive: boolean;
  causeOfDeath: string | null;
  /** Last few notice lines shown on the Trail screen. Capped. */
  recentLog: string[];
}

const LOG_CAP = 4;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let current: GameState | null = null;
const listeners = new Set<() => void>();

export function hasRun(): boolean {
  return current !== null;
}

export function getState(): GameState {
  if (!current) throw new Error('No run in progress. TitleScene must call actions.newRun first.');
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: GameState): void {
  current = next;
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Reducer helpers (pure)
// ---------------------------------------------------------------------------

function clampResources(r: Resources): Resources {
  return {
    tokens: Math.max(0, r.tokens),
    context: Math.max(0, r.context),
    trust: Math.max(0, r.trust),
    greenBuilds: Math.max(0, r.greenBuilds),
    morale: Math.max(0, Math.min(100, r.morale)),
    credibility: Math.max(0, Math.min(100, r.credibility)),
  };
}

function withLog(state: GameState, lines: readonly string[]): GameState {
  if (lines.length === 0) return state;
  return { ...state, recentLog: [...state.recentLog, ...lines].slice(-LOG_CAP) };
}

/** Mulberry32. Pure: takes a seed, returns [0..1) and the next seed. */
function mulberry32(seed: number): { value: number; nextSeed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed: t };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions = {
  /** Begin a fresh run. `names` maps onto PARTY_TEMPLATE slots in order. */
  newRun(role: RoleId, names: readonly string[]): void {
    const party: PartyMember[] = PARTY_TEMPLATE.map((slot, i) => {
      const name = (names[i] ?? '').trim();
      return {
        name: name.length > 0 ? name : slot.defaultName,
        specialization: slot.specialization,
        title: slot.title,
        alive: true,
      };
    });
    commit({
      mile: 0,
      day: 0,
      pace: 'steady',
      role,
      resources: { ...ROLES[role].starting },
      party,
      activeDeadlines: [],
      deadlinesMet: 0,
      deadlinesMissed: 0,
      flags: {},
      nextLandmarkIndex: 0,
      rngSeed: (Date.now() ^ (Math.random() * 0xffffffff)) | 0,
      alive: true,
      causeOfDeath: null,
      recentLog: [],
    });
  },

  /** Restore a run loaded from localStorage (systems/save.ts). */
  restoreRun(state: GameState): void {
    commit(state);
  },

  /** Drop the current run (after death or a finished score screen). */
  endRun(): void {
    current = null;
    listeners.forEach((l) => l());
  },

  setPace(pace: Pace): void {
    if (!PACES[pace]) return;
    commit({ ...getState(), pace });
  },

  /** Apply signed resource deltas, clamped. */
  applyResourceDelta(delta: Partial<Resources>, notice?: string): void {
    const s = getState();
    const r: Resources = {
      tokens: s.resources.tokens + (delta.tokens ?? 0),
      context: s.resources.context + (delta.context ?? 0),
      trust: s.resources.trust + (delta.trust ?? 0),
      greenBuilds: s.resources.greenBuilds + (delta.greenBuilds ?? 0),
      morale: s.resources.morale + (delta.morale ?? 0),
      credibility: s.resources.credibility + (delta.credibility ?? 0),
    };
    commit(withLog({ ...s, resources: clampResources(r) }, notice ? [notice] : []));
  },

  advanceDay(days = 1): void {
    const s = getState();
    commit({ ...s, day: s.day + days });
  },

  travelMiles(miles: number, mileCap: number): void {
    const s = getState();
    commit({ ...s, mile: Math.min(mileCap, s.mile + miles) });
  },

  setContext(value: number): void {
    const s = getState();
    commit({ ...s, resources: { ...s.resources, context: Math.max(0, value) } });
  },

  setFlag(flag: string): void {
    const s = getState();
    if (s.flags[flag]) return;
    commit({ ...s, flags: { ...s.flags, [flag]: true } });
  },

  log(...lines: string[]): void {
    commit(withLog(getState(), lines));
  },

  advanceLandmark(): void {
    const s = getState();
    commit({ ...s, nextLandmarkIndex: s.nextLandmarkIndex + 1 });
  },

  addDeadline(deadline: SurpriseDeadline): void {
    const s = getState();
    if (s.activeDeadlines.some((d) => d.id === deadline.id)) return;
    commit({ ...s, activeDeadlines: [...s.activeDeadlines, deadline] });
  },

  removeDeadline(id: string, resolution: 'met' | 'missed'): void {
    const s = getState();
    commit({
      ...s,
      activeDeadlines: s.activeDeadlines.filter((d) => d.id !== id),
      deadlinesMet: s.deadlinesMet + (resolution === 'met' ? 1 : 0),
      deadlinesMissed: s.deadlinesMissed + (resolution === 'missed' ? 1 : 0),
    });
  },

  /** A party member departs (morale collapse, poaching, reorg). Never slot 0. */
  loseMember(index: number): void {
    const s = getState();
    const member = s.party[index];
    if (!member || member.specialization === 'you' || !member.alive) return;
    const party = s.party.map((m, i) => (i === index ? { ...m, alive: false } : m));
    commit({ ...s, party });
  },

  markDead(cause: string): void {
    const s = getState();
    commit({ ...s, alive: false, causeOfDeath: cause });
  },

  /** Seeded RNG in [0..1). Advances the stored seed. */
  rand(): number {
    const s = getState();
    const { value, nextSeed } = mulberry32(s.rngSeed);
    commit({ ...s, rngSeed: nextSeed });
    return value;
  },
};
