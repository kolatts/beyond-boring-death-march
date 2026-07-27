/**
 * Context Canyon (§7.3) — the packing puzzle, pure logic.
 *
 * A knapsack with VISIBLE values. The context bar has a fixed capacity;
 * every item shows its size and its relevance band (VITAL / USEFUL /
 * NOISE / DEAD WEIGHT) from the start. The puzzle is not discovery — it
 * is that the good stuff does not fit. Pack all ✓ items naively and you
 * overflow by ~30%; the three tools are how you resolve that, and they
 * ARE the lesson.
 *
 * One exception, for the joke: the ticket's relevance is rolled per
 * session and shows as DEPENDS until someone actually relies on it —
 * i.e. the band resolves the moment it is packed.
 *
 * Three tools, three tradeoffs (spec §7.3):
 *  - COMPACT: halves size, loses a random 15–25% of relevance. Compacting
 *    the item that carries THE REQUIREMENT rolls a 50% loss per pass, and
 *    once total compactions across the pile reach COMPACT_OVERUSE the
 *    requirement is lost regardless — silently, because summarisation is
 *    lossy compression with no error message. The loss surfaces at DEPART.
 *  - SUBAGENT: costs SCOUT_TOKENS tokens and one day; replaces a big item
 *    with a 1-slot summary at nearly full relevance. The correct answer
 *    most of the time; the scene celebrates the first useful scout.
 *  - RETRIEVE-ON-DEMAND: mark an item and leave it. Counts 60% of its
 *    relevance (retrieved eventually, but late), and every marked item
 *    the agent actually needs costs RETRIEVE_TOKENS at departure; three
 *    or more useful marks also cost a day. Cheap now, expensive later.
 *
 * Outcomes at DEPART:
 *  - score >= TIGHT_SCORE            -> "tight" (best rewards)
 *  - score >= PASS_SCORE             -> "pass"
 *  - requirement lost (any score)    -> "requirementLost" (compaction card)
 *  - otherwise                       -> "wrongProblem" ("the agent solves a
 *    problem you don't have, beautifully, in four files")
 * Overfilling never happens at DEPART — the walls close at pack time.
 *
 * All prose lives in src/content/context-items.json (spec §2).
 * Numeric tunables live here (config.ts is not this workstream's file).
 */

import raw from '../content/context-items.json';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export interface ScoutSummaryDef {
  name: string;
  relevance: number;
  blurb: string;
}

export interface ContextItemDef {
  id: string;
  name: string;
  size: number;
  /** Fixed relevance, or [min, max] rolled per session (the ticket). */
  relevance: number | [number, number];
  carriesRequirement?: boolean;
  scout?: ScoutSummaryDef;
  blurb: string;
  detail: string;
}

interface ContentFile {
  capacity: number;
  items: ContextItemDef[];
  strings: Record<string, string>;
}

const CONTENT = raw as unknown as ContentFile;

/** All §7.3 flavour prose, keyed. Scene reads these; none live in .ts. */
export const STRINGS: Record<string, string> = CONTENT.strings;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const CAPACITY = CONTENT.capacity;

/**
 * Items shown per run. The core nine always appear; the last slot rotates
 * through the remaining junk items in the JSON for variety across runs.
 */
export const POOL_SIZE = 10;
const CORE_IDS = new Set([
  'conventions_file',
  'failing_test',
  'changed_files',
  'api_docs',
  'ticket',
  'long_log',
  'chat_scrollback',
  'dir_listing',
  'node_modules',
]);

/** SUBAGENT: token cost per scout. Also costs one day (scene applies it). */
export const SCOUT_TOKENS = 6;
/** An item must be at least this big for a scout to be worth sending. */
export const SCOUTABLE_MIN_SIZE = 8;
/** Relevance retained by COMPACT: 1 - (0.15..0.25 loss). */
export const COMPACT_LOSS_MIN = 0.15;
export const COMPACT_LOSS_MAX = 0.25;
/** Chance each compaction of the requirement-carrier loses the requirement. */
export const COMPACT_REQ_LOSS_CHANCE = 0.5;
/** Total compactions (any items) at which the requirement is lost outright. */
export const COMPACT_OVERUSE = 5;
/** Retrieve-on-demand: tokens per marked-and-actually-relevant item. */
export const RETRIEVE_TOKENS = 4;
/** Marked items below this relevance were correctly left behind (no cost). */
export const RETRIEVE_RELEVANT_MIN = 40;
/** Marked-relevant items count this fraction of their relevance (late). */
export const RETRIEVE_VALUE_FACTOR = 0.6;
/** Marks that cost a retrieval; this many or more also cost a day. */
export const RETRIEVE_DELAY_AT = 3;
/** Overfill damage: the walls close (tokens burned, context bruised). */
export const OVERFLOW_TOKENS = 3;
export const OVERFLOW_CONTEXT = 4;
/** Departure outcome thresholds (see gold-pack math in evaluate()). */
export const PASS_SCORE = 420;
export const TIGHT_SCORE = 480;
/** Packed sub-USEFUL cargo (relevance < JUNK_RELEVANCE) dilutes the pack. */
export const JUNK_RELEVANCE = 40;
export const JUNK_PENALTY = 6;
/** A scout is "useful" (celebration + curriculum) at this summary relevance. */
export const SCOUT_USEFUL_MIN = 40;

/** Rewards / penalties, applied by the scene via actions.applyResourceDelta. */
export const OUTCOME_DELTAS = {
  tight: { tokens: 25, credibility: 6, context: -10 },
  pass: { tokens: 15, credibility: 3, context: -6 },
  wrongProblem: { tokens: -10, morale: -4 },
  requirementLost: { tokens: -6, morale: -3 },
} as const;

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type ItemState = 'pile' | 'packed' | 'marked';

export interface PackItem {
  def: ContextItemDef;
  /** Display name — swaps to the scout summary name after a scout. */
  name: string;
  size: number;
  /** Actual relevance this session (rolled ranges, compaction decay). */
  relevance: number;
  /**
   * Whether the relevance band is visible. True for every fixed-relevance
   * item from the start; false for rolled items (the ticket) until packed.
   */
  revealed: boolean;
  state: ItemState;
  compactions: number;
  /** True once replaced by its 1-slot scout summary. */
  isSummary: boolean;
  blurb: string;
}

export interface PackSession {
  items: PackItem[];
  capacity: number;
  /** Total compactions across all items (overuse tracking). */
  compactionsTotal: number;
  requirementLost: boolean;
  scoutsSent: number;
  overflows: number;
  /** Set once the first useful scout has been celebrated. */
  scoutCelebrated: boolean;
}

export type Rng = () => number;

/** The 10-item pool for this run: core nine + one rotating junk item. */
function pickPool(rng: Rng): ContextItemDef[] {
  const rotation = CONTENT.items.filter((d) => !CORE_IDS.has(d.id));
  const extras = new Set<string>();
  const want = Math.min(POOL_SIZE - CORE_IDS.size, rotation.length);
  while (extras.size < want) {
    const pick = rotation[Math.floor(rng() * rotation.length)];
    if (pick) extras.add(pick.id);
  }
  return CONTENT.items.filter((d) => CORE_IDS.has(d.id) || extras.has(d.id));
}

export function createSession(rng: Rng): PackSession {
  return {
    items: pickPool(rng).map((def) => ({
      def,
      name: def.name,
      size: def.size,
      relevance: Array.isArray(def.relevance)
        ? Math.round(def.relevance[0] + rng() * (def.relevance[1] - def.relevance[0]))
        : def.relevance,
      revealed: !Array.isArray(def.relevance),
      state: 'pile',
      compactions: 0,
      isSummary: false,
      blurb: def.blurb,
    })),
    capacity: CAPACITY,
    compactionsTotal: 0,
    requirementLost: false,
    scoutsSent: 0,
    overflows: 0,
    scoutCelebrated: false,
  };
}

export function packedSize(s: PackSession): number {
  return s.items.reduce((sum, i) => (i.state === 'packed' ? sum + i.size : sum), 0);
}

// ---------------------------------------------------------------------------
// Relevance bands (visible upfront; never colour alone in the scene)
// ---------------------------------------------------------------------------

export type Band = 'VITAL' | 'USEFUL' | 'NOISE' | 'DEAD WEIGHT' | 'DEPENDS';

export function bandOf(relevance: number): Band {
  if (relevance >= 80) return 'VITAL';
  if (relevance >= JUNK_RELEVANCE) return 'USEFUL';
  if (relevance >= 10) return 'NOISE';
  return 'DEAD WEIGHT';
}

/** The band the player sees: DEPENDS until a rolled item resolves. */
export function displayBand(item: PackItem): Band {
  return item.revealed ? bandOf(item.relevance) : 'DEPENDS';
}

export function sizeLabel(size: number): string {
  if (size >= 100) return 'CATASTROPHIC';
  if (size >= 12) return 'HUGE';
  if (size >= 7) return 'LARGE';
  if (size >= 3) return 'MEDIUM';
  return 'SMALL';
}

// ---------------------------------------------------------------------------
// Moves — each returns a small result the scene turns into feedback/costs.
// ---------------------------------------------------------------------------

export interface PackResult {
  ok: boolean;
  /** Slots over capacity when !ok — the walls close. */
  overBy: number;
  /** True when this pack resolved a DEPENDS item's band (the ticket). */
  resolved: boolean;
}

/** Try to pack an item. Overfill = immediate walls-close (never latent). */
export function tryPack(s: PackSession, item: PackItem): PackResult {
  if (item.state === 'packed') return { ok: false, overBy: 0, resolved: false };
  const would = packedSize(s) + item.size;
  if (would > s.capacity) {
    s.overflows += 1;
    return { ok: false, overBy: would - s.capacity, resolved: false };
  }
  item.state = 'packed';
  const resolved = !item.revealed;
  item.revealed = true; // packing is reliance; DEPENDS resolves here
  return { ok: true, overBy: 0, resolved };
}

export function unpack(item: PackItem): void {
  if (item.state === 'packed') item.state = 'pile';
}

export interface CompactResult {
  ok: boolean;
  relevanceLost: number;
  /** True the moment this compaction lost THE requirement. */
  requirementLostNow: boolean;
}

export function compact(s: PackSession, item: PackItem, rng: Rng): CompactResult {
  if (item.size <= 1) return { ok: false, relevanceLost: 0, requirementLostNow: false };
  item.size = Math.max(1, Math.ceil(item.size / 2));
  const lossFrac = COMPACT_LOSS_MIN + rng() * (COMPACT_LOSS_MAX - COMPACT_LOSS_MIN);
  const lost = Math.round(item.relevance * lossFrac);
  item.relevance = Math.max(0, item.relevance - lost);
  item.compactions += 1;
  s.compactionsTotal += 1;

  let requirementLostNow = false;
  if (!s.requirementLost) {
    const carrierHit = item.def.carriesRequirement === true && rng() < COMPACT_REQ_LOSS_CHANCE;
    const overuse = s.compactionsTotal >= COMPACT_OVERUSE;
    if (carrierHit || overuse) {
      s.requirementLost = true;
      requirementLostNow = true;
    }
  }
  return { ok: true, relevanceLost: lost, requirementLostNow };
}

export function canScout(item: PackItem): boolean {
  return !item.isSummary && item.def.scout !== undefined && item.def.size >= SCOUTABLE_MIN_SIZE;
}

export interface ScoutResult {
  ok: boolean;
  /** True when this scout should trigger the celebration + curriculum. */
  firstUseful: boolean;
  summaryRelevance: number;
}

/**
 * Send a subagent at a big item: it reads the noise in its own context and
 * the item becomes a 1-slot summary. Token/day costs are applied by the
 * scene (SCOUT_TOKENS + one day).
 */
export function scout(s: PackSession, item: PackItem): ScoutResult {
  const def = item.def.scout;
  if (!canScout(item) || !def) return { ok: false, firstUseful: false, summaryRelevance: 0 };
  item.isSummary = true;
  item.name = def.name;
  item.size = 1;
  item.relevance = def.relevance;
  item.blurb = def.blurb;
  item.revealed = true;
  s.scoutsSent += 1;
  const useful = def.relevance >= SCOUT_USEFUL_MIN;
  const firstUseful = useful && !s.scoutCelebrated;
  if (firstUseful) s.scoutCelebrated = true;
  return { ok: true, firstUseful, summaryRelevance: def.relevance };
}

/** Toggle retrieve-on-demand marking. Returns the new marked state. */
export function toggleMark(item: PackItem): boolean {
  if (item.state === 'packed') return false;
  item.state = item.state === 'marked' ? 'pile' : 'marked';
  return item.state === 'marked';
}

// ---------------------------------------------------------------------------
// Departure
// ---------------------------------------------------------------------------

export type Outcome = 'tight' | 'pass' | 'wrongProblem' | 'requirementLost';

export interface DepartResult {
  outcome: Outcome;
  score: number;
  /** Marked items the agent actually had to go back for. */
  retrievals: number;
  retrievalTokens: number;
  retrievalDays: number;
  /** Resource deltas for the scene to apply (retrieval costs included). */
  delta: { tokens?: number; credibility?: number; morale?: number; context?: number };
  /** Extra day cost: wrongProblem/requirementLost burn a day of rework. */
  reworkDays: number;
}

/**
 * Gold-pack math behind the thresholds (capacity 30, bands visible):
 *   The naive "pack everything ✓" set — conventions(2,95) + failing
 *   test(2,92) + changed files(6,90) + api docs(5,72) + raw log(14,80)
 *   + raw scrollback(10,64) — is 39 slots vs 30: over by 30%. Tools are
 *   the only way through.
 *   No tools at all: smalls(15 slots, 349) + raw log = 429 at 29/30 —
 *   scrapes past PASS (420), never TIGHT.
 *   One scout: smalls + scouted log(1,78) + raw scrollback(10,64) = 491
 *   at 26/30 -> TIGHT (480), with room left for the ticket.
 *   Two scouts: 487 at 17/30, most of the wagon still empty.
 * Sub-USEFUL cargo dilutes at JUNK_PENALTY per slot, so the 10-slot
 * directory listing (relevance 12) is net -48: visible-band junk is a
 * deliberate mistake, and it still hurts.
 */
export function evaluate(s: PackSession): DepartResult {
  let score = 0;
  let retrievals = 0;
  for (const item of s.items) {
    if (item.state === 'packed') {
      score += item.relevance;
      if (item.relevance < JUNK_RELEVANCE) score -= item.size * JUNK_PENALTY;
    } else if (item.state === 'marked' && item.relevance >= RETRIEVE_RELEVANT_MIN) {
      score += item.relevance * RETRIEVE_VALUE_FACTOR;
      retrievals += 1;
    }
  }
  score = Math.round(score);

  const retrievalTokens = retrievals * RETRIEVE_TOKENS;
  const retrievalDays = retrievals >= RETRIEVE_DELAY_AT ? 1 : 0;

  let outcome: Outcome;
  if (score < PASS_SCORE) outcome = 'wrongProblem';
  else if (s.requirementLost) outcome = 'requirementLost';
  else outcome = score >= TIGHT_SCORE ? 'tight' : 'pass';

  const base: { tokens?: number; credibility?: number; morale?: number; context?: number } =
    OUTCOME_DELTAS[outcome];
  const delta = { ...base, tokens: (base.tokens ?? 0) - retrievalTokens };
  const reworkDays = outcome === 'wrongProblem' || outcome === 'requirementLost' ? 1 : 0;

  return { outcome, score, retrievals, retrievalTokens, retrievalDays, delta, reworkDays };
}

// ---------------------------------------------------------------------------
// Persistent stats — localStorage `bbdm:contextpack` (Wave 3 economy hook)
// ---------------------------------------------------------------------------

export interface ContextPackStats {
  plays: number;
  departures: number;
  successes: number;
  overflows: number;
  requirementLosses: number;
  scoutsSent: number;
  bestScore: number;
}

const STATS_KEY = 'bbdm:contextpack';

const EMPTY_STATS: ContextPackStats = {
  plays: 0,
  departures: 0,
  successes: 0,
  overflows: 0,
  requirementLosses: 0,
  scoutsSent: 0,
  bestScore: 0,
};

export function loadStats(): ContextPackStats {
  try {
    const rawStats = window.localStorage.getItem(STATS_KEY);
    if (!rawStats) return { ...EMPTY_STATS };
    const parsed = JSON.parse(rawStats) as Partial<ContextPackStats>;
    return { ...EMPTY_STATS, ...parsed };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function saveStats(stats: ContextPackStats): void {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked: stats simply don't persist. Non-fatal.
  }
}
