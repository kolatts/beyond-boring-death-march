/**
 * The doom clock + surprise deadlines (the Death March mechanic).
 *
 * Two clocks run at once:
 *  1. THE BUSINESS DEADLINE — go-live is Day BUSINESS_DEADLINE_DAY (120).
 *     Passing it does not end the run; it sets `businessDeadlineMissed`,
 *     which Production consumes as the "compliance victory" ending.
 *  2. SURPRISE DEADLINES — dropped on the party by InfoSec / Compliance /
 *     ARB / PMO / The Standards Body, drawn from content/deadlines.json
 *     by weight + `requires` (filtered exactly like events). Each can be:
 *       COMPLY        — pay complyCost days/tokens (the go-live slips),
 *       DEFER         — leave it; on expiry the deferPenalty lands AND its
 *                       `escalationEventId` fires through the event engine,
 *       BUY EXCEPTION — spend EXCEPTION_CREDIBILITY_COST credibility to
 *                       make it a signature instead of a work item.
 *
 * Spawn pacing: at most DEADLINE_MAX_ACTIVE active, a cooldown of
 * DEADLINE_SPAWN_COOLDOWN_DAYS between couriers, spawn chance per day
 * after DEADLINE_SPAWN_MIN_DAY. Each definition spawns at most once per
 * run (flag `deadline_seen_<id>`).
 */

import {
  BUSINESS_DEADLINE_DAY,
  DEADLINE_MAX_ACTIVE,
  DEADLINE_SPAWN_CHANCE_PER_DAY,
  DEADLINE_SPAWN_COOLDOWN_DAYS,
  DEADLINE_SPAWN_MIN_DAY,
  DOOM_WARN_DAYS,
  EXCEPTION_CREDIBILITY_COST,
} from '../config';
import { DEADLINE_DEFS } from './content';
import type { DeadlineDef } from './content';
import { fireEventById, requirementsMet } from './eventEngine';
import type { SurpriseDeadline } from './state';
import { actions, getState } from './state';

// ---------------------------------------------------------------------------
// Doom clock
// ---------------------------------------------------------------------------

export type DoomPhase = 'green' | 'warn' | 'missed';

export interface DoomClock {
  deadlineDay: number;
  daysRemaining: number;
  phase: DoomPhase;
}

export function doomClock(day: number): DoomClock {
  const daysRemaining = BUSINESS_DEADLINE_DAY - day;
  let phase: DoomPhase = 'green';
  if (daysRemaining < 0) phase = 'missed';
  else if (daysRemaining <= DOOM_WARN_DAYS) phase = 'warn';
  return { deadlineDay: BUSINESS_DEADLINE_DAY, daysRemaining, phase };
}

// ---------------------------------------------------------------------------
// Spawning from content
// ---------------------------------------------------------------------------

function toActive(def: DeadlineDef, day: number): SurpriseDeadline {
  return {
    id: def.id,
    source: def.source,
    title: def.title,
    body: def.body,
    dueOnDay: day + def.dueInDays,
    complyCost: def.complyCost,
    deferPenalty: def.deferPenalty,
    escalationEventId: def.escalationEventId,
    escalated: false,
  };
}

/** Add a surprise deadline to the active set. Idempotent by id. */
export function spawnDeadline(deadline: SurpriseDeadline): void {
  actions.addDeadline(deadline);
}

/** Weighted draw of one eligible, unseen deadline definition. */
function drawDeadline(): DeadlineDef | null {
  const s = getState();
  const pool = DEADLINE_DEFS.filter(
    (d) =>
      d.weight > 0 && !s.flags[`deadline_seen_${d.id}`] && requirementsMet(d.requires, s),
  );
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, d) => sum + d.weight, 0);
  let roll = actions.rand() * total;
  for (const d of pool) {
    roll -= d.weight;
    if (roll <= 0) return d;
  }
  return pool[pool.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Player actions on an active deadline
// ---------------------------------------------------------------------------

/**
 * Comply now: pay the days (the business deadline slips) and the tokens.
 * Returns notice lines. NOTE: comply days advance the calendar without a
 * full economy tick — compliance work burns days, not miles. Documented
 * simplification.
 */
export function complyDeadline(id: string): string[] {
  const s = getState();
  const d = s.activeDeadlines.find((x) => x.id === id);
  if (!d) return [];
  const days = d.complyCost.days ?? 0;
  const tokens = d.complyCost.tokens ?? 0;
  if (days > 0) actions.advanceDay(days);
  if (tokens > 0) actions.applyResourceDelta({ tokens: -tokens });
  actions.removeDeadline(id, 'met');
  return [`Complied: ${d.source} — ${d.title}. Cost ${days}d, ${tokens} tokens.`];
}

/**
 * Buy an exception: EXCEPTION_CREDIBILITY_COST credibility converts the
 * mandate into a signature. Counts as MET — the register is immaculate;
 * that is what the register is for. Returns null if credibility is short.
 */
export function buyException(id: string): string[] | null {
  const s = getState();
  const d = s.activeDeadlines.find((x) => x.id === id);
  if (!d) return null;
  if (s.resources.credibility < EXCEPTION_CREDIBILITY_COST) return null;
  actions.applyResourceDelta({ credibility: -EXCEPTION_CREDIBILITY_COST });
  actions.removeDeadline(id, 'met');
  actions.setFlag(`deadline_excepted_${id}`);
  return [
    `Exception granted: ${d.source} — ${d.title}. -${EXCEPTION_CREDIBILITY_COST} credibility. The work is not done. The form saying so is.`,
  ];
}

// ---------------------------------------------------------------------------
// Daily tick — called by economy.ts inside tickOneDay
// ---------------------------------------------------------------------------

export interface DeadlineTickResult {
  notices: string[];
  /** Deadlines that spawned today (the Trail slams a courier notice). */
  spawned: SurpriseDeadline[];
  /** Escalation event ids to fire through the event engine (expiries). */
  escalationEventIds: string[];
}

export function tickDeadlinesDetailed(): DeadlineTickResult {
  const notices: string[] = [];
  const spawned: SurpriseDeadline[] = [];
  const escalationEventIds: string[] = [];
  const day = getState().day;

  // Spawn roll: capped active set, cooldown between couriers.
  const s = getState();
  if (
    day >= DEADLINE_SPAWN_MIN_DAY &&
    s.activeDeadlines.length < DEADLINE_MAX_ACTIVE &&
    day - s.lastDeadlineSpawnDay >= DEADLINE_SPAWN_COOLDOWN_DAYS &&
    actions.rand() < DEADLINE_SPAWN_CHANCE_PER_DAY
  ) {
    const def = drawDeadline();
    if (def) {
      const active = toActive(def, day);
      spawnDeadline(active);
      actions.setFlag(`deadline_seen_${def.id}`);
      actions.noteDeadlineSpawn(day);
      spawned.push(active);
      notices.push(
        `${def.source}: ${def.title} — due day ${active.dueOnDay}. They have known for months. You learned in this sentence.`,
      );
    }
  }

  // Expiry: penalty lands AND the escalation event fires (event engine).
  for (const d of [...getState().activeDeadlines]) {
    if (day > d.dueOnDay) {
      actions.applyResourceDelta({
        trust: d.deferPenalty.trust ?? 0,
        credibility: d.deferPenalty.credibility ?? 0,
        morale: d.deferPenalty.morale ?? 0,
      });
      actions.removeDeadline(d.id, 'missed');
      actions.setFlag(`deadline_escalated_${d.id}`);
      if (d.escalationEventId) escalationEventIds.push(d.escalationEventId);
      notices.push(`ESCALATED: ${d.source} — ${d.title}. A register has your name on it.`);
    }
  }

  // Doom clock crossing.
  if (day > BUSINESS_DEADLINE_DAY && !getState().flags['businessDeadlineMissed']) {
    actions.setFlag('businessDeadlineMissed');
    notices.push('DAY 120 HAS PASSED. The go-live date is behind you. The march continues.');
  }

  return { notices, spawned, escalationEventIds };
}

/**
 * Back-compat wrapper (CabCrossingScene's reconciliation tick expects
 * notice lines). Escalation events fire through the engine immediately —
 * their effects apply and log, without a Trail modal. The economy tick
 * uses tickDeadlinesDetailed instead and presents modals itself.
 */
export function tickDeadlines(): string[] {
  const result = tickDeadlinesDetailed();
  for (const id of result.escalationEventIds) fireEventById(id, 'escalation');
  return result.notices;
}
