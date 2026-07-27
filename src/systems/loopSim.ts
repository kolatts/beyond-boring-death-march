/**
 * loopSim v2 — evaluates the SOCKET RING (spec §7.2, rebuilt simpler).
 *
 * The ring is fixed: TRIGGER → AGENT → up to three CHECK sockets → STOP →
 * back to TRIGGER, plus one HUMAN GATE toggle. A loop definition is just
 * which check cards are seated, which stop config card is in the STOP
 * socket, and whether the gate is on. Checks are the real dev loop —
 * RUN BUILD, RUN LINT, RUN UI TESTS — plus the trap card SQUINT AT IT.
 *
 * Retired from v1: the OBSERVE block and its 'no_observe' failure mode
 * (observation is now automatic and SHOWN — every failing check's output
 * visibly flows back into the agent's context mid-run) and the ESCALATE
 * block (gone with the freeform pegboard).
 *
 * Pure with respect to game state: the ONLY inputs are the loop definition
 * and SimOptions, the only output is a LoopOutcome. The scene applies the
 * resource deltas; the sim never touches state, Phaser, or the DOM.
 *
 * REUSE CONTRACT (Wave 3 boss — three concurrent loops, shared budget):
 * call evaluateLoop() once per loop with your own `rand` and the shared
 * remaining budget as `startTokens`; subtract `Math.max(0, -tokensDelta)`
 * (or ignore gains) from the shared pool between calls. Legacy block-list
 * cards (boss.json) adapt via loopFromBlocks(). Pass gateStyle: 'escort'
 * when a single HUMAN GATE means "serialized through the core" rather
 * than "a person on every lap" — escort gates slow a successful loop
 * instead of producing the bottleneck verdict.
 *
 * All prose comes from src/content/loop-builder.json (spec §2: flavor
 * lives in content, not code).
 */

import rawContent from '../content/loop-builder.json';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A check card seatable in one of the three CHECK sockets. */
export type CheckId = 'run_build' | 'run_lint' | 'run_ui_tests' | 'squint';

/** A stop config card for the single STOP socket. */
export type StopId = 'cap' | 'budget' | 'both' | 'none';

/** Ring stations a timeline event can pulse to. checkN = Nth CHECK socket. */
export type RingNodeId = 'trigger' | 'agent' | 'check0' | 'check1' | 'check2' | 'stop' | 'gate';

/** An assembled ring. */
export interface LoopDefinition {
  /** Seated check cards, in socket order (0..3 of them). */
  checks: CheckId[];
  /** The STOP socket's config card; null = socket empty (won't energize). */
  stop: StopId | null;
  /** The HUMAN GATE toggle. */
  humanGate: boolean;
}

/**
 * The failure-mode table, plus 'incomplete' (the ring refuses to
 * energize — a pre-flight nudge, not a run). v1's 'no_observe' is retired:
 * observation is automatic now, and demonstrated instead of assembled.
 */
export type LoopVerdict =
  | 'incomplete'
  | 'no_verifier'
  | 'subjective_verifier'
  | 'no_stop_cap'
  | 'no_stop_budget'
  | 'human_gate_everywhere'
  | 'success';

/** §7.2 scoring dimensions (shape unchanged from v1 — ScoreScene reads it). */
export interface LoopScore {
  iterationsUsed: number;
  tokensSpent: number;
  humanInterventions: number;
  /** Was at least one real (machine-checkable) check seated? */
  verifierReal: boolean;
  /** Net tokens earned by an efficient loop (0 on failure). */
  tokensBanked: number;
}

export type Tone = 'info' | 'ok' | 'warn' | 'fail';
export type Fx = 'spark' | 'flash' | 'checks' | 'invoice' | 'shake' | 'pass' | 'fail' | 'feedback';
export type Speed = 'slow' | 'normal' | 'fast' | 'frantic';

/** One beat of the run animation. Self-describing; scene-agnostic. */
export interface TimelineEvent {
  /** Pulse travels to this ring station (omitted: log-only beat). */
  node?: RingNodeId;
  /** Terminal line to append (omitted: movement-only beat). */
  line?: string;
  tone: Tone;
  /** One-shot effect at this beat. 'feedback' = output flows back to AGENT. */
  fx?: Fx;
  /** Pacing hint for the renderer ('slow' = demonstrative narration). */
  speed?: Speed;
  /** Simulated tokens remaining after this beat (for the live meter). */
  tokensAfter?: number;
}

export interface LoopOutcome {
  verdict: LoopVerdict;
  banner: string;
  timeline: TimelineEvent[];
  score: LoopScore;
  /** Net signed token delta to apply to the run. */
  tokensDelta: number;
  daysDelta: number;
  moraleDelta: number;
  /**
   * Death cause to use if applying tokensDelta empties the party's
   * tokens. Null for non-lethal verdicts (success, gate, breaker, incomplete).
   */
  deathCause: string | null;
  /** For 'incomplete': what refused (currently always the STOP socket). */
  missingStop: boolean;
}

export interface SimOptions {
  /** Tokens available going in (drives the live drain meter). */
  startTokens: number;
  /** Seeded [0..1) source — pass actions.rand for reproducible runs. */
  rand: () => number;
  /**
   * How a HUMAN GATE reads. 'bottleneck' (default, the ring's toggle):
   * a person on every lap → the eleven-days verdict. 'escort' (boss):
   * one gate serializing a lane → success, slower and cheaper-banked.
   */
  gateStyle?: 'bottleneck' | 'escort';
}

// ---------------------------------------------------------------------------
// Content (typed view over loop-builder.json)
// ---------------------------------------------------------------------------

export interface CheckContent {
  id: CheckId;
  label: string;
  sub: string;
  desc: string;
  passLine: string;
  failLine: string;
  closerLine: string;
  feedbackLine: string;
}

export interface StopContent {
  id: StopId;
  label: string;
  sub: string;
  desc: string;
}

export interface NodeContent {
  label: string;
  sub: string;
  desc: string;
}

interface GraphNodeContent {
  label: string;
  desc: string;
}

export interface ForkContent {
  title: string;
  intro: string[];
  graph: {
    hint: string;
    nodes: Record<'plan' | 'step_a' | 'step_b' | 'merge', GraphNodeContent>;
    doneLabel: string;
    runA: string[];
    runB: string[];
    verdict: string;
  };
  loop: {
    hint: string;
    runA: string[];
    runB: string[];
    verdict: string;
  };
  tally: string[];
  banner: string;
  moral: string;
}

interface LoopContent {
  comment: string;
  nodes: Record<'trigger' | 'agent' | 'stop' | 'gate', NodeContent>;
  checks: CheckContent[];
  stops: StopContent[];
  run: {
    start: string;
    triggerLine: string;
    agentLines: string[];
    stopLine: string;
    squintPassLine: string;
    gateEscortLine: string;
    scoreLine: string;
  };
  fork: ForkContent;
  ridge: {
    intro: string;
    plate: string;
    retreatDenied: string;
    squintDenied: string;
    crossSuccess: string[];
    crossGated: string;
    banked: string;
  };
  tutorial: {
    prompt: string;
    fires: string[][];
    ceremony: string;
    loopIntro: string;
    loopLines: string[];
    banner: string;
    moral: string;
  };
  verdicts: {
    success: { banner: string };
    no_verifier: { banner: string; cause: string; checks: string[]; lines: string[] };
    subjective_verifier: { banner: string; cause: string; lines: string[]; drain: string };
    no_stop_cap: {
      banner: string;
      cause: string;
      iterLine: string;
      iterVariants: string[];
      watch: string;
      lines: string[];
      breaker: { banner: string; lines: string[] };
    };
    no_stop_budget: { banner: string; cause: string; lines: string[]; invoice: string[]; after: string };
    human_gate_everywhere: { banner: string; lines: string[] };
    incomplete: { banner: string; missingStop: string };
  };
}

export const LOOP_CONTENT = rawContent as unknown as LoopContent;

/** Check card metadata by id, for any scene that renders cards. */
export function checkInfo(id: CheckId): CheckContent {
  const c = LOOP_CONTENT.checks.find((x) => x.id === id);
  return (
    c ?? {
      id,
      label: id.toUpperCase(),
      sub: '',
      desc: '',
      passLine: '',
      failLine: '',
      closerLine: '',
      feedbackLine: '',
    }
  );
}

/** Stop config card metadata by id. */
export function stopInfo(id: StopId): StopContent {
  const s = LOOP_CONTENT.stops.find((x) => x.id === id);
  return s ?? { id, label: id.toUpperCase(), sub: '', desc: '' };
}

// ---------------------------------------------------------------------------
// Legacy adapter — v1 block lists (boss.json cards, v1 saved loops)
// ---------------------------------------------------------------------------

/**
 * Map a v1 pegboard block list onto a ring definition. verifier_machine
 * becomes a real check, verifier_subjective becomes SQUINT AT IT, the two
 * stop blocks collapse into the stop config, human_gate becomes the
 * toggle. Core plumbing blocks (trigger/context/agent/tool/observe/
 * stop_success/escalate) are the ring itself now and carry no choice.
 */
export function loopFromBlocks(blocks: readonly string[]): LoopDefinition {
  const has = (b: string): boolean => blocks.includes(b);
  const checks: CheckId[] = [];
  if (has('verifier_machine')) checks.push('run_build');
  if (has('verifier_subjective')) checks.push('squint');
  const cap = has('stop_cap');
  const budget = has('stop_budget');
  const stop: StopId = cap && budget ? 'both' : cap ? 'cap' : budget ? 'budget' : 'none';
  return { checks, stop, humanGate: has('human_gate') };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Per-iteration token burn for a well-formed loop. */
const BURN_PER_ITERATION = 4;
/** A successful run is always this many demonstrated iterations. */
const SUCCESS_ITERATIONS = 3;

function pickTemplate(templates: string[], rand: () => number, n: number): string {
  const t = templates[Math.floor(rand() * templates.length)] ?? templates[0] ?? '';
  return t.replaceAll('{n}', String(n));
}

function realChecks(def: LoopDefinition): { id: CheckId; node: RingNodeId }[] {
  return def.checks
    .map((id, i) => ({ id, node: `check${i}` as RingNodeId }))
    .filter((c) => c.id !== 'squint');
}

function squintNode(def: LoopDefinition): RingNodeId | null {
  const i = def.checks.indexOf('squint');
  return i >= 0 ? (`check${i}` as RingNodeId) : null;
}

/**
 * Evaluate an assembled ring. Verdict priority mirrors the comedy of the
 * §7.2 table: structural refusal first, then the check sins, then the
 * human bottleneck, then the stop-config sins.
 */
export function evaluateLoop(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const real = realChecks(def);
  const verifierReal = real.length > 0;
  const escort = opts.gateStyle === 'escort';
  const V = LOOP_CONTENT.verdicts;

  if (def.stop === null) {
    return {
      verdict: 'incomplete',
      banner: V.incomplete.banner,
      timeline: [{ tone: 'warn', line: V.incomplete.missingStop, speed: 'normal' }],
      score: { iterationsUsed: 0, tokensSpent: 0, humanInterventions: 0, verifierReal, tokensBanked: 0 },
      tokensDelta: 0,
      daysDelta: 0,
      moraleDelta: 0,
      deathCause: null,
      missingStop: true,
    };
  }

  if (!verifierReal && squintNode(def) === null) return noVerifier(def, opts);
  if (!verifierReal) return subjectiveVerifier(def, opts);
  // The gate outranks the stop sins: with a person on every lap, the
  // person IS the cap and the budget.
  if (def.humanGate && !escort) return gateBottleneck(def, opts);
  if (def.stop === 'none') return noStopCap(def, opts, false);
  if (def.stop === 'budget') return noStopCap(def, opts, true);
  if (def.stop === 'cap') return noStopBudget(def, opts);
  return success(def, opts, escort && def.humanGate);
}

// --- timeline helpers -------------------------------------------------------

interface Builder {
  events: TimelineEvent[];
  tokens: number;
  visit(node: RingNodeId, line?: string, tone?: Tone, speed?: Speed, fx?: Fx): void;
  log(line: string, tone?: Tone, speed?: Speed, fx?: Fx): void;
  spend(amount: number): void;
}

function makeBuilder(startTokens: number): Builder {
  const b: Builder = {
    events: [],
    tokens: startTokens,
    visit(node, line, tone = 'info', speed = 'normal', fx) {
      const ev: TimelineEvent = { node, tone, speed, tokensAfter: Math.max(0, Math.round(b.tokens)) };
      if (line !== undefined) ev.line = line;
      if (fx !== undefined) ev.fx = fx;
      b.events.push(ev);
    },
    log(line, tone = 'info', speed = 'normal', fx) {
      const ev: TimelineEvent = { line, tone, speed, tokensAfter: Math.max(0, Math.round(b.tokens)) };
      if (fx !== undefined) ev.fx = fx;
      b.events.push(ev);
    },
    spend(amount) {
      b.tokens = Math.max(0, b.tokens - amount);
    },
  };
  return b;
}

// --- verdict builders -------------------------------------------------------

/**
 * The demonstrative success run. Iteration 1 plays slow — the agent edits,
 * the first check fails visibly, the failure output flows BACK into the
 * agent's context (fx 'feedback'); iterations 2-3 speed up and converge.
 */
function success(def: LoopDefinition, opts: SimOptions, escortGate: boolean): LoopOutcome {
  const R = LOOP_CONTENT.run;
  const b = makeBuilder(opts.startTokens);
  const real = realChecks(def);
  const squint = squintNode(def);
  const first = real[0];
  const second = real[1];
  const interventions = escortGate ? SUCCESS_ITERATIONS : 0;

  b.log(R.start, 'ok');
  b.visit('trigger', R.triggerLine, 'info', 'slow');

  // Iteration 1 — slow narration: edit, first check fails, output flows back.
  b.spend(BURN_PER_ITERATION);
  b.visit('agent', R.agentLines[0], 'info', 'slow');
  if (first) {
    const c = checkInfo(first.id);
    b.visit(first.node, c.failLine, 'warn', 'slow', 'fail');
    b.visit('agent', c.feedbackLine, 'info', 'slow', 'feedback');
  }

  // Iteration 2 — faster: first check passes, next obstacle appears.
  b.spend(BURN_PER_ITERATION);
  b.visit('agent', R.agentLines[1], 'info', 'fast');
  if (first) b.visit(first.node, checkInfo(first.id).passLine, 'ok', 'fast', 'pass');
  const closer = second ?? first;
  if (closer) {
    const c = checkInfo(closer.id);
    b.visit(closer.node, second ? c.failLine : c.closerLine, 'warn', 'fast', 'fail');
    b.visit('agent', c.feedbackLine, 'info', 'fast', 'feedback');
  }
  if (escortGate) {
    b.spend(1);
    b.visit('gate', R.gateEscortLine.replaceAll('{n}', '2'), 'warn', 'fast');
  }

  // Iteration 3 — every check green, in socket order; the loop exits on purpose.
  b.spend(BURN_PER_ITERATION);
  b.visit('agent', R.agentLines[2], 'info', 'fast');
  for (const c of real) {
    b.visit(c.node, checkInfo(c.id).passLine, 'ok', 'fast', 'pass');
  }
  if (squint) b.visit(squint, R.squintPassLine, 'info', 'fast');
  if (escortGate) {
    b.spend(2);
    b.visit('gate', R.gateEscortLine.replaceAll('{n}', '3'), 'warn', 'fast');
  }
  b.visit('stop', R.stopLine, 'ok', 'normal');

  const tokensSpent = SUCCESS_ITERATIONS * BURN_PER_ITERATION + interventions;
  const tokensBanked = Math.max(8, 40 - tokensSpent - 4 * interventions);
  b.log(R.scoreLine.replaceAll('{banked}', String(tokensBanked)), 'ok', 'normal', 'flash');

  return {
    verdict: 'success',
    banner: LOOP_CONTENT.verdicts.success.banner,
    timeline: b.events,
    score: {
      iterationsUsed: SUCCESS_ITERATIONS,
      tokensSpent,
      humanInterventions: interventions,
      verifierReal: true,
      tokensBanked,
    },
    tokensDelta: tokensBanked,
    daysDelta: escortGate ? 1 : 0,
    moraleDelta: 4,
    deathCause: null,
    missingStop: false,
  };
}

/** No checks seated at all: the unearned-confidence cascade. */
function noVerifier(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  void def;
  const c = LOOP_CONTENT.verdicts.no_verifier;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  b.visit('trigger', LOOP_CONTENT.run.triggerLine, 'info', 'fast');
  b.visit('agent', LOOP_CONTENT.run.agentLines[0], 'info', 'fast');
  b.spend(6);
  for (const check of c.checks) {
    b.log(check, 'ok', 'fast', 'checks');
  }
  b.spend(12);
  c.lines.forEach((line, i) => {
    const last = i === c.lines.length - 1;
    if (i === 0) {
      b.visit('stop', line, 'info', 'normal');
    } else {
      b.log(line, 'fail', 'normal', last ? 'spark' : undefined);
    }
  });

  return {
    verdict: 'no_verifier',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: 1, tokensSpent: 18, humanInterventions: 0, verifierReal: false, tokensBanked: 0 },
    tokensDelta: -18,
    daysDelta: 1,
    moraleDelta: -4,
    deathCause: c.cause,
    missingStop: false,
  };
}

/** SQUINT AT IT is the only check: the philosophical non-termination. */
function subjectiveVerifier(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.subjective_verifier;
  const b = makeBuilder(opts.startTokens);
  const node = squintNode(def) ?? 'check0';
  b.log(LOOP_CONTENT.run.start, 'ok');
  b.visit('trigger', LOOP_CONTENT.run.triggerLine, 'info', 'fast');
  b.visit('agent', LOOP_CONTENT.run.agentLines[0], 'info', 'normal');
  c.lines.forEach((line, i) => {
    b.spend(5);
    b.visit(node, line, i < 2 ? 'info' : 'warn', i < 3 ? 'normal' : 'fast');
  });
  b.spend(5);
  b.log(c.drain, 'fail', 'fast', 'spark');

  return {
    verdict: 'subjective_verifier',
    banner: c.banner,
    timeline: b.events,
    score: {
      iterationsUsed: c.lines.length,
      tokensSpent: 30,
      humanInterventions: 0,
      verifierReal: false,
      tokensBanked: 0,
    },
    tokensDelta: -30,
    daysDelta: 1,
    moraleDelta: -5,
    deathCause: c.cause,
    missingStop: false,
  };
}

/**
 * STOP = NONE (runaway screen-fill, lethal-capable) or STOP = BUDGET only
 * (same runaway, until the budget breaker trips — a cheaper, louder lesson
 * that the cap matters too).
 */
function noStopCap(def: LoopDefinition, opts: SimOptions, breaker: boolean): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_stop_cap;
  const b = makeBuilder(opts.startTokens);
  const first = realChecks(def)[0];
  const checkNode: RingNodeId = first ? first.node : 'check0';

  b.log(LOOP_CONTENT.run.start, 'ok');
  b.visit('trigger', LOOP_CONTENT.run.triggerLine, 'info', 'fast');

  const shownIterations = breaker ? 10 : 14;
  for (let n = 1; n <= shownIterations; n++) {
    b.spend(breaker ? 2 : 1.8);
    const line =
      n % 4 === 3 ? pickTemplate(c.iterVariants, opts.rand, n) : c.iterLine.replaceAll('{n}', String(n));
    b.visit(
      n % 2 === 0 ? 'agent' : checkNode,
      line,
      n > 8 ? 'warn' : 'info',
      n > 4 ? 'frantic' : 'fast',
      n % 2 === 0 ? undefined : 'fail',
    );
    if (n === 8) b.log(c.watch, 'warn', 'fast');
  }
  if (breaker) {
    c.breaker.lines.forEach((line, i) => {
      b.visit('stop', line, 'warn', 'normal', i === 0 ? 'shake' : undefined);
    });
  } else {
    for (const line of c.lines) b.log(line, 'fail', 'normal', 'spark');
  }

  const tokensSpent = breaker ? 20 : 26;
  return {
    verdict: 'no_stop_cap',
    banner: breaker ? c.breaker.banner : c.banner,
    timeline: b.events,
    score: {
      iterationsUsed: shownIterations,
      tokensSpent,
      humanInterventions: 0,
      verifierReal: true,
      tokensBanked: 0,
    },
    tokensDelta: -tokensSpent,
    daysDelta: 1,
    moraleDelta: breaker ? -3 : -6,
    deathCause: breaker ? null : c.cause,
    missingStop: false,
  };
}

/** STOP = CAP only, no budget: the work finishes; so does the money. */
function noStopBudget(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_stop_budget;
  const b = makeBuilder(opts.startTokens);
  const first = realChecks(def)[0];
  const checkNode: RingNodeId = first ? first.node : 'check0';

  b.log(LOOP_CONTENT.run.start, 'ok');
  b.visit('trigger', LOOP_CONTENT.run.triggerLine, 'info', 'normal');
  c.lines.forEach((line, i) => {
    b.spend(12);
    const last = i === c.lines.length - 1;
    b.visit(last ? 'stop' : i % 2 === 0 ? 'agent' : checkNode, line, 'info');
  });
  for (const line of c.invoice) {
    b.log(line, 'fail', 'fast', 'invoice');
  }
  b.log(c.after, 'warn');

  return {
    verdict: 'no_stop_budget',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: 2, tokensSpent: 38, humanInterventions: 0, verifierReal: true, tokensBanked: 0 },
    tokensDelta: -38,
    daysDelta: 1,
    moraleDelta: -3,
    deathCause: c.cause,
    missingStop: false,
  };
}

/** HUMAN GATE on: it works. It takes eleven days. You are the bottleneck. */
function gateBottleneck(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.human_gate_everywhere;
  const b = makeBuilder(opts.startTokens);
  const first = realChecks(def)[0];
  const checkNode: RingNodeId = first ? first.node : 'check0';

  b.log(LOOP_CONTENT.run.start, 'ok');
  b.visit('trigger', LOOP_CONTENT.run.triggerLine, 'info', 'normal');
  c.lines.forEach((line, i) => {
    b.spend(1.5);
    const last = i === c.lines.length - 1;
    if (last) {
      b.log(line, 'warn');
    } else if (line.startsWith('CHECKS')) {
      b.visit(checkNode, line, 'ok', 'normal', 'pass');
    } else {
      b.visit('gate', line, i < 2 ? 'info' : 'warn');
    }
  });

  const iterations = 4;
  return {
    verdict: 'human_gate_everywhere',
    banner: c.banner,
    timeline: b.events,
    score: {
      iterationsUsed: iterations,
      tokensSpent: 12,
      humanInterventions: iterations,
      verifierReal: true,
      tokensBanked: 8,
    },
    tokensDelta: 8 - 12,
    daysDelta: 11,
    moraleDelta: -8,
    deathCause: null,
    missingStop: false,
  };
}

// ---------------------------------------------------------------------------
// Persistence — best loop (spec §7.2 scoring; Wave 3 reads this)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bbdm:loopbuilder';
const STORAGE_VERSION = 2;

export interface BestLoopRecord {
  mechanic: string;
  def: LoopDefinition;
  score: LoopScore;
  /** ISO timestamp. */
  when: string;
}

export interface LoopBuilderStore {
  v: number;
  runs: number;
  best?: BestLoopRecord;
}

/** v1 record shape (pegboard block list), migrated on read. */
interface LegacyBestRecord {
  mechanic?: string;
  blocks?: string[];
  score?: LoopScore;
  when?: string;
}

export function loadLoopStore(): LoopBuilderStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: STORAGE_VERSION, runs: 0 };
    const parsed = JSON.parse(raw) as { v?: number; runs?: number; best?: unknown };
    if (typeof parsed.runs !== 'number') return { v: STORAGE_VERSION, runs: 0 };
    if (parsed.v === STORAGE_VERSION) return parsed as LoopBuilderStore;
    if (parsed.v === 1) {
      // Migrate: keep runs; map the v1 block list onto a ring definition.
      const store: LoopBuilderStore = { v: STORAGE_VERSION, runs: parsed.runs };
      const old = parsed.best as LegacyBestRecord | undefined;
      if (old?.score && Array.isArray(old.blocks)) {
        store.best = {
          mechanic: old.mechanic ?? 'loop_builder_guided',
          def: loopFromBlocks(old.blocks),
          score: old.score,
          when: old.when ?? new Date().toISOString(),
        };
      }
      return store;
    }
    return { v: STORAGE_VERSION, runs: 0 };
  } catch {
    return { v: STORAGE_VERSION, runs: 0 };
  }
}

/** Count the run; keep the best (highest tokensBanked) successful loop. */
export function recordLoopOutcome(mechanic: string, def: LoopDefinition, outcome: LoopOutcome): void {
  const store = loadLoopStore();
  store.runs += 1;
  if (outcome.verdict === 'success') {
    const banked = outcome.score.tokensBanked;
    if (!store.best || banked > store.best.score.tokensBanked) {
      store.best = {
        mechanic,
        def: { checks: [...def.checks], stop: def.stop, humanGate: def.humanGate },
        score: { ...outcome.score },
        when: new Date().toISOString(),
      };
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: the loop still ran. Non-fatal.
  }
}
