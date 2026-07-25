/**
 * The daily economy tick (§5.3).
 *
 * One call = one in-game day: token burn, context fill/degrade, morale
 * drift, deadline ticks, zero-resource consequences, tombstone passes,
 * and landmark arrival. TrailScene drives it via advanceDays(), which
 * batches N days for dev fast mode but stops early on anything that
 * needs the player's eyes (landmark, death, mile 2000).
 *
 * Zero-resource table implemented here (numbers now, colorful copy comes
 * from content in a later wave — notices below are functional placeholders,
 * TODO(content-wave) move strings to JSON):
 *  - tokens 0   -> death (the starvation analogue: agent stops mid-edit)
 *  - trust 0    -> travel speed drops to TRUST_ZERO_MILES_PER_DAY
 *  - context >= CONTEXT_MAX -> rework: lose a day, morale, context resets
 *  - greenBuilds 0 -> flag noGreenBuilds (CAB Crossing consumes it later)
 *  - morale 0   -> a party member leaves (for a startup), morale resets
 *  - credibility 0 -> flag credibilityZero (dialogue greys out later)
 */

import {
  CONTEXT_MAX,
  CONTEXT_OVERFLOW_REWORK,
  LANDMARK_RESUPPLY_TOKENS,
  MORALE_COLLAPSE_RESET,
  PACES,
  REST,
  TOKENS_PER_MILE,
  TOTAL_MILES,
  TRUST_ZERO_MILES_PER_DAY,
} from '../config';
import type { Landmark } from './content';
import { LANDMARKS } from './content';
import { actions, getState } from './state';
import { tickDeadlines } from './deadlines';
import { loadTombstones } from './save';

export type DayAction = 'travel' | 'rest';

export interface DayResult {
  day: number;
  milesTraveled: number;
  notices: string[];
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

function tickOneDay(action: DayAction): DayResult {
  const notices: string[] = [];
  const before = getState();
  const pace = PACES[before.pace];

  actions.advanceDay(1);

  let miles = 0;
  if (action === 'travel') {
    const trustExhausted = before.resources.trust <= 0;
    miles = trustExhausted ? TRUST_ZERO_MILES_PER_DAY : pace.milesPerDay;
    if (trustExhausted && !before.flags['trustExhaustedNoticed']) {
      actions.setFlag('trustExhaustedNoticed');
      notices.push('Trust exhausted. Every tool call now requires hand approval. 4 miles today.');
    }
    actions.travelMiles(miles, TOTAL_MILES);
    actions.applyResourceDelta({
      tokens: -(miles * TOKENS_PER_MILE * pace.tokenMultiplier),
      morale: pace.moralePerDay,
      context: pace.contextPerDay,
    });
  } else {
    actions.applyResourceDelta({
      tokens: -REST.tokens,
      morale: REST.morale,
      context: REST.context,
    });
  }

  // Surprise deadlines + doom clock.
  notices.push(...tickDeadlines());

  // --- Zero-resource consequences -----------------------------------------
  let died = false;
  let causeOfDeath: string | null = null;

  const r = getState().resources;

  if (r.context >= CONTEXT_MAX) {
    actions.advanceDay(CONTEXT_OVERFLOW_REWORK.days);
    actions.applyResourceDelta({ morale: CONTEXT_OVERFLOW_REWORK.morale });
    actions.setContext(CONTEXT_OVERFLOW_REWORK.contextAfter);
    actions.setFlag('contextOverflowed');
    // TODO(events-wave): route through the rework event hook instead.
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
      }
    }
    reachedEnd = after.mile >= TOTAL_MILES;
  }

  if (notices.length > 0) actions.log(...notices);

  return {
    day: getState().day,
    milesTraveled: miles,
    notices,
    died,
    causeOfDeath,
    landmarkReached,
    reachedEnd,
  };
}

/**
 * Run up to `maxDays` daily ticks of the same action, stopping early on a
 * landmark, death, or reaching mile 2000. Fast mode passes maxDays > 1;
 * every batched day still runs the full tick, so fast and slow runs with
 * identical inputs produce identical states.
 */
export function advanceDays(action: DayAction, maxDays: number): DayResult {
  let last: DayResult | null = null;
  const clamped = Math.max(1, Math.floor(maxDays));
  for (let i = 0; i < clamped; i++) {
    last = tickOneDay(action);
    if (last.died || last.landmarkReached || last.reachedEnd) break;
  }
  // clamped >= 1, so last is always assigned.
  return last as DayResult;
}
