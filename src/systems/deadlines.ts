/**
 * The doom clock + surprise deadlines (the Death March mechanic).
 *
 * Two clocks run at once:
 *  1. THE BUSINESS DEADLINE — go-live is Day BUSINESS_DEADLINE_DAY (120).
 *     Passing it does not end the run; it sets `businessDeadlineMissed`,
 *     which Production consumes as the "compliance victory" ending.
 *  2. SURPRISE DEADLINES — dropped on the party by InfoSec / Compliance /
 *     ARB / PMO / The Standards Body. Each can be complied with (costs
 *     days and tokens — the business deadline slips) or left to expire
 *     (trust/credibility penalties, escalation).
 *
 * The event engine (later wave) is the intended spawner: it should call
 * `spawnDeadline(...)` with content-authored definitions. Until then a
 * small seed table exercises the machinery. TODO(events-wave): replace
 * SEED_DEADLINES with event-engine spawns from content JSON.
 */

import { BUSINESS_DEADLINE_DAY, DOOM_WARN_DAYS } from '../config';
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
// Seed deadlines (placeholder until the event engine wave)
// ---------------------------------------------------------------------------

interface DeadlineSeed {
  spawnOnDay: number;
  deadline: Omit<SurpriseDeadline, 'escalated'>;
}

const SEED_DEADLINES: readonly DeadlineSeed[] = [
  {
    spawnOnDay: 12,
    deadline: {
      id: 'seed_cert_rotation',
      source: 'InfoSec',
      title: 'CERTIFICATE ROTATION, ALL SERVICES',
      dueOnDay: 19,
      complyCost: { days: 2, tokens: 10 },
      deferPenalty: { trust: -1, credibility: -8 },
    },
  },
  {
    spawnOnDay: 40,
    deadline: {
      id: 'seed_attestation',
      source: 'The Standards Body',
      title: 'MANDATORY ATTESTATION CAMPAIGN',
      dueOnDay: 47,
      complyCost: { days: 1, tokens: 4 },
      deferPenalty: { credibility: -10, morale: -4 },
    },
  },
  {
    spawnOnDay: 70,
    deadline: {
      id: 'seed_arb_review',
      source: 'Architecture Review Board',
      title: 'RETROACTIVE DESIGN REVIEW',
      dueOnDay: 80,
      complyCost: { days: 2 },
      deferPenalty: { trust: -1, credibility: -6 },
    },
  },
];

// ---------------------------------------------------------------------------
// API — the event engine calls these in a later wave
// ---------------------------------------------------------------------------

/** Add a surprise deadline to the active set. Idempotent by id. */
export function spawnDeadline(deadline: Omit<SurpriseDeadline, 'escalated'>): void {
  actions.addDeadline({ ...deadline, escalated: false });
}

/**
 * Comply with an active deadline now: pay the days (the business deadline
 * slips) and the tokens. Returns notice lines. NOTE: comply days advance
 * the calendar without a full economy tick — compliance work burns days,
 * not miles. Documented simplification.
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
 * Daily tick. Spawns seeded deadlines, expires overdue ones (applying
 * defer penalties + escalation), and flips the businessDeadlineMissed
 * flag the day the doom clock passes. Returns notice lines.
 */
export function tickDeadlines(): string[] {
  const notices: string[] = [];
  const day = getState().day;

  // Seed spawns. TODO(events-wave): the event engine replaces this.
  for (const seed of SEED_DEADLINES) {
    if (day >= seed.spawnOnDay && day < seed.deadline.dueOnDay) {
      const already =
        getState().activeDeadlines.some((d) => d.id === seed.deadline.id) ||
        getState().flags[`deadline_seen_${seed.deadline.id}`];
      if (!already) {
        spawnDeadline(seed.deadline);
        actions.setFlag(`deadline_seen_${seed.deadline.id}`);
        notices.push(
          `${seed.deadline.source}: ${seed.deadline.title} — due day ${seed.deadline.dueOnDay}. They have known for months. You learned in this sentence.`,
        );
      }
    }
  }

  // Expiry.
  for (const d of [...getState().activeDeadlines]) {
    if (day > d.dueOnDay) {
      actions.applyResourceDelta({
        trust: d.deferPenalty.trust ?? 0,
        credibility: d.deferPenalty.credibility ?? 0,
        morale: d.deferPenalty.morale ?? 0,
      });
      actions.removeDeadline(d.id, 'missed');
      actions.setFlag(`deadline_escalated_${d.id}`);
      notices.push(`ESCALATED: ${d.source} — ${d.title}. Penalties applied. A register has your name on it.`);
    }
  }

  // Doom clock crossing.
  if (day > BUSINESS_DEADLINE_DAY && !getState().flags['businessDeadlineMissed']) {
    actions.setFlag('businessDeadlineMissed');
    notices.push('DAY 120 HAS PASSED. The go-live date is behind you. The march continues.');
  }

  return notices;
}
