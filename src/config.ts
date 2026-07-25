/**
 * Central tunables for BEYOND BORING: DEATH MARCH.
 *
 * Everything numeric that a designer might want to nudge lives here.
 * Prose does NOT live here — copy belongs in /src/content/*.json.
 */

/** Logical canvas resolution (Apple IIgs-era, spec §13). */
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 200;

/**
 * Supersample factor for the real canvas backing store (mobile pass).
 *
 * The game still THINKS in 320x200 — every scene positions objects in
 * logical pixels — but the canvas renders at 4x (1280x800) with every
 * scene camera zoomed 4x (see ui/text.ts). Sprites keep their chunky
 * nearest-neighbour look (one logical pixel = a crisp 4x4 block, exactly
 * what CSS upscaling produced before); text objects render their glyph
 * canvases at matching resolution so type is sharp instead of 320x200-
 * decimated mush. 4x means the backing store roughly matches device
 * pixels on both a 390px-wide phone at DPR 3 (1170) and a 1280 desktop.
 */
export const RENDER_SCALE = 4;

/** Minimum touch-target size, in device (CSS) pixels, for coarse pointers. */
export const MIN_TOUCH_PX = 44;

/** The trail. Legacy Junction to Production. */
export const TOTAL_MILES = 2000;

/**
 * The doom clock. Go-live is Day 120. The date was chosen at an offsite.
 * It predates the estimate. Passing it does NOT end the game — it sets the
 * `businessDeadlineMissed` flag, which the Production endgame consumes as
 * the "compliance victory" ending.
 */
export const BUSINESS_DEADLINE_DAY = 120;
/** Doom clock turns orange (warn) when this many days remain; violet when missed. */
export const DOOM_WARN_DAYS = 20;

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

export type Pace = 'careful' | 'steady' | 'grueling';

export interface PaceConfig {
  label: string;
  milesPerDay: number;
  /** Multiplier on the per-mile token burn (retries under pressure cost more). */
  tokenMultiplier: number;
  /** Morale drift per travel day at this pace. */
  moralePerDay: number;
  /** Context fill per travel day at this pace. */
  contextPerDay: number;
}

export const PACE_ORDER: readonly Pace[] = ['careful', 'steady', 'grueling'];

export const PACES: Record<Pace, PaceConfig> = {
  careful: { label: 'CAREFUL', milesPerDay: 10, tokenMultiplier: 0.8, moralePerDay: 0.5, contextPerDay: 1 },
  steady: { label: 'STEADY', milesPerDay: 14, tokenMultiplier: 1.0, moralePerDay: -0.5, contextPerDay: 2 },
  grueling: { label: 'GRUELING', milesPerDay: 20, tokenMultiplier: 1.4, moralePerDay: -1.5, contextPerDay: 3 },
};

// ---------------------------------------------------------------------------
// Resource economy
// ---------------------------------------------------------------------------

/** Tokens burned per mile traveled, before the pace multiplier. */
export const TOKENS_PER_MILE = 0.15;

/** A rest day: no miles, small token burn, morale up, context compacted. */
export const REST = { tokens: 2, morale: 6, context: -10 } as const;

/** Trust at zero: every tool call approved by hand. Travel crawls. (§5.3) */
export const TRUST_ZERO_MILES_PER_DAY = 4;

/** Context window capacity. Overflow triggers rework (§5.3). */
export const CONTEXT_MAX = 100;

/** Context overflow consequence: the agent confidently rebuilds the wrong thing. */
export const CONTEXT_OVERFLOW_REWORK = { days: 1, morale: -6, contextAfter: 60 } as const;

/** Morale at zero: a party member leaves (for a startup), morale resets here. */
export const MORALE_COLLAPSE_RESET = 25;

/** Tokens granted on landmark arrival ("requisition approved"). Keeps a
 * well-paced run solvent; a badly paced one still starves. */
export const LANDMARK_RESUPPLY_TOKENS = 20;

// ---------------------------------------------------------------------------
// Events & surprise deadlines (Wave 3 — §8, DECISIONS.md weight-0 rule)
// ---------------------------------------------------------------------------

/** Chance a random event is drawn on a travel day (rest days are quiet). */
export const EVENT_CHANCE_PER_TRAVEL_DAY = 0.3;

/** Recently drawn event ids excluded from the random pool (variety cap). */
export const EVENT_COOLDOWN_COUNT = 8;

/** Days after the `compromised` flag before THE SECRET SURFACES fires. */
export const COMPROMISED_FUSE_DAYS = { min: 3, span: 4 } as const;

/** Miles after the `hollow_green` flag before THE GREEN THAT WASN'T fires
 * ("discovered at mile +200", spec §8.2). */
export const HOLLOW_GREEN_DISCOVERY_MILES = 200;

/** Surprise-deadline spawning (systems/deadlines.ts, content deadlines.json). */
export const DEADLINE_SPAWN_CHANCE_PER_DAY = 0.14;
export const DEADLINE_SPAWN_MIN_DAY = 4;
export const DEADLINE_SPAWN_COOLDOWN_DAYS = 5;
export const DEADLINE_MAX_ACTIVE = 2;

/** BUY EXCEPTION: credibility spent to make a surprise deadline someone
 * else's finding. The exception is granted; the register remembers. */
export const EXCEPTION_CREDIBILITY_COST = 12;

/** HUNT (Bug Hunt from the Trail menu) costs a day — consistent with
 * quarantine/comply's advanceDay simplification: focused work burns days,
 * not miles. */
export const HUNT_COST_DAYS = 1;

// ---------------------------------------------------------------------------
// Outfitting economy wiring (Wave 3 reads localStorage bbdm:outfitting)
// ---------------------------------------------------------------------------

/**
 * Reference derived stats = The Workhorse + The Terminal Agent (the
 * canonical ledger pair in outfittingSim). A loadout's derived stats are
 * normalized against these so the default loadout changes nothing.
 */
export const OUTFIT_REFERENCE = { speed: 7.0, costPerMile: 2.2 } as const;

/** Clamps on the outfitting multipliers so no loadout breaks the economy. */
export const OUTFIT_SPEED_CLAMP = { min: 0.5, max: 1.6 } as const;
export const OUTFIT_COST_CLAMP = { min: 0.4, max: 3.0 } as const;

/**
 * Instruction adherence damps BAD random-event severity (the agent follows
 * the runbook when things go sideways): each derived-adherence point above
 * ADHERENCE_DAMP_FLOOR shaves ADHERENCE_DAMP_PER_POINT off negative event
 * deltas, capped at ADHERENCE_DAMP_MAX. Small and documented (§5.4 brief).
 */
export const ADHERENCE_DAMP_FLOOR = 6;
export const ADHERENCE_DAMP_PER_POINT = 0.04;
export const ADHERENCE_DAMP_MAX = 0.16;

/** Overnight travel (Night Watch unlock): miles banked per travel night
 * while `overnightTravel` flag + bbdm:nightwatch { unlocked, budget!=='none' }
 * hold. Burns tokens at the normal per-mile rate (no pace multiplier —
 * the night loop does not hurry). */
export const OVERNIGHT_MILES_PER_NIGHT = 6;

// ---------------------------------------------------------------------------
// Roles (§5.2)
// ---------------------------------------------------------------------------

export type RoleId = 'vp' | 'staff' | 'contractor';

export interface ResourceSet {
  tokens: number;
  context: number;
  trust: number;
  greenBuilds: number;
  morale: number;
  credibility: number;
}

export interface RoleConfig {
  id: RoleId;
  name: string;
  scoreMultiplier: number;
  /** Contractor constraint: cannot purchase at the Outfitting Store. */
  canPurchase: boolean;
  starting: ResourceSet;
  /** One line for the role-select screen. TODO: move to content JSON in a later wave. */
  tagline: string;
}

export const ROLES: Record<RoleId, RoleConfig> = {
  vp: {
    id: 'vp',
    name: 'VP OF ADJACENT CONCERNS',
    scoreMultiplier: 1,
    canPurchase: true,
    starting: { tokens: 400, context: 0, trust: 5, greenBuilds: 4, morale: 65, credibility: 10 },
    tagline: 'Enormous budget. Zero credibility with anyone who writes code.',
  },
  staff: {
    id: 'staff',
    name: 'STAFF ENGINEER',
    scoreMultiplier: 2,
    canPurchase: true,
    starting: { tokens: 250, context: 0, trust: 4, greenBuilds: 3, morale: 60, credibility: 40 },
    tagline: 'Knows where the forms are. This is why they can never leave.',
  },
  contractor: {
    id: 'contractor',
    name: 'CONTRACTOR, 6-WEEK SOW',
    scoreMultiplier: 3,
    canPurchase: false,
    starting: { tokens: 150, context: 0, trust: 2, greenBuilds: 1, morale: 55, credibility: 25 },
    tagline: 'No budget. No admin rights. Laptop arrives week 4.',
  },
};

export const ROLE_ORDER: readonly RoleId[] = ['vp', 'staff', 'contractor'];

// ---------------------------------------------------------------------------
// Party (§5.4)
// ---------------------------------------------------------------------------

export type Specialization = 'you' | 'junior' | 'principal' | 'security' | 'scrum';

export interface PartySlot {
  specialization: Specialization;
  title: string;
  defaultName: string;
}

/** Five slots. The player (slot 0) always survives to the tombstone screen. */
export const PARTY_TEMPLATE: readonly PartySlot[] = [
  { specialization: 'you', title: 'Accountable For All Of It', defaultName: 'You' },
  { specialization: 'junior', title: 'The Junior', defaultName: 'Kit' },
  { specialization: 'principal', title: 'The Skeptical Principal', defaultName: 'Rosa' },
  { specialization: 'security', title: 'The Security Champion', defaultName: 'Deniz' },
  { specialization: 'scrum', title: 'The Scrum Master', defaultName: 'Marcus' },
];

// ---------------------------------------------------------------------------
// Dev fast mode
// ---------------------------------------------------------------------------

/**
 * DEV SPEED CONTROL — for playtest agents.
 *
 * Add `?fast=1` to the URL to batch 10 in-game days per Travel/Rest press,
 * or `?fast=N` (N > 1, capped at 100) for N days per press. Batching stops
 * early at a landmark, a death, or mile 2000, so nothing is skipped —
 * every batched day runs the full economy tick.
 *
 * At runtime, the F key on the Trail screen toggles fast mode on/off
 * (using the same multiplier). Fast mode multiplies days-per-press only;
 * it never changes the economy itself, so a fast run and a slow run with
 * the same inputs land on identical numbers.
 */
export function fastModeMultiplier(): number {
  const raw = new URLSearchParams(window.location.search).get('fast');
  if (raw === null) return 1;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1) return Math.min(Math.floor(n), 100);
  return 10;
}
