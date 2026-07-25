/**
 * Outfitting Store simulation (spec §7.1).
 *
 * Pure derivation + shakedown math for OutfittingScene. No Phaser, no DOM.
 *
 * DERIVED-STAT FORMULA (the teaching device — the harness gates the model):
 *
 *   utilization = (toolBreadth + contextMgmt + recovery) / 30        // 0..1
 *   OUTPUT      = reasoning * (0.25 + 0.75 * utilization)            // /10
 *   SPEED       = speed * (0.2 + 0.8 * (toolBreadth + recovery)/20)  // /10
 *   ADHERENCE   = min(10, adherence + 0.5 * guardrails)              // /10
 *   COST/MILE   = costPerMile * (1 + 0.06 * (10 - recovery))         // tokens
 *   DETERMINISM = harness determinism, unmodified                    // /10
 *
 * Consequence (verified by the canonical ledger below): The Prodigy +
 * Bare API scores OUTPUT 2.5, SPEED 1.0, ADH 4.0, COST 14.4/mi while
 * The Workhorse + The Terminal Agent scores OUTPUT 4.3, SPEED 7.0,
 * ADH 10.0, COST 2.2/mi — the expensive genius in a wheelbarrow loses
 * on every measure except raw determinism.
 *
 * SHAKEDOWN (20 simulated miles, no real resources spent):
 *   milesPerDay = max(1, round(SPEED * 2))
 *   baseDays    = ceil(20 / milesPerDay)
 *   incidents   = clamp(round((10 - guardrails) / 3), 0, 4)
 *   recovery >= 6: incident self-recovers (+3 tokens each)
 *   recovery 3..5: incident costs a day (process rescue)
 *   recovery <  3: incident costs a day (a human pastes the stack trace)
 *   tokens      = round(20 * COST/MILE + 3 * autoRecovered)
 *   requirements met = clamp(round(ADHERENCE / 2), 0, 5)
 */

import rawModels from '../content/models.json';
import rawHarnesses from '../content/harnesses.json';
import rawOutfit from '../content/outfitting.json';
import type { RoleId } from '../config';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export interface ModelCard {
  id: string;
  name: string;
  reasoning: number;
  speed: number;
  costPerMile: number;
  adherence: number;
  blurb: string;
}

export interface HarnessCard {
  id: string;
  name: string;
  toolBreadth: number;
  contextMgmt: number;
  recovery: number;
  guardrails: number;
  determinism: number;
  blurb: string;
}

interface OutfittingContent {
  vpMarkup: number;
  prices: { models: Record<string, number>; harnesses: Record<string, number> };
  intro: { outfitting: string; harness_swap: string };
  roleFlavor: Record<RoleId, string>;
  lockedReason: string;
  notices: { purchase: string; scavenge: string; swap: string };
  shakedown: {
    boot: string[];
    progress: string[];
    compress: string;
    incidents: string[];
    autoRecover: string[];
    slowRescue: string[];
    handRescue: string[];
    drift: string[];
    literal: string[];
    complete: string;
    ledgerHead: string;
    ledgerRow: string;
  };
  swap: { head: string; keep: string };
}

export const MODELS: readonly ModelCard[] = rawModels as ModelCard[];
export const HARNESSES: readonly HarnessCard[] = rawHarnesses as HarnessCard[];
export const OUTFIT: OutfittingContent = rawOutfit as OutfittingContent;

export function modelById(id: string): ModelCard | undefined {
  return MODELS.find((m) => m.id === id);
}
export function harnessById(id: string): HarnessCard | undefined {
  return HARNESSES.find((h) => h.id === id);
}

// ---------------------------------------------------------------------------
// Derived stats
// ---------------------------------------------------------------------------

export interface DerivedStats {
  /** Reasoning delivered through the harness, /10. */
  output: number;
  /** Real-world pace, /10. */
  speed: number;
  /** Instruction adherence with guardrails enforcing, /10. */
  adherence: number;
  /** Effective tokens per mile (retries priced in). */
  costPerMile: number;
  /** Straight from the harness. The one stat Bare API wins. */
  determinism: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function deriveStats(m: ModelCard, h: HarnessCard): DerivedStats {
  const utilization = (h.toolBreadth + h.contextMgmt + h.recovery) / 30;
  return {
    output: round1(m.reasoning * (0.25 + 0.75 * utilization)),
    speed: round1(m.speed * (0.2 + 0.8 * (h.toolBreadth + h.recovery) / 20)),
    adherence: round1(Math.min(10, m.adherence + 0.5 * h.guardrails)),
    costPerMile: round1(m.costPerMile * (1 + 0.06 * (10 - h.recovery))),
    determinism: h.determinism,
  };
}

// ---------------------------------------------------------------------------
// Pricing (role rules, spec §5.2)
// ---------------------------------------------------------------------------

export interface PriceInfo {
  price: number;
  /** false only for the Contractor facing a non-free card (must scavenge). */
  selectable: boolean;
}

export function priceFor(kind: 'model' | 'harness', id: string, role: RoleId): PriceInfo {
  const table = kind === 'model' ? OUTFIT.prices.models : OUTFIT.prices.harnesses;
  const base = table[id] ?? 0;
  const price = role === 'vp' ? Math.ceil(base * OUTFIT.vpMarkup) : base;
  return { price, selectable: role === 'contractor' ? base === 0 : true };
}

// ---------------------------------------------------------------------------
// Shakedown simulation
// ---------------------------------------------------------------------------

export type LogTone = 'plain' | 'head' | 'ok' | 'warn' | 'fail';

export interface LogLine {
  text: string;
  tone: LogTone;
}

export interface ShakedownResult {
  days: number;
  tokens: number;
  incidents: number;
  autoRecovered: number;
  requirementsMet: number;
  lines: LogLine[];
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function pick(pool: readonly string[], rng: () => number): string {
  if (pool.length === 0) return '';
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? '';
}

/**
 * Simulate the 20-mile shakedown. Deterministic in the numbers; `rng` only
 * picks flavor-line variants (pass actions.rand for seeded runs, or
 * () => 0 for fully fixed output).
 */
export function runShakedown(m: ModelCard, h: HarnessCard, rng: () => number): ShakedownResult {
  const d = deriveStats(m, h);
  const sk = OUTFIT.shakedown;
  const milesPerDay = Math.max(1, Math.round(d.speed * 2));
  const baseDays = Math.ceil(20 / milesPerDay);
  const incidents = clamp(Math.round((10 - h.guardrails) / 3), 0, 4);
  const auto = h.recovery >= 6;
  const autoRecovered = auto ? incidents : 0;
  const lostDays = auto ? 0 : incidents;
  const days = baseDays + lostDays;
  const tokens = Math.round(20 * d.costPerMile + 3 * autoRecovered);
  const requirementsMet = clamp(Math.round(d.adherence / 2), 0, 5);

  const lines: LogLine[] = [];
  for (const b of sk.boot) {
    lines.push({ text: fill(b, { model: m.name, harness: h.name }), tone: 'head' });
  }

  // Day-by-day progress, compressed when the pair is slow.
  let traveled = 0;
  const dayLine = (day: number): void => {
    const miles = Math.min(milesPerDay, 20 - traveled);
    traveled += miles;
    lines.push({ text: fill(pick(sk.progress, rng), { day, miles }), tone: 'plain' });
  };
  if (baseDays > 4) {
    dayLine(1);
    dayLine(2);
    lines.push({
      text: fill(sk.compress, { from: 3, to: baseDays, miles: 20 - traveled }),
      tone: 'plain',
    });
    traveled = 20;
  } else {
    for (let day = 1; day <= baseDays; day++) dayLine(day);
  }

  // Incidents, spread along the route.
  for (let i = 0; i < incidents; i++) {
    const mile = 5 + i * 6;
    lines.push({ text: fill(pick(sk.incidents, rng), { mile }), tone: 'warn' });
    if (auto) {
      lines.push({ text: pick(sk.autoRecover, rng), tone: 'ok' });
    } else if (h.recovery >= 3) {
      lines.push({ text: pick(sk.slowRescue, rng), tone: 'fail' });
    } else {
      lines.push({ text: pick(sk.handRescue, rng), tone: 'fail' });
    }
  }

  if (m.adherence <= 5) lines.push({ text: pick(sk.drift, rng), tone: 'warn' });
  else if (m.adherence >= 9) lines.push({ text: pick(sk.literal, rng), tone: 'plain' });

  lines.push({
    text: fill(sk.complete, { days, tokens, met: requirementsMet }),
    tone: 'head',
  });

  return { days, tokens, incidents, autoRecovered, requirementsMet, lines };
}

/**
 * The teaching guarantee (§7.1): whatever the player picked, the ledger
 * shows the canonical comparison — The Prodigy + Bare API visibly
 * underperforming The Workhorse + The Terminal Agent.
 */
export function canonicalLedger(): LogLine[] {
  const rows: LogLine[] = [{ text: OUTFIT.shakedown.ledgerHead, tone: 'head' }];
  const pairs: [string, string, LogTone][] = [
    ['prodigy', 'bare_api', 'fail'],
    ['workhorse', 'terminal_agent', 'ok'],
  ];
  for (const [mid, hid, tone] of pairs) {
    const m = modelById(mid);
    const h = harnessById(hid);
    if (!m || !h) continue;
    const r = runShakedown(m, h, () => 0);
    rows.push({
      text: fill(OUTFIT.shakedown.ledgerRow, {
        pair: `${m.name} + ${h.name}`.toUpperCase(),
        days: r.days,
        tokens: r.tokens,
        met: r.requirementsMet,
      }),
      tone,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Loadout persistence — localStorage bbdm:outfitting (Wave 3 reads this).
// Flags model:<id> / harness:<id> are additive markers; this key is the
// authoritative current loadout (flags cannot be unset on harness swap).
// ---------------------------------------------------------------------------

const LOADOUT_KEY = 'bbdm:outfitting';
const LOADOUT_VERSION = 1;

export interface Loadout {
  v: number;
  modelId: string;
  harnessId: string;
  derived: DerivedStats;
  /** Set at Harness Hollow when the player swaps. */
  swappedFromHarnessId?: string;
}

export function loadLoadout(): Loadout | null {
  try {
    const raw = window.localStorage.getItem(LOADOUT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Loadout;
    if (data?.v !== LOADOUT_VERSION) return null;
    if (typeof data.modelId !== 'string' || typeof data.harnessId !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function saveLoadout(loadout: Omit<Loadout, 'v'>): void {
  try {
    window.localStorage.setItem(
      LOADOUT_KEY,
      JSON.stringify({ v: LOADOUT_VERSION, ...loadout }),
    );
  } catch {
    // Storage blocked: the run continues, Wave 3 falls back to defaults.
  }
}
