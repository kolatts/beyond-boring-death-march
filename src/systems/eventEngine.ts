/**
 * The event engine (§8.1) — weighted random draw per travel day from
 * content/events.json, plus the two non-random fire paths:
 *
 *  1. ESCALATIONS — deadlines.ts hands an `escalationEventId` to
 *     `fireEventById` when a surprise deadline expires.
 *  2. FLAG-TRIGGERED — `compromised` schedules `compromised_consequence`
 *     on a day fuse; `hollow_green` schedules `hollow_green_discovered`
 *     on a mile fuse (+200 miles, per the content contract).
 *
 * WEIGHT-0 RULE (DECISIONS.md, non-negotiable): an event with weight 0 is
 * NEVER drawn from the random pool. It exists to be fired by id.
 *
 * PROCEDURE TRAP (§7.7 Standing Order lesson): buying the trap procedure
 * at the Skills Exchange stores bbdm:skillsmarket.procedureTrap
 * { usesRemaining: 4 }. Every qualifying AGENT-WRITE moment decrements it
 * (see AGENT_WRITE_EVENT_IDS + notifyAgentWrite); once exhausted, the next
 * write fires `procedure_trap_leak` (weight 0), which sets `compromised`
 * and hands the run to the injection consequence chain. TrailScene shows
 * curriculum card `enforcement_in_harness` after that modal.
 *
 * Base event effects are applied HERE at fire time (deterministic under
 * dev fast mode); choice effects are applied by the TrailScene modal via
 * `applyChoice`. All effect application routes through state actions.
 */

import {
  ADHERENCE_DAMP_FLOOR,
  ADHERENCE_DAMP_MAX,
  ADHERENCE_DAMP_PER_POINT,
  COMPROMISED_FUSE_DAYS,
  EVENT_CHANCE_PER_TRAVEL_DAY,
  EVENT_COOLDOWN_COUNT,
  HOLLOW_GREEN_DISCOVERY_MILES,
  TOTAL_MILES,
} from '../config';
import type { Specialization } from '../config';
import { eventById, EVENTS } from './content';
import type { EventChoice, EventEffects, Requires, TrailEvent } from './content';
import { loadLoadout } from './outfittingSim';
import { actions, getState } from './state';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerKind = 'random' | 'flagged' | 'escalation' | 'trap';

/** An event that fired this tick. Base effects are already applied; the
 * Trail modal presents it (and applies any chosen choice's effects). */
export interface TriggeredEvent {
  event: TrailEvent;
  kind: TriggerKind;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

/** Content member ids (party.json / events.json) -> state specializations. */
const MEMBER_ID_TO_SPEC: Record<string, Specialization> = {
  junior: 'junior',
  skeptical_principal: 'principal',
  principal: 'principal',
  security_champion: 'security',
  security: 'security',
  scrum_master: 'scrum',
  scrum: 'scrum',
  you: 'you',
};

function memberAlive(s: GameState, contentId: string): boolean {
  const spec = MEMBER_ID_TO_SPEC[contentId];
  if (!spec) return false;
  return s.party.some((m) => m.alive && m.specialization === spec);
}

function inRange(value: number, range?: { gt?: number; lt?: number }): boolean {
  if (!range) return true;
  if (range.gt !== undefined && !(value > range.gt)) return false;
  if (range.lt !== undefined && !(value < range.lt)) return false;
  return true;
}

/** Evaluate a `requires` block against the current run. */
export function requirementsMet(req: Requires | undefined, s: GameState): boolean {
  if (!req) return true;
  if (!inRange(s.mile, req.milesTraveled)) return false;
  if (!inRange(s.day, req.day)) return false;
  if (req.hasFlag && !s.flags[req.hasFlag]) return false;
  if (req.notFlag && s.flags[req.notFlag]) return false;
  if (req.partyMemberAlive && !memberAlive(s, req.partyMemberAlive)) return false;
  if (req.partyMemberDead && memberAlive(s, req.partyMemberDead)) return false;
  if (req.resource) {
    const value = s.resources[req.resource.name];
    if (req.resource.lt !== undefined && !(value < req.resource.lt)) return false;
    if (req.resource.gt !== undefined && !(value > req.resource.gt)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * Adherence damping (config): high derived instruction adherence from the
 * outfitting loadout shaves a small fraction off NEGATIVE resource deltas
 * of RANDOM events only — the agent follows the runbook when things go
 * sideways. Escalations and flag consequences hit at full weight; those
 * are the wages of deferral, not of bad luck.
 */
function adherenceDamp(): number {
  const derived = loadLoadout()?.derived;
  if (!derived || typeof derived.adherence !== 'number') return 0;
  const above = Math.max(0, derived.adherence - ADHERENCE_DAMP_FLOOR);
  return Math.min(ADHERENCE_DAMP_MAX, above * ADHERENCE_DAMP_PER_POINT);
}

function dampNegative(value: number | undefined, damp: number): number {
  if (!value) return 0;
  if (value >= 0 || damp <= 0) return value;
  // Round toward zero so -1 stays -1 and small penalties stay felt.
  return Math.sign(value) * Math.floor(Math.abs(value) * (1 - damp));
}

/**
 * Apply an event/choice effects block through state actions. Returns
 * notice lines for anything the player must not miss in the modal text
 * (member losses). `dampen` enables the adherence shave (random events).
 */
export function applyEventEffects(effects: EventEffects, dampen = false): string[] {
  const notices: string[] = [];
  const damp = dampen ? adherenceDamp() : 0;

  const delta = {
    tokens: dampNegative(effects.tokens, damp),
    context: effects.context ?? 0, // context relief is a gift; never damped
    trust: dampNegative(effects.trust, damp),
    greenBuilds: dampNegative(effects.greenBuilds, damp),
    morale: dampNegative(effects.morale, damp),
    credibility: dampNegative(effects.credibility, damp),
  };
  if (Object.values(delta).some((v) => v !== 0)) {
    actions.applyResourceDelta(delta);
  }
  if (effects.days && effects.days > 0) actions.advanceDay(effects.days);
  if (effects.miles && effects.miles > 0) actions.travelMiles(effects.miles, TOTAL_MILES);
  if (effects.setFlag) actions.setFlag(effects.setFlag);

  if (effects.loseMember) {
    const s = getState();
    let index = -1;
    if (effects.loseMember === 'random') {
      const candidates = s.party
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m.alive && x.m.specialization !== 'you');
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(actions.rand() * candidates.length)];
        index = pick ? pick.i : -1;
      }
    } else {
      const spec = MEMBER_ID_TO_SPEC[effects.loseMember];
      index = s.party.findIndex((m) => m.alive && m.specialization === spec);
    }
    if (index >= 0) {
      const name = getState().party[index]?.name ?? 'A party member';
      actions.loseMember(index);
      notices.push(`${name} has left the party.`);
    }
  }
  return notices;
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/** Choices whose `requires` hold right now (e.g. the injection event shows
 * exactly one branch depending on the Security Champion's pulse). */
export function visibleChoices(event: TrailEvent, s: GameState): EventChoice[] {
  return event.choices.filter((c) => requirementsMet(c.requires, s));
}

/** Apply a selected choice's effects (undamped: the player chose it). */
export function applyChoice(choice: EventChoice): string[] {
  return applyEventEffects(choice.effects, false);
}

// ---------------------------------------------------------------------------
// Fire paths
// ---------------------------------------------------------------------------

/**
 * Fire a specific event by id (escalations, flag-triggered, the trap).
 * Applies base effects immediately. Weight is IGNORED here on purpose:
 * this is the only door weight-0 events come through.
 */
export function fireEventById(id: string, kind: TriggerKind): TriggeredEvent | null {
  const event = eventById(id);
  if (!event) return null;
  applyEventEffects(event.effects, false);
  actions.log(`EVENT: ${event.title}`);
  return { event, kind };
}

/** Weighted random draw from eligible weight>0 events, minus recents. */
function drawRandomEvent(): TrailEvent | null {
  const s = getState();
  const pool = EVENTS.filter(
    (e) => e.weight > 0 && !s.recentEventIds.includes(e.id) && requirementsMet(e.requires, s),
  );
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let roll = actions.rand() * total;
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return pool[pool.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Procedure trap (bbdm:skillsmarket.procedureTrap)
// ---------------------------------------------------------------------------

/** Random events that count as the agent WRITING under the prose rule. */
const AGENT_WRITE_EVENT_IDS = new Set([
  'helpful_rewrite',
  'agent_scope_creep',
  'token_spike',
  'context_rot',
  'junior_merge',
  'green_build_lottery',
  'overnight_windfall',
]);

const SKILLS_MARKET_KEY = 'bbdm:skillsmarket';

interface MarketRecord {
  v: 1;
  owned: string[];
  procedureTrap?: { goodId: string; usesRemaining: number };
}

function readMarketRecord(): MarketRecord | null {
  try {
    const raw = window.localStorage.getItem(SKILLS_MARKET_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as MarketRecord;
    if (data?.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

function writeMarketRecord(record: MarketRecord): void {
  try {
    window.localStorage.setItem(SKILLS_MARKET_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: the trap simply cannot count. Non-fatal.
  }
}

/**
 * Notify the trap that an agent-write moment happened. Qualifying moments:
 * an AGENT_WRITE_EVENT_IDS random event, a banked overnight-travel night,
 * or a landmark arrival (the minigame work session) — economy.ts calls
 * this for the latter two. The procedure holds `usesRemaining` times
 * ("works four times"); the write AFTER exhaustion leaks the secret.
 * Returns the leak TriggeredEvent when it fires.
 */
export function notifyAgentWrite(): TriggeredEvent | null {
  const s = getState();
  if (s.flags['procedure_trap_fired']) return null;
  const record = readMarketRecord();
  if (!record?.procedureTrap) return null;

  if (record.procedureTrap.usesRemaining > 0) {
    record.procedureTrap.usesRemaining -= 1;
    writeMarketRecord(record);
    return null;
  }
  actions.setFlag('procedure_trap_fired');
  return fireEventById('procedure_trap_leak', 'trap');
}

// ---------------------------------------------------------------------------
// Flag-triggered scheduling
// ---------------------------------------------------------------------------

interface FlagFuse {
  flag: string;
  eventId: string;
  schedule: (s: GameState) => { onDay?: number; onMile?: number };
}

const FLAG_FUSES: readonly FlagFuse[] = [
  {
    flag: 'compromised',
    eventId: 'compromised_consequence',
    schedule: (s) => ({
      onDay:
        s.day + COMPROMISED_FUSE_DAYS.min + Math.floor(actions.rand() * COMPROMISED_FUSE_DAYS.span),
    }),
  },
  {
    flag: 'hollow_green',
    eventId: 'hollow_green_discovered',
    schedule: (s) => ({ onMile: s.mile + HOLLOW_GREEN_DISCOVERY_MILES }),
  },
];

function scheduleFlagFuses(): void {
  const s = getState();
  for (const fuse of FLAG_FUSES) {
    if (!s.flags[fuse.flag]) continue;
    if (s.flags[`event_fired_${fuse.eventId}`]) continue;
    if (s.pendingEvents.some((p) => p.id === fuse.eventId)) continue;
    actions.schedulePendingEvent({ id: fuse.eventId, ...fuse.schedule(s) });
  }
}

function fireDuePendingEvents(): TriggeredEvent[] {
  const fired: TriggeredEvent[] = [];
  for (const pending of [...getState().pendingEvents]) {
    const s = getState();
    const dayDue = pending.onDay !== undefined && s.day >= pending.onDay;
    const mileDue = pending.onMile !== undefined && s.mile >= pending.onMile;
    if (!dayDue && !mileDue) continue;
    actions.removePendingEvent(pending.id);
    const event = eventById(pending.id);
    // The fuse's requires must still hold when it goes off (e.g. the flag).
    if (!event || !requirementsMet(event.requires, s)) continue;
    actions.setFlag(`event_fired_${pending.id}`);
    const t = fireEventById(pending.id, 'flagged');
    if (t) fired.push(t);
  }
  return fired;
}

// ---------------------------------------------------------------------------
// The daily tick — called by economy.ts inside tickOneDay
// ---------------------------------------------------------------------------

/**
 * One day of event life. Order: schedule flag fuses, fire due fuses, then
 * (travel days only) roll for a random event. Returns everything that
 * fired; economy stops fast-mode batching when this is non-empty so the
 * Trail can present each modal.
 */
export function tickEvents(travelDay: boolean): TriggeredEvent[] {
  const fired: TriggeredEvent[] = [];

  scheduleFlagFuses();
  fired.push(...fireDuePendingEvents());

  if (travelDay && actions.rand() < EVENT_CHANCE_PER_TRAVEL_DAY) {
    const event = drawRandomEvent();
    if (event) {
      actions.noteEventDrawn(event.id, EVENT_COOLDOWN_COUNT);
      applyEventEffects(event.effects, true);
      actions.log(`EVENT: ${event.title}`);
      fired.push({ event, kind: 'random' });
      if (AGENT_WRITE_EVENT_IDS.has(event.id)) {
        const leak = notifyAgentWrite();
        if (leak) fired.push(leak);
      }
      // New flags may arm a fuse the same day (e.g. injection while the
      // Champion is gone sets `compromised`). Schedule immediately so the
      // fuse length counts from the incident, not the next tick.
      scheduleFlagFuses();
    }
  }

  return fired;
}
