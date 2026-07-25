/**
 * Night Watch simulation (§7.6) — pure resolution of a workflow card into
 * one of the five morning outcomes. The scene applies the result through
 * state actions; nothing here mutates state.
 *
 * Classification (checked in order — first match wins):
 *  1. trigger `manual`                      -> NOTHING (nobody is awake to trigger it)
 *  2. output can fire its own trigger       -> RECURSION
 *     (comment -> comment, or open-pr -> issue-opened; PRs are issues,
 *      which is true, which is the joke)
 *  3. permissions `everything` + no cap     -> RAID (safe-outputs are a
 *     polite fiction when the permissions say everything)
 *  4. no budget cap                         -> BILL (it worked; hourly; uncapped)
 *  5. otherwise                             -> SUCCESS, graded by safe-output
 *
 * Persistence: localStorage `bbdm:nightwatch` (see NightWatchRecord).
 * Wave 3 reads it for the OVERNIGHT TRAVEL trail benefit: `unlocked` is
 * only honored while `budget` is not 'none' (the gate the spec demands),
 * and `uncappedSpend` feeds the Production score penalty for the BILL
 * outcome.
 */

import modelsRaw from '../content/models.json';
import harnessesRaw from '../content/harnesses.json';

// ---------------------------------------------------------------------------
// Card types
// ---------------------------------------------------------------------------

export type NightTrigger = 'schedule' | 'issue-opened' | 'ci-failure' | 'comment' | 'manual';
export type NightPermissions = 'read-only' | 'contents:write' | 'everything';
export type NightSafeOutput = 'comment' | 'open-pr' | 'push-to-main';
export type NightBudget = 'both' | 'max-turns' | 'max-spend' | 'none';

export const TRIGGER_OPTIONS: readonly NightTrigger[] = [
  'schedule',
  'issue-opened',
  'ci-failure',
  'comment',
  'manual',
];
export const PERMISSION_OPTIONS: readonly NightPermissions[] = [
  'read-only',
  'contents:write',
  'everything',
];
export const OUTPUT_OPTIONS: readonly NightSafeOutput[] = ['comment', 'open-pr', 'push-to-main'];
export const BUDGET_OPTIONS: readonly NightBudget[] = ['both', 'max-turns', 'max-spend', 'none'];

export const BUDGET_LABELS: Record<NightBudget, string> = {
  both: 'max-turns: 30 · max-spend: 40',
  'max-turns': 'max-turns: 30',
  'max-spend': 'max-spend: 40',
  none: '(none)',
};

export interface WorkflowCard {
  trigger: NightTrigger;
  permissions: NightPermissions;
  /** Display label only — the outfitting loadout, or the default pair. */
  engine: string;
  safeOutput: NightSafeOutput;
  budget: NightBudget;
  bodyId: string;
}

export function hasBudgetCap(card: WorkflowCard): boolean {
  return card.budget !== 'none';
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type NightOutcomeKind = 'success' | 'nothing' | 'raid' | 'recursion' | 'bill';

export interface NightResolution {
  kind: NightOutcomeKind;
  capped: boolean;
  /** Signed miles applied at morning (negative = the wrong direction). */
  miles: number;
  /** Signed resource deltas applied at morning. */
  delta: {
    tokens: number;
    trust: number;
    greenBuilds: number;
    morale: number;
    credibility: number;
  };
  /** Tokens actually burned overnight (for the BILL score penalty). */
  spend: number;
  /** SUCCESS with a valid cap unlocks OVERNIGHT TRAVEL. */
  unlocksOvernight: boolean;
  /** Which success report to show: the safe-output key. */
  reportVariant: NightSafeOutput;
  /** SUCCESS with permissions:everything gets the nervous footnote. */
  cautionEverything: boolean;
}

const ZERO_DELTA = { tokens: 0, trust: 0, greenBuilds: 0, morale: 0, credibility: 0 };

export function classifyCard(card: WorkflowCard): NightOutcomeKind {
  if (card.trigger === 'manual') return 'nothing';
  if (
    (card.trigger === 'comment' && card.safeOutput === 'comment') ||
    (card.trigger === 'issue-opened' && card.safeOutput === 'open-pr')
  ) {
    return 'recursion';
  }
  if (card.permissions === 'everything' && !hasBudgetCap(card)) return 'raid';
  if (!hasBudgetCap(card)) return 'bill';
  return 'success';
}

/**
 * Resolve one night. `currentTokens` lets the uncapped recursion consume
 * the whole reserve (minus the five in your other coat) without killing
 * the party inside the scene — the trail economy owns starvation.
 */
export function resolveNight(card: WorkflowCard, currentTokens: number): NightResolution {
  const kind = classifyCard(card);
  const capped = hasBudgetCap(card);

  switch (kind) {
    case 'nothing':
      return {
        kind,
        capped,
        miles: 0,
        delta: { ...ZERO_DELTA, tokens: -2 },
        spend: 2,
        unlocksOvernight: false,
        reportVariant: card.safeOutput,
        cautionEverything: false,
      };
    case 'recursion': {
      const spend = capped ? Math.min(40, Math.max(0, currentTokens - 5)) : Math.max(0, currentTokens - 5);
      return {
        kind,
        capped,
        miles: 0,
        delta: { ...ZERO_DELTA, tokens: -spend, morale: capped ? -4 : -8 },
        spend,
        unlocksOvernight: false,
        reportVariant: card.safeOutput,
        cautionEverything: false,
      };
    }
    case 'raid':
      return {
        kind,
        capped,
        miles: -80,
        delta: { tokens: -35, trust: -1, greenBuilds: -1, morale: -10, credibility: -8 },
        spend: 35,
        unlocksOvernight: false,
        reportVariant: card.safeOutput,
        cautionEverything: false,
      };
    case 'bill':
      return {
        kind,
        capped,
        miles: 30,
        delta: { ...ZERO_DELTA, tokens: -45 },
        spend: 45,
        unlocksOvernight: false,
        reportVariant: card.safeOutput,
        cautionEverything: false,
      };
    case 'success': {
      const byOutput: Record<NightSafeOutput, { miles: number; tokens: number; credibility: number }> = {
        comment: { miles: 40, tokens: -12, credibility: 4 },
        'open-pr': { miles: 30, tokens: -15, credibility: 2 },
        'push-to-main': { miles: 20, tokens: -15, credibility: 0 },
      };
      const grade = byOutput[card.safeOutput];
      return {
        kind,
        capped,
        miles: grade.miles,
        delta: { ...ZERO_DELTA, tokens: grade.tokens, credibility: grade.credibility },
        spend: -grade.tokens,
        unlocksOvernight: true,
        reportVariant: card.safeOutput,
        cautionEverything: card.permissions === 'everything',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence — localStorage `bbdm:nightwatch`
// ---------------------------------------------------------------------------

export const NIGHTWATCH_KEY = 'bbdm:nightwatch';

/**
 * What Wave 3 integrates:
 *  - `unlocked` + `budget !== 'none'` -> the OVERNIGHT TRAVEL trail benefit
 *    (bank miles between landmarks). If a later system invalidates the cap,
 *    set `budget: 'none'` and the benefit lapses.
 *  - `uncappedSpend` -> cumulative tokens burned by uncapped nights; the
 *    Production score screen scales its penalty with this number.
 *  - `lastOutcome`, `card` -> flavor/reporting only.
 */
export interface NightWatchRecord {
  v: 1;
  unlocked: boolean;
  budget: NightBudget;
  lastOutcome: NightOutcomeKind;
  uncappedSpend: number;
  card: WorkflowCard;
}

export function loadNightWatchRecord(): NightWatchRecord | null {
  try {
    const raw = window.localStorage.getItem(NIGHTWATCH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as NightWatchRecord;
    if (data?.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveNightWatchRecord(record: NightWatchRecord): void {
  try {
    window.localStorage.setItem(NIGHTWATCH_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: the unlock still lives in the run flags.
  }
}

// ---------------------------------------------------------------------------
// Engine label — the outfitting loadout, read defensively
// ---------------------------------------------------------------------------

interface NamedCard {
  id: string;
  name: string;
}

const MODELS = modelsRaw as NamedCard[];
const HARNESSES = harnessesRaw as NamedCard[];

const DEFAULT_ENGINE = 'The Workhorse + The Terminal Agent';

/** Collect every string value in an unknown JSON structure (bounded). */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length > 64) return;
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
}

/**
 * The engine line on the card: the player's outfitting loadout from
 * localStorage `bbdm:outfitting` when present (whatever shape the
 * Outfitting scene chose — any string matching a model/harness id or name
 * counts), else the default pair.
 */
export function engineLabel(): string {
  try {
    const raw = window.localStorage.getItem('bbdm:outfitting');
    if (!raw) return DEFAULT_ENGINE;
    const strings: string[] = [];
    collectStrings(JSON.parse(raw), strings);
    const lowered = strings.map((s) => s.toLowerCase());
    const match = (cards: NamedCard[]): NamedCard | undefined =>
      cards.find((c) => lowered.includes(c.id) || lowered.includes(c.name.toLowerCase()));
    const model = match(MODELS);
    const harness = match(HARNESSES);
    if (model || harness) {
      return `${model?.name ?? 'The Workhorse'} + ${harness?.name ?? 'The Terminal Agent'}`;
    }
    return DEFAULT_ENGINE;
  } catch {
    return DEFAULT_ENGINE;
  }
}
