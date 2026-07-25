/**
 * Bug Hunt simulation (§7.4) — pure logic, no Phaser, no global state.
 *
 * BugHuntScene owns a HuntState and drives it through these functions;
 * everything here is deterministic given the injected `rand` (the scene
 * passes `actions.rand`, the seeded run RNG).
 *
 * Approved simplification (DECISIONS.md): GRID-BASED MOVEMENT. The repo
 * terrain is a fixed 20x10 tile grid, the player steps one tile at a time
 * in 8 directions, no smooth-scrolling camera.
 *
 * The fauna table (spec §7.4):
 *  - SYMPTOMS: everywhere, easy to hit (adjacency-tolerant ray), worth
 *    almost nothing. Fixing one respawns two. Visibly. That is the lesson.
 *  - ROOT CAUSES: rare, camouflaged as ordinary files, RELOCATE when
 *    observed (player approaches or aims down their line). Exact hit only.
 *    Worth big tokens.
 *  - THE FLAKY TEST: cannot be killed. A shot passes through (wasted tool
 *    call) and it returns elsewhere. Quarantining costs a FULL DAY.
 *  - THE FRIENDLY TRADE ROUTE: a prompt-injected MCP server dressed as
 *    friendly wildlife. Stepping adjacent lets it read your .env (token
 *    loss + `compromised` flag) — unless the Security Champion is alive,
 *    who shouts a warning at distance and halves the damage if you insist.
 *  - STALE TODOs: graze peacefully. Decorative, but baggable.
 *
 * TOOL CALLS (bullets) persist across visits in localStorage `bbdm:bughunt`
 * and regenerate slowly in real time (1 per TOOL_CALL_REGEN_MS elapsed).
 *
 * SUMMARY QUALITY HEURISTIC — see scoreSummary() jsdoc. Documented there
 * and in the build report.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const GRID_COLS = 20;
export const GRID_ROWS = 10;
/** Tile size in logical pixels (grid is 320x160 inside the 320x200 frame). */
export const TILE = 16;

/** The punchline number. 100 lbs. Because that's your context window. */
export const CARRY_CAPACITY_LBS = 100;

export const TOOL_CALLS_MAX = 12;
/** The Junior's assist (§5.4): +2 tool calls in Bug Hunt, session-only. */
export const JUNIOR_BONUS_CALLS = 2;
/** One tool call regenerates per this many real milliseconds away. */
export const TOOL_CALL_REGEN_MS = 75_000;

/** Tool-call ray length in tiles. */
export const FIRE_RANGE = 7;

/** Tokens the trade route drains when it reads your .env (halved if the
 * Security Champion is alive — §5.4 halve-injection-damage assist). */
export const ENV_DRAIN_TOKENS = 30;

/** Root cause: how many times it relocates before it settles (still
 * camouflaged, but finally pinnable). */
export const ROOT_CAUSE_RELOCATES = 3;
/** Observation radius (chebyshev) that spooks a root cause. */
export const OBSERVE_RADIUS = 3;
/** Aiming down a root cause's line within this range also spooks it. */
export const OBSERVE_AIM_RANGE = 5;

export const SYMPTOM_START_COUNT = 6;
/** Symptom population cap, so the joke can't fill every tile. */
export const SYMPTOM_CAP = 22;

/** Economy retune 2026-07-25 (docs/DECISIONS.md): Bug Hunt is the
 * designed income valve, but it netted ~break-even after its 1-day cost.
 * Root cause 45 -> 63 (+40%); symptom 2 -> 3; TODO 1 -> 2. */
export const CREATURE_STATS = {
  symptom: { weightLbs: 15, baseTokens: 3 },
  rootCause: { weightLbs: 90, baseTokens: 63 },
  flakyTest: { weightLbs: 30, baseTokens: 10 },
  todo: { weightLbs: 5, baseTokens: 2 },
} as const;

// ---------------------------------------------------------------------------
// Terrain: directories as regions of the grid
// ---------------------------------------------------------------------------

export interface TerrainRegion {
  id: 'src' | 'tests' | 'docs' | 'legacy' | 'node_modules' | 'scripts';
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Covers the full 20x10 grid, no gaps, no overlap. */
export const TERRAIN_REGIONS: readonly TerrainRegion[] = [
  { id: 'src', col: 0, row: 0, cols: 8, rows: 5 },
  { id: 'tests', col: 8, row: 0, cols: 6, rows: 4 },
  { id: 'docs', col: 14, row: 0, cols: 6, rows: 3 },
  { id: 'legacy', col: 0, row: 5, cols: 7, rows: 5 },
  { id: 'node_modules', col: 7, row: 4, cols: 7, rows: 6 },
  { id: 'scripts', col: 14, row: 3, cols: 6, rows: 7 },
];

export function regionAt(col: number, row: number): TerrainRegion | undefined {
  return TERRAIN_REGIONS.find(
    (r) => col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cell {
  col: number;
  row: number;
}

export type CreatureKind = 'symptom' | 'rootCause' | 'flakyTest' | 'tradeRoute' | 'todo';

export interface Creature {
  id: number;
  kind: CreatureKind;
  col: number;
  row: number;
  alive: boolean;
  /** Flaky test only: phased out after a wasted shot, returns later. */
  hidden: boolean;
  /** Root cause only: relocations remaining before it settles. */
  relocatesLeft: number;
  /** Trade route only: the Security Champion has called it out. */
  revealed: boolean;
}

export interface Finding {
  id: number;
  kind: CreatureKind | 'quarantine';
  weightLbs: number;
  baseTokens: number;
}

export interface HuntState {
  player: Cell;
  facing: { dx: number; dy: number };
  creatures: Creature[];
  findings: Finding[];
  toolCalls: number;
  toolCallsCap: number;
  /** Total weight of everything shot this visit (the 400 lbs). */
  shotWeightLbs: number;
  /** How many times a fixed symptom has respawned as two. */
  symptomRespawns: number;
  tradeRouteConsumed: boolean;
  championAlive: boolean;
  nextId: number;
}

export type HuntEvent =
  | { type: 'symptomFixed'; at: Cell; finding: Finding }
  | { type: 'symptomRespawn'; spawned: Cell[]; respawnCount: number }
  | { type: 'rootCauseKilled'; at: Cell; finding: Finding }
  | { type: 'rootCauseRelocated'; id: number; from: Cell; to: Cell }
  | { type: 'todoBagged'; at: Cell; finding: Finding }
  | { type: 'flakyShot'; id: number; at: Cell }
  | { type: 'tradeRouteWarning'; id: number; at: Cell }
  | { type: 'tradeRouteShot'; id: number; at: Cell }
  | { type: 'envRead'; id: number; tokensLost: number; halved: boolean }
  | { type: 'miss'; at: Cell };

type Rand = () => number;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function randInt(rand: Rand, maxExclusive: number): number {
  return Math.min(maxExclusive - 1, Math.floor(rand() * maxExclusive));
}

function occupied(state: Pick<HuntState, 'creatures' | 'player'>, col: number, row: number): boolean {
  if (state.player.col === col && state.player.row === row) return true;
  return state.creatures.some((c) => c.alive && c.col === col && c.row === row);
}

function randomFreeCell(state: HuntState, rand: Rand, opts?: { minDistFrom?: Cell; minDist?: number }): Cell {
  for (let tries = 0; tries < 60; tries++) {
    const col = randInt(rand, GRID_COLS);
    const row = randInt(rand, GRID_ROWS);
    if (occupied(state, col, row)) continue;
    if (opts?.minDistFrom && chebyshev({ col, row }, opts.minDistFrom) < (opts.minDist ?? 0)) continue;
    return { col, row };
  }
  return { col: 0, row: 0 }; // grid is never that full; last resort
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

export interface HuntOptions {
  /** The Junior is alive: +2 session tool calls (§5.4 assist). */
  juniorAlive: boolean;
  championAlive: boolean;
  /** Persisted tool-call pool (already regen-adjusted by loadPersisted). */
  toolCalls: number;
}

export function createHuntState(rand: Rand, opts: HuntOptions): HuntState {
  const cap = TOOL_CALLS_MAX + (opts.juniorAlive ? JUNIOR_BONUS_CALLS : 0);
  const state: HuntState = {
    player: { col: 10, row: 5 },
    facing: { dx: 1, dy: 0 },
    creatures: [],
    findings: [],
    toolCalls: Math.min(cap, opts.toolCalls + (opts.juniorAlive ? JUNIOR_BONUS_CALLS : 0)),
    toolCallsCap: cap,
    shotWeightLbs: 0,
    symptomRespawns: 0,
    tradeRouteConsumed: false,
    championAlive: opts.championAlive,
    nextId: 1,
  };

  const spawn = (kind: CreatureKind, minDistFromPlayer: number): Creature => {
    const cell = randomFreeCell(state, rand, { minDistFrom: state.player, minDist: minDistFromPlayer });
    const c: Creature = {
      id: state.nextId++,
      kind,
      col: cell.col,
      row: cell.row,
      alive: true,
      hidden: false,
      relocatesLeft: kind === 'rootCause' ? ROOT_CAUSE_RELOCATES : 0,
      revealed: false,
    };
    state.creatures.push(c);
    return c;
  };

  for (let i = 0; i < SYMPTOM_START_COUNT; i++) spawn('symptom', 2);
  spawn('rootCause', 5);
  spawn('rootCause', 5);
  spawn('flakyTest', 4);
  spawn('tradeRoute', 5);
  for (let i = 0; i < 3; i++) spawn('todo', 2);

  return state;
}

// ---------------------------------------------------------------------------
// Movement + observation
// ---------------------------------------------------------------------------

/**
 * Step the player one tile in an 8-direction. Returns whether the step
 * happened plus any events it provoked (trade-route contact, warnings,
 * spooked root causes).
 */
export function stepPlayer(state: HuntState, dx: number, dy: number, rand: Rand): HuntEvent[] {
  const events: HuntEvent[] = [];
  state.facing = { dx: Math.sign(dx), dy: Math.sign(dy) };

  const col = state.player.col + Math.sign(dx);
  const row = state.player.row + Math.sign(dy);
  if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
    state.player = { col, row };
  }

  events.push(...checkTradeRoute(state));
  events.push(...spookRootCauses(state, rand));
  return events;
}

/** Turning in place also counts as observing (aim spooks root causes). */
export function turnPlayer(state: HuntState, dx: number, dy: number, rand: Rand): HuntEvent[] {
  state.facing = { dx: Math.sign(dx), dy: Math.sign(dy) };
  return spookRootCauses(state, rand);
}

function checkTradeRoute(state: HuntState): HuntEvent[] {
  const events: HuntEvent[] = [];
  const route = state.creatures.find((c) => c.alive && c.kind === 'tradeRoute');
  if (!route || state.tradeRouteConsumed) return events;
  const dist = chebyshev(state.player, route);

  if (dist <= 2 && state.championAlive && !route.revealed) {
    route.revealed = true;
    events.push({ type: 'tradeRouteWarning', id: route.id, at: { col: route.col, row: route.row } });
  }
  if (dist <= 1) {
    state.tradeRouteConsumed = true;
    route.alive = false;
    const halved = state.championAlive;
    events.push({
      type: 'envRead',
      id: route.id,
      tokensLost: halved ? Math.ceil(ENV_DRAIN_TOKENS / 2) : ENV_DRAIN_TOKENS,
      halved,
    });
  }
  return events;
}

/** A root cause that is approached or aimed at relocates — it moves when
 * observed. After ROOT_CAUSE_RELOCATES moves it settles (still camouflaged). */
function spookRootCauses(state: HuntState, rand: Rand): HuntEvent[] {
  const events: HuntEvent[] = [];
  for (const c of state.creatures) {
    if (!c.alive || c.kind !== 'rootCause' || c.relocatesLeft <= 0) continue;
    const near = chebyshev(state.player, c) <= OBSERVE_RADIUS;
    const aimedAt = cellOnRay(state.player, state.facing, c, OBSERVE_AIM_RANGE);
    if (!near && !aimedAt) continue;
    const from: Cell = { col: c.col, row: c.row };
    const to = randomFreeCell(state, rand, { minDistFrom: state.player, minDist: 6 });
    c.col = to.col;
    c.row = to.row;
    c.relocatesLeft--;
    events.push({ type: 'rootCauseRelocated', id: c.id, from, to });
  }
  return events;
}

function cellOnRay(origin: Cell, dir: { dx: number; dy: number }, target: Cell, range: number): boolean {
  if (dir.dx === 0 && dir.dy === 0) return false;
  let col = origin.col;
  let row = origin.row;
  for (let i = 0; i < range; i++) {
    col += dir.dx;
    row += dir.dy;
    if (col === target.col && row === target.row) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

export interface FireResult {
  spent: boolean;
  /** Tile where the ray terminated (hit or max range) — for the tracer fx. */
  impact: Cell;
  events: HuntEvent[];
}

/**
 * Spend one tool call along the facing ray. First creature on the ray is
 * resolved; SYMPTOMS and TODOs are also hit from one tile off-ray (easy to
 * hit — that is the point). Root causes / flaky / trade route need an
 * exact tile.
 */
export function fireToolCall(state: HuntState, rand: Rand): FireResult {
  if (state.toolCalls <= 0) {
    return { spent: false, impact: state.player, events: [] };
  }
  state.toolCalls--;

  const dir = state.facing;
  let col = state.player.col;
  let row = state.player.row;
  for (let i = 0; i < FIRE_RANGE; i++) {
    col += dir.dx;
    row += dir.dy;
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) break;
    const cell: Cell = { col, row };

    const exact = state.creatures.find((c) => c.alive && !c.hidden && c.col === col && c.row === row);
    const loose = state.creatures.find(
      (c) =>
        c.alive &&
        !c.hidden &&
        (c.kind === 'symptom' || c.kind === 'todo') &&
        chebyshev(c, cell) <= 1,
    );
    const hit = exact ?? loose;
    if (!hit) continue;

    return { spent: true, impact: { col: hit.col, row: hit.row }, events: resolveHit(state, hit, rand) };
  }

  const impact: Cell = {
    col: Math.max(0, Math.min(GRID_COLS - 1, col)),
    row: Math.max(0, Math.min(GRID_ROWS - 1, row)),
  };
  return { spent: true, impact, events: [{ type: 'miss', at: impact }] };
}

function bag(state: HuntState, kind: keyof typeof CREATURE_STATS): Finding {
  const stats = CREATURE_STATS[kind];
  const finding: Finding = {
    id: state.nextId++,
    kind,
    weightLbs: stats.weightLbs,
    baseTokens: stats.baseTokens,
  };
  state.findings.push(finding);
  state.shotWeightLbs += stats.weightLbs;
  return finding;
}

function resolveHit(state: HuntState, hit: Creature, rand: Rand): HuntEvent[] {
  const at: Cell = { col: hit.col, row: hit.row };

  switch (hit.kind) {
    case 'symptom': {
      hit.alive = false;
      const finding = bag(state, 'symptom');
      const events: HuntEvent[] = [{ type: 'symptomFixed', at, finding }];
      // THE JOKE: fixing one symptom respawns two. Visibly.
      const spawned: Cell[] = [];
      const liveSymptoms = state.creatures.filter((c) => c.alive && c.kind === 'symptom').length;
      const toSpawn = Math.min(2, Math.max(0, SYMPTOM_CAP - liveSymptoms));
      for (let i = 0; i < toSpawn; i++) {
        const near = nearbyFreeCell(state, at, rand);
        const c: Creature = {
          id: state.nextId++,
          kind: 'symptom',
          col: near.col,
          row: near.row,
          alive: true,
          hidden: false,
          relocatesLeft: 0,
          revealed: false,
        };
        state.creatures.push(c);
        spawned.push(near);
      }
      if (spawned.length > 0) {
        state.symptomRespawns++;
        events.push({ type: 'symptomRespawn', spawned, respawnCount: state.symptomRespawns });
      }
      return events;
    }
    case 'rootCause': {
      hit.alive = false;
      const finding = bag(state, 'rootCause');
      return [{ type: 'rootCauseKilled', at, finding }];
    }
    case 'todo': {
      hit.alive = false;
      const finding = bag(state, 'todo');
      return [{ type: 'todoBagged', at, finding }];
    }
    case 'flakyTest': {
      // Cannot be killed. The shot is wasted; it phases out and returns.
      hit.hidden = true;
      return [{ type: 'flakyShot', id: hit.id, at }];
    }
    case 'tradeRoute': {
      // Shooting the friendly wildlife BEFORE petting it: the trap is
      // disarmed, nothing worth carrying. Verification pays in damage avoided.
      hit.alive = false;
      state.tradeRouteConsumed = true;
      return [{ type: 'tradeRouteShot', id: hit.id, at }];
    }
  }
}

function nearbyFreeCell(state: HuntState, origin: Cell, rand: Rand): Cell {
  for (let tries = 0; tries < 30; tries++) {
    const col = origin.col + randInt(rand, 5) - 2;
    const row = origin.row + randInt(rand, 5) - 2;
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
    if (occupied(state, col, row)) continue;
    return { col, row };
  }
  return randomFreeCell(state, rand);
}

// ---------------------------------------------------------------------------
// Flaky test: return + quarantine
// ---------------------------------------------------------------------------

/** The flaky test comes back (elsewhere). Returns its new cell, or null if
 * it was quarantined in the meantime. */
export function returnFlaky(state: HuntState, rand: Rand): Cell | null {
  const flaky = state.creatures.find((c) => c.alive && c.kind === 'flakyTest' && c.hidden);
  if (!flaky) return null;
  const to = randomFreeCell(state, rand, { minDistFrom: state.player, minDist: 3 });
  flaky.col = to.col;
  flaky.row = to.row;
  flaky.hidden = false;
  return to;
}

export type QuarantineResult = 'ok' | 'tooFar' | 'none';

/** Quarantine the flaky test (must be within 2 tiles and visible). The
 * SCENE charges the full day (actions.advanceDay) — the sim stays pure. */
export function tryQuarantine(state: HuntState): { result: QuarantineResult; finding?: Finding } {
  const flaky = state.creatures.find((c) => c.alive && c.kind === 'flakyTest');
  if (!flaky) return { result: 'none' };
  if (flaky.hidden || chebyshev(state.player, flaky) > 2) return { result: 'tooFar' };
  flaky.alive = false;
  const stats = CREATURE_STATS.flakyTest;
  const finding: Finding = {
    id: state.nextId++,
    kind: 'quarantine',
    weightLbs: stats.weightLbs,
    baseTokens: stats.baseTokens,
  };
  state.findings.push(finding);
  state.shotWeightLbs += stats.weightLbs;
  return { result: 'ok', finding };
}

// ---------------------------------------------------------------------------
// Ambient wander (symptoms + TODOs graze)
// ---------------------------------------------------------------------------

/** One wander tick: each symptom/TODO may amble one tile. Returns moved
 * creature ids for the scene to animate. */
export function wanderTick(state: HuntState, rand: Rand): number[] {
  const moved: number[] = [];
  for (const c of state.creatures) {
    if (!c.alive || c.hidden) continue;
    if (c.kind !== 'symptom' && c.kind !== 'todo') continue;
    if (rand() > 0.35) continue;
    const dx = randInt(rand, 3) - 1;
    const dy = randInt(rand, 3) - 1;
    const col = c.col + dx;
    const row = c.row + dy;
    if ((dx === 0 && dy === 0) || col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
    if (occupied(state, col, row)) continue;
    c.col = col;
    c.row = row;
    moved.push(c.id);
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Persistence: bbdm:bughunt (tool-call pool + one-shot card gates)
// ---------------------------------------------------------------------------

const PERSIST_KEY = 'bbdm:bughunt';
const PERSIST_VERSION = 1;

interface BugHuntPersist {
  v: number;
  toolCalls: number;
  /** Epoch ms of the last save; regen accrues against real elapsed time. */
  savedAt: number;
  /** Curriculum cards already shown (they fire once per browser). */
  cardsSeen: string[];
}

function readPersist(): BugHuntPersist | null {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as BugHuntPersist;
    if (p?.v !== PERSIST_VERSION || typeof p.toolCalls !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Load the persisted tool-call pool, applying slow regeneration for real
 * time spent away (1 call per TOOL_CALL_REGEN_MS, capped at TOOL_CALLS_MAX).
 * First visit: full pool.
 */
export function loadPersistedToolCalls(now: number): number {
  const p = readPersist();
  if (!p) return TOOL_CALLS_MAX;
  const regen = Math.floor(Math.max(0, now - p.savedAt) / TOOL_CALL_REGEN_MS);
  return Math.min(TOOL_CALLS_MAX, Math.max(0, p.toolCalls) + regen);
}

/** Save the pool (capped at TOOL_CALLS_MAX — the Junior's +2 is session-only). */
export function savePersistedToolCalls(toolCalls: number, now: number): void {
  const p = readPersist();
  const next: BugHuntPersist = {
    v: PERSIST_VERSION,
    toolCalls: Math.min(TOOL_CALLS_MAX, Math.max(0, toolCalls)),
    savedAt: now,
    cardsSeen: p?.cardsSeen ?? [],
  };
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: ammo simply refills next visit. Non-fatal.
  }
}

export function hasSeenCard(cardId: string): boolean {
  return readPersist()?.cardsSeen.includes(cardId) ?? false;
}

export function markCardSeen(cardId: string, now: number): void {
  const p = readPersist();
  const cards = p?.cardsSeen ?? [];
  if (!cards.includes(cardId)) cards.push(cardId);
  const next: BugHuntPersist = {
    v: PERSIST_VERSION,
    toolCalls: p ? Math.min(TOOL_CALLS_MAX, Math.max(0, p.toolCalls)) : TOOL_CALLS_MAX,
    savedAt: p?.savedAt ?? now,
    cardsSeen: cards,
  };
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Carry-out: summary quality heuristic + payout
// ---------------------------------------------------------------------------

/**
 * SUMMARY QUALITY HEURISTIC (documented per assignment).
 *
 * A one-line finding summary earns a token multiplier in [0.25, 1.5]
 * applied to the finding's base value. Starting from 0.75 (economy retune
 * 2026-07-25: was 0.6 — a decent summary should beat break-even):
 *
 *  LENGTH (a real sentence, not a shrug, not a paragraph):
 *   +0.30 if 20–90 chars; +0.15 if 10–19; −0.10 if > 120.
 *  SPECIFICITY — says WHERE (any of): a path-like token (`a/b`), a file
 *   extension (`.ts`, `.json`), a terrain directory name (/legacy, /src…),
 *   or a number (line, count, version): +0.25.
 *  CONDITION — says WHEN/WHY (when|if|after|only|because|null|undefined|
 *   race|timeout|retry|overflow|leak|empty|missing|concurrent|stale):
 *   +0.25.
 *  VAGUENESS (weird|broken|stuff|something|somehow|thing|issue|buggy):
 *   −0.20 each, capped at −0.40.
 *  Fewer than 3 words: −0.20. Empty: flat 0.25.
 *
 * "null deref in /legacy parser when input file is empty" ≈ 1.5× (capped).
 * "weird bug" ≈ 0.35×. The payout reads the line, not the bug.
 */
export function scoreSummary(text: string): number {
  const t = text.trim();
  if (t.length === 0) return 0.25;

  let m = 0.75;

  if (t.length >= 20 && t.length <= 90) m += 0.3;
  else if (t.length >= 10 && t.length < 20) m += 0.15;
  if (t.length > 120) m -= 0.1;

  const specific =
    /[\w-]+\/[\w-]+/.test(t) || // path-like
    /\.\w{2,4}\b/.test(t) || // file extension
    /\b(src|tests|docs|legacy|node_modules|scripts)\b/i.test(t) || // terrain dirs
    /\d/.test(t); // a number
  if (specific) m += 0.25;

  if (
    /\b(when|if|after|only|because|null|undefined|race|timeout|retry|overflow|leak|empty|missing|concurrent|stale)\b/i.test(
      t,
    )
  ) {
    m += 0.25;
  }

  const vague = t.match(/\b(weird|broken|stuff|something|somehow|thing|issue|buggy)\b/gi);
  if (vague) m -= Math.min(0.4, vague.length * 0.2);

  if (t.split(/\s+/).filter(Boolean).length < 3) m -= 0.2;

  return Math.max(0.25, Math.min(1.5, m));
}

export interface CarryChoice {
  finding: Finding;
  summary: string;
}

export interface Payout {
  totalTokens: number;
  totalWeightLbs: number;
  perFinding: { finding: Finding; multiplier: number; tokens: number }[];
}

/** Compute the carry-out payout. The scene enforces the 100-lb cap in the
 * UI; this trusts its input but recomputes weight for the notice line. */
export function computePayout(choices: readonly CarryChoice[]): Payout {
  const perFinding = choices.map((c) => {
    const multiplier = scoreSummary(c.summary);
    return {
      finding: c.finding,
      multiplier,
      tokens: Math.round(c.finding.baseTokens * multiplier),
    };
  });
  return {
    totalTokens: perFinding.reduce((sum, p) => sum + p.tokens, 0),
    totalWeightLbs: choices.reduce((sum, c) => sum + c.finding.weightLbs, 0),
    perFinding,
  };
}
