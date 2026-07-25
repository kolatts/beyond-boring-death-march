/**
 * cabSim — outcome distributions for THE CAB CROSSING (spec §7.5).
 *
 * Pure decision math: every function takes a `rand: () => number` (the
 * scene passes `actions.rand`, so results ride the run's seeded RNG and
 * are reproducible per save). No Phaser, no state imports — the scene
 * applies the returned deltas/days itself.
 *
 * EV NOTE (tuning intent, spec: "caulk is usually optimal — reward
 * noticing"): at average depth (~8.5 business days) FORD succeeds ~48%
 * of the time; a failure costs 2 Green Builds, 12 Credibility, 2 extra
 * days, and risks the Enhanced Delivery Oversight register. CAULK always
 * crosses, costs a flat 12 Tokens + 2 days, and its only downside is a
 * 10% minor scrape. FERRY is zero-risk but the CVE reclassification makes
 * the wait 21–75 days against a Day-120 doom clock. WAIT is free and
 * buys nothing. Caulk-and-float has the best expected value at any depth;
 * the game never says so out loud.
 *
 * DAYS → DOOM CLOCK CONTRACT (for the integration wave): the scene applies
 * days via `actions.advanceDay(n)` then calls `tickDeadlines()` ONCE —
 * the same documented simplification as `complyDeadline` in
 * systems/deadlines.ts. Crossing days are calendar time, not travel time:
 * no per-day token burn, no miles. The single tick reconciles the doom
 * clock (`businessDeadlineMissed`) and expires overdue surprise deadlines;
 * seed deadlines whose entire spawn window falls inside a long ferry wait
 * are skipped (you were at the dock; the memo never found you).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Rand = () => number;

export type CabChoice = 'ford' | 'caulk' | 'ferry' | 'wait';

/** Copy blocks in content/cab-crossing.json `outcomes`, played in order. */
export type CabBeat =
  | 'ford_success'
  | 'ford_failure'
  | 'ford_register'
  | 'caulk_success'
  | 'caulk_scrape'
  | 'ferry_file'
  | 'ferry_cve'
  | 'ferry_arrive'
  | 'wait';

/** Signed resource deltas (subset of the run's ResourceSet). */
export interface CabDelta {
  tokens?: number;
  greenBuilds?: number;
  credibility?: number;
  morale?: number;
  trust?: number;
}

export interface RiverState {
  /** Depth in business days. The measurement was taken by someone who is out this week. */
  depthDays: number;
  /** Index into content `conditions`. */
  conditionIndex: number;
}

export interface FerryPlan {
  /** The wait quoted when the Permit is filed. */
  firstWait: number;
  /** Day of the wait on which the CVE lands and the Permit is reclassified. */
  cveOnDay: number;
  /** The fresh full wait quoted after reclassification. */
  secondWait: number;
}

export interface CabOutcome {
  choice: CabChoice;
  /** False only for WAIT — the party is still on the near bank. */
  crossed: boolean;
  /** Calendar days consumed (see DAYS → DOOM CLOCK CONTRACT above). */
  days: number;
  delta: CabDelta;
  /** Party index placed on the Enhanced Delivery Oversight register, if any. */
  registerMemberIndex: number | null;
  /** Present on ferry outcomes; days === cveOnDay + secondWait. */
  ferry?: FerryPlan;
  beats: CabBeat[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const CAB = {
  /** Depth roll: 4–13 business days. */
  depth: { min: 4, span: 10 },
  ford: {
    days: 1,
    failExtraDays: 2,
    /** P(success) = clamp(base - depth * perDepthDay, min, 1). */
    baseChance: 0.9,
    perDepthDay: 0.05,
    minChance: 0.25,
    success: { credibility: 2 } as CabDelta,
    failure: { greenBuilds: -2, credibility: -12 } as CabDelta,
    /** On failure: chance a party member lands on the EDO register. */
    registerChance: 0.5,
    register: { morale: -8, trust: -1 } as CabDelta,
  },
  caulk: {
    tokens: 12,
    days: 2,
    scrapeChance: 0.1,
    scrapeExtraDays: 1,
    scrape: { credibility: -4 } as CabDelta,
  },
  ferry: {
    /** Each quoted wait: 15–45 days. */
    waitMin: 15,
    waitSpan: 31,
    /** CVE lands 40–70% of the way through the first wait. */
    cveFracMin: 0.4,
    cveFracSpan: 0.3,
  },
  wait: {
    /** 4–7 days of conditions not improving. */
    daysMin: 4,
    daysSpan: 4,
    /** A second party fords it successfully. Everyone notices. */
    morale: -10,
  },
} as const;

// ---------------------------------------------------------------------------
// Rolls
// ---------------------------------------------------------------------------

function rollInt(rand: Rand, min: number, span: number): number {
  return min + Math.floor(rand() * span);
}

/** Roll the river for this visit: depth + a conditions line. */
export function rollRiver(rand: Rand, conditionCount: number): RiverState {
  return {
    depthDays: rollInt(rand, CAB.depth.min, CAB.depth.span),
    conditionIndex: Math.floor(rand() * Math.max(1, conditionCount)),
  };
}

export function fordSuccessChance(depthDays: number): number {
  const p = CAB.ford.baseChance - depthDays * CAB.ford.perDepthDay;
  return Math.min(1, Math.max(CAB.ford.minChance, p));
}

/**
 * FORD IT — fast, high variance. `registerCandidates` are party indices
 * eligible for the Enhanced Delivery Oversight register (alive, not the
 * player); pass [] and nobody can be registered.
 */
export function resolveFord(
  river: RiverState,
  rand: Rand,
  registerCandidates: readonly number[],
): CabOutcome {
  if (rand() < fordSuccessChance(river.depthDays)) {
    return {
      choice: 'ford',
      crossed: true,
      days: CAB.ford.days,
      delta: { ...CAB.ford.success },
      registerMemberIndex: null,
      beats: ['ford_success'],
    };
  }
  const registered =
    registerCandidates.length > 0 && rand() < CAB.ford.registerChance
      ? registerCandidates[Math.floor(rand() * registerCandidates.length)] ?? null
      : null;
  const delta: CabDelta = { ...CAB.ford.failure };
  if (registered !== null) {
    delta.morale = (delta.morale ?? 0) + (CAB.ford.register.morale ?? 0);
    delta.trust = (delta.trust ?? 0) + (CAB.ford.register.trust ?? 0);
  }
  return {
    choice: 'ford',
    crossed: true, // you do get across; wetter and poorer
    days: CAB.ford.days + CAB.ford.failExtraDays,
    delta,
    registerMemberIndex: registered,
    beats: registered !== null ? ['ford_failure', 'ford_register'] : ['ford_failure'],
  };
}

/** CAULK AND FLOAT — feature-flag it, ship dark. Always crosses. */
export function resolveCaulk(rand: Rand): CabOutcome {
  const scrape = rand() < CAB.caulk.scrapeChance;
  return {
    choice: 'caulk',
    crossed: true,
    days: CAB.caulk.days + (scrape ? CAB.caulk.scrapeExtraDays : 0),
    delta: scrape
      ? { tokens: -CAB.caulk.tokens, ...CAB.caulk.scrape }
      : { tokens: -CAB.caulk.tokens },
    registerMemberIndex: null,
    beats: scrape ? ['caulk_scrape'] : ['caulk_success'],
  };
}

/**
 * TAKE THE FERRY — file the Permit. Zero resource risk; the cost is
 * calendar. Mid-wait a dependency publishes a CVE, the Permit is
 * reclassified, and the clock resets in full.
 */
export function resolveFerry(rand: Rand): CabOutcome {
  const firstWait = rollInt(rand, CAB.ferry.waitMin, CAB.ferry.waitSpan);
  const frac = CAB.ferry.cveFracMin + rand() * CAB.ferry.cveFracSpan;
  const cveOnDay = Math.max(1, Math.floor(firstWait * frac));
  const secondWait = rollInt(rand, CAB.ferry.waitMin, CAB.ferry.waitSpan);
  return {
    choice: 'ferry',
    crossed: true,
    days: cveOnDay + secondWait,
    delta: {},
    registerMemberIndex: null,
    ferry: { firstWait, cveOnDay, secondWait },
    beats: ['ferry_file', 'ferry_cve', 'ferry_arrive'],
  };
}

/** WAIT FOR CONDITIONS TO IMPROVE — free. Nothing improves. */
export function resolveWait(rand: Rand): CabOutcome {
  return {
    choice: 'wait',
    crossed: false,
    days: rollInt(rand, CAB.wait.daysMin, CAB.wait.daysSpan),
    delta: { morale: CAB.wait.morale },
    registerMemberIndex: null,
    beats: ['wait'],
  };
}

// ---------------------------------------------------------------------------
// Per-run-adjacent persistence — localStorage `bbdm:cab`
// ---------------------------------------------------------------------------
// Documented for the integration wave (see the report):
//   { v: 1, floats: <successful caulk-and-float count, cross-run>,
//     featureFlagsCardShown: <bool>, register: <names ever placed on EDO> }

const CAB_KEY = 'bbdm:cab';
const CAB_STORE_VERSION = 1;

export interface CabStore {
  v: number;
  /** Successful (non-scrape) caulk-and-float crossings, across runs. */
  floats: number;
  /** The feature_flags Curriculum Card fires once, on the second float. */
  featureFlagsCardShown: boolean;
  /** Names placed on the Enhanced Delivery Oversight register. */
  register: string[];
}

export function readCabStore(): CabStore {
  const empty: CabStore = { v: CAB_STORE_VERSION, floats: 0, featureFlagsCardShown: false, register: [] };
  try {
    const raw = window.localStorage.getItem(CAB_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CabStore>;
    if (parsed.v !== CAB_STORE_VERSION) return empty;
    return {
      v: CAB_STORE_VERSION,
      floats: typeof parsed.floats === 'number' ? parsed.floats : 0,
      featureFlagsCardShown: parsed.featureFlagsCardShown === true,
      register: Array.isArray(parsed.register)
        ? parsed.register.filter((n): n is string => typeof n === 'string')
        : [],
    };
  } catch {
    return empty;
  }
}

export function writeCabStore(store: CabStore): void {
  try {
    window.localStorage.setItem(CAB_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked: the count simply doesn't persist. Non-fatal.
  }
}
