/**
 * The daily economy tick (§5.3) — Wave 3: wired to the event engine,
 * content-driven surprise deadlines, and the outfitting loadout.
 *
 * One call = one in-game day: token burn, context fill/degrade, morale
 * drift, deadline ticks (spawns/expiries/escalations), the event engine
 * tick, zero-resource consequences, tombstone passes, and landmark
 * arrival. TrailScene drives it via advanceDays(), which batches N days
 * for dev fast mode but stops early on anything that needs the player's
 * eyes (landmark, death, mile 2000, a fired event, a courier).
 *
 * OUTFITTING WIRING (localStorage bbdm:outfitting, written by §7.1):
 *  - derived.speed scales miles/day against OUTFIT_REFERENCE.speed;
 *  - derived.costPerMile scales token burn/mile against
 *    OUTFIT_REFERENCE.costPerMile;
 *  - derived.adherence damps bad random-event severity (eventEngine).
 *  Absent/invalid loadout -> multiplier 1.0 (the canonical Workhorse +
 *  Terminal Agent pair). Clamped so no loadout breaks the economy.
 *
 * OVERNIGHT TRAVEL (Night Watch unlock): while the `overnightTravel` flag
 * is set AND bbdm:nightwatch has { unlocked: true, budget !== 'none' },
 * every travel day banks OVERNIGHT_MILES_PER_NIGHT bonus miles at the
 * normal per-mile token rate (no pace multiplier — the night loop does
 * not hurry). Each banked night is also an agent-write moment for the
 * Skills Exchange procedure trap.
 *
 * Zero-resource table implemented here (§5.3):
 *  - tokens 0   -> death (the starvation analogue: agent stops mid-edit)
 *  - trust 0    -> travel speed drops to TRUST_ZERO_MILES_PER_DAY
 *  - context >= CONTEXT_MAX -> rework: lose a day, morale, context resets
 *  - greenBuilds 0 -> flag noGreenBuilds (CAB Crossing consumes it)
 *  - morale 0   -> a party member leaves (for a startup), morale resets
 *  - credibility 0 -> flag credibilityZero (dialogue greys out)
 */

import {
  CONTEXT_MAX,
  CONTEXT_OVERFLOW_REWORK,
  LANDMARK_RESUPPLY_TOKENS,
  MORALE_COLLAPSE_RESET,
  OUTFIT_COST_CLAMP,
  OUTFIT_REFERENCE,
  OUTFIT_SPEED_CLAMP,
  OVERNIGHT_MILES_PER_NIGHT,
  PACES,
  REST,
  TOKENS_PER_MILE,
  TOTAL_MILES,
  TRUST_ZERO_MILES_PER_DAY,
} from '../config';
import type { Landmark } from './content';
import { LANDMARKS } from './content';
import { actions, getState } from './state';
import { tickDeadlinesDetailed } from './deadlines';
import type { SurpriseDeadline } from './state';
import { fireEventById, notifyAgentWrite, tickEvents } from './eventEngine';
import type { TriggeredEvent } from './eventEngine';
import { loadLoadout } from './outfittingSim';
import { loadNightWatchRecord } from './nightWatchSim';
import { loadTombstones } from './save';

export type DayAction = 'travel' | 'rest';

export interface DayResult {
  day: number;
  milesTraveled: number;
  /** Bonus miles banked by the overnight loop (0 when locked). */
  nightMiles: number;
  notices: string[];
  /** Events fired this day (random / flagged / escalation / trap). The
   * Trail presents each as a modal; batching stops when non-empty. */
  triggers: TriggeredEvent[];
  /** Surprise deadlines that spawned this day (courier modal). */
  spawnedDeadlines: SurpriseDeadline[];
  died: boolean;
  causeOfDeath: string | null;
  landmarkReached: Landmark | null;
  reachedEnd: boolean;
}

/** Generic cause strings passed to the death flow (content deaths.json
 * overrides presentation when it exists). */
export const CAUSES = {
  tokenExhaustion: 'TOKEN EXHAUSTION',
} as const;

// ---------------------------------------------------------------------------
// Outfitting multipliers (defaults 1.0 when bbdm:outfitting is absent)
// ---------------------------------------------------------------------------

interface OutfitMultipliers {
  speed: number;
  cost: number;
}

function outfitMultipliers(): OutfitMultipliers {
  const derived = loadLoadout()?.derived;
  if (!derived) return { speed: 1, cost: 1 };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const speed =
    typeof derived.speed === 'number' && derived.speed > 0
      ? clamp(derived.speed / OUTFIT_REFERENCE.speed, OUTFIT_SPEED_CLAMP.min, OUTFIT_SPEED_CLAMP.max)
      : 1;
  const cost =
    typeof derived.costPerMile === 'number' && derived.costPerMile >= 0
      ? clamp(
          derived.costPerMile / OUTFIT_REFERENCE.costPerMile,
          OUTFIT_COST_CLAMP.min,
          OUTFIT_COST_CLAMP.max,
        )
      : 1;
  return { speed, cost };
}

/** Overnight travel is live: Night Watch success + a budget cap that is
 * still real. If a later system invalidates the cap it sets budget 'none'
 * and the benefit lapses (nightWatchSim contract). */
function overnightActive(): boolean {
  if (!getState().flags['overnightTravel']) return false;
  const record = loadNightWatchRecord();
  return Boolean(record?.unlocked && record.budget !== 'none');
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function tickOneDay(action: DayAction): DayResult {
  const notices: string[] = [];
  const triggers: TriggeredEvent[] = [];
  const before = getState();
  const pace = PACES[before.pace];
  const outfit = outfitMultipliers();

  actions.advanceDay(1);

  let miles = 0;
  let nightMiles = 0;
  if (action === 'travel') {
    const trustExhausted = before.resources.trust <= 0;
    miles = trustExhausted
      ? TRUST_ZERO_MILES_PER_DAY
      : Math.max(1, Math.round(pace.milesPerDay * outfit.speed));
    if (trustExhausted && !before.flags['trustExhaustedNoticed']) {
      actions.setFlag('trustExhaustedNoticed');
      notices.push('Trust exhausted. Every tool call now requires hand approval. 4 miles today.');
    }
    actions.travelMiles(miles, TOTAL_MILES);
    actions.applyResourceDelta({
      tokens: -(miles * TOKENS_PER_MILE * pace.tokenMultiplier * outfit.cost),
      morale: pace.moralePerDay,
      context: pace.contextPerDay,
    });

    // Overnight travel: the loop banks miles while the party sleeps.
    if (overnightActive()) {
      nightMiles = OVERNIGHT_MILES_PER_NIGHT;
      actions.travelMiles(nightMiles, TOTAL_MILES);
      actions.applyResourceDelta({ tokens: -(nightMiles * TOKENS_PER_MILE * outfit.cost) });
      const leak = notifyAgentWrite(); // an unattended write is still a write
      if (leak) triggers.push(leak);
    }
  } else {
    actions.applyResourceDelta({
      tokens: -REST.tokens,
      morale: REST.morale,
      context: REST.context,
    });
  }

  // Surprise deadlines + doom clock; expiries fire their escalation events.
  const deadlineTick = tickDeadlinesDetailed();
  notices.push(...deadlineTick.notices);
  for (const escalationId of deadlineTick.escalationEventIds) {
    const t = fireEventById(escalationId, 'escalation');
    if (t) triggers.push(t);
  }

  // The event engine day (random draw on travel days, flag fuses always).
  triggers.push(...tickEvents(action === 'travel'));

  // --- Zero-resource consequences -----------------------------------------
  let died = false;
  let causeOfDeath: string | null = null;

  const r = getState().resources;

  if (r.context >= CONTEXT_MAX) {
    actions.advanceDay(CONTEXT_OVERFLOW_REWORK.days);
    actions.applyResourceDelta({ morale: CONTEXT_OVERFLOW_REWORK.morale });
    actions.setContext(CONTEXT_OVERFLOW_REWORK.contextAfter);
    actions.setFlag('contextOverflowed');
    notices.push('CONTEXT OVERFLOW. The agent confidently rebuilt the wrong thing. Rework: 1 day.');
  }

  if (getState().resources.morale <= 0) {
    const s = getState();
    const idx = s.party.findIndex((m) => m.alive && m.specialization !== 'you');
    if (idx >= 0) {
      const name = s.party[idx]?.name ?? 'A party member';
      actions.loseMember(idx);
      actions.applyResourceDelta({ morale: MORALE_COLLAPSE_RESET });
      notices.push(`${name} has left for a startup. They will post about it.`);
    } else {
      // Everyone else already left. You march alone; morale floors at 1.
      actions.applyResourceDelta({ morale: 1 });
    }
  }

  if (getState().resources.greenBuilds <= 0) actions.setFlag('noGreenBuilds');
  if (getState().resources.credibility <= 0) actions.setFlag('credibilityZero');

  if (getState().resources.tokens <= 0) {
    died = true;
    causeOfDeath = CAUSES.tokenExhaustion;
    actions.markDead(causeOfDeath);
    notices.push('The token budget is gone. The agent stopped mid-edit. The repo is half-migrated.');
  }

  // --- Tombstones from earlier runs, passed on the trail -------------------
  if (miles > 0 && !died) {
    const after = getState();
    for (const t of loadTombstones()) {
      if (t.mile > before.mile && t.mile <= after.mile) {
        notices.push(`A grave at mile ${t.mile}: "${t.epitaph}" (${t.cause})`);
      }
    }
  }

  // --- Landmark arrival ----------------------------------------------------
  let landmarkReached: Landmark | null = null;
  let reachedEnd = false;
  if (!died) {
    const after = getState();
    const next = LANDMARKS[after.nextLandmarkIndex];
    if (next && after.mile >= next.mile) {
      landmarkReached = next;
      actions.advanceLandmark();
      if (next.mile > 0) {
        actions.applyResourceDelta({ tokens: LANDMARK_RESUPPLY_TOKENS });
        notices.push(`Requisition approved at ${next.name}: +${LANDMARK_RESUPPLY_TOKENS} tokens.`);

        // Party assist (§5.4): the Scrum Master converts 1 Morale into 1
        // Credibility at each landmark — the work made visible.
        const s = getState();
        const scrumAlive = s.party.some((m) => m.alive && m.specialization === 'scrum');
        if (scrumAlive && s.resources.morale >= 2) {
          actions.applyResourceDelta({ morale: -1, credibility: 1 });
          const scrumName =
            s.party.find((m) => m.specialization === 'scrum')?.name ?? 'The Scrum Master';
          notices.push(`${scrumName} converts an hour of morale into a visible artifact. +1 credibility.`);
        }

        // A landmark stop is a minigame work session — an agent write.
        const leak = notifyAgentWrite();
        if (leak) triggers.push(leak);
      }
    }
    reachedEnd = after.mile >= TOTAL_MILES;
  }

  if (notices.length > 0) actions.log(...notices);

  return {
    day: getState().day,
    milesTraveled: miles,
    nightMiles,
    notices,
    triggers,
    spawnedDeadlines: deadlineTick.spawned,
    died,
    causeOfDeath,
    landmarkReached,
    reachedEnd,
  };
}

/**
 * Run up to `maxDays` daily ticks of the same action, stopping early on a
 * landmark, death, mile 2000, a fired event, or a courier — anything the
 * Trail must present before the next day runs. Fast mode passes
 * maxDays > 1; every batched day still runs the full tick, so fast and
 * slow runs with identical inputs produce identical states.
 */
export function advanceDays(action: DayAction, maxDays: number): DayResult {
  let last: DayResult | null = null;
  const clamped = Math.max(1, Math.floor(maxDays));
  for (let i = 0; i < clamped; i++) {
    last = tickOneDay(action);
    if (
      last.died ||
      last.landmarkReached ||
      last.reachedEnd ||
      last.triggers.length > 0 ||
      last.spawnedDeadlines.length > 0
    )
      break;
  }
  // clamped >= 1, so last is always assigned.
  return last as DayResult;
}
