/**
 * loopSim — evaluates an assembled agentic loop (spec §7.2) and returns a
 * verdict, a score, and an animation timeline. Pure with respect to game
 * state: the ONLY inputs are the loop definition and SimOptions, the only
 * output is a LoopOutcome. The scene applies the resource deltas; the sim
 * never touches state, Phaser, or the DOM.
 *
 * REUSE CONTRACT (Wave 3 boss — three concurrent loops, shared budget):
 * call evaluateLoop() once per loop with your own `rand` and the shared
 * remaining budget as `startTokens`; subtract `Math.max(0, -tokensDelta)`
 * (or ignore gains) from the shared pool between calls. Timelines can be
 * interleaved by the boss scene; every TimelineEvent is self-describing.
 *
 * All prose comes from src/content/loop-builder.json (spec §2: flavor
 * lives in content, not code).
 */

import rawContent from '../content/loop-builder.json';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BlockId =
  | 'trigger'
  | 'context'
  | 'agent'
  | 'tool_tests'
  | 'observe'
  | 'verifier_machine'
  | 'verifier_subjective'
  | 'stop_success'
  | 'stop_cap'
  | 'stop_budget'
  | 'human_gate'
  | 'escalate';

/** An assembled loop: block ids in pegboard ring order. */
export interface LoopDefinition {
  blocks: BlockId[];
}

/**
 * The seven outcomes of the §7.2 failure-mode table, plus 'incomplete'
 * (the panel refuses to energize — a pre-flight nudge, not a run).
 */
export type LoopVerdict =
  | 'incomplete'
  | 'no_verifier'
  | 'subjective_verifier'
  | 'no_stop_cap'
  | 'no_stop_budget'
  | 'no_observe'
  | 'human_gate_everywhere'
  | 'success';

/** §7.2 scoring dimensions. */
export interface LoopScore {
  iterationsUsed: number;
  tokensSpent: number;
  humanInterventions: number;
  /** Was the verifier machine-checkable? */
  verifierReal: boolean;
  /** Net tokens earned by an efficient loop (0 on failure). */
  tokensBanked: number;
}

export type Tone = 'info' | 'ok' | 'warn' | 'fail';
export type Fx = 'spark' | 'flash' | 'checks' | 'invoice' | 'shake';
export type Speed = 'normal' | 'fast' | 'frantic';

/** One beat of the run animation. Self-describing; scene-agnostic. */
export interface TimelineEvent {
  /** Pulse travels to this block's socket (omitted: log-only beat). */
  blockId?: BlockId;
  /** Terminal line to append (omitted: movement-only beat). */
  line?: string;
  tone: Tone;
  /** One-shot effect at this beat. */
  fx?: Fx;
  /** Pacing hint for the renderer. */
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
   * tokens. Null for non-lethal verdicts (success, gates, incomplete).
   */
  deathCause: string | null;
  /** True when an ESCALATE block converted a quiet death into a loud report. */
  escalated: boolean;
  /** For 'incomplete': which core sockets are still cold. */
  missingCore: BlockId[];
}

export interface SimOptions {
  /** Tokens available going in (drives the live drain meter). */
  startTokens: number;
  /** Seeded [0..1) source — pass actions.rand for reproducible runs. */
  rand: () => number;
}

// ---------------------------------------------------------------------------
// Content (typed view over loop-builder.json)
// ---------------------------------------------------------------------------

interface LoopContent {
  blocks: { id: BlockId; label: string; sub: string; desc: string }[];
  guided: { hint: string; socketHints: Record<string, string> };
  ridge: {
    intro: string;
    plate: string;
    retreatDenied: string;
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
  run: { start: string; visitLines: Record<string, string> };
  verdicts: {
    success: { banner: string; lines: string[]; gateLine: string; scoreLine: string };
    no_verifier: { banner: string; cause: string; checks: string[]; lines: string[] };
    subjective_verifier: { banner: string; cause: string; lines: string[]; drain: string };
    no_stop_cap: {
      banner: string;
      cause: string;
      iterLine: string;
      iterVariants: string[];
      watch: string;
      escalated: string[];
      lines: string[];
    };
    no_stop_budget: { banner: string; cause: string; lines: string[]; invoice: string[]; after: string };
    no_observe: { banner: string; cause: string; lines: string[] };
    human_gate_everywhere: { banner: string; lines: string[] };
    incomplete: { banner: string; missing: Record<string, string> };
  };
}

export const LOOP_CONTENT = rawContent as unknown as LoopContent;

/** Block metadata (label/sub/desc) by id, for any scene that renders blocks. */
export function blockInfo(id: BlockId): { label: string; sub: string; desc: string } {
  const b = LOOP_CONTENT.blocks.find((x) => x.id === id);
  return b ?? { label: id.toUpperCase(), sub: '', desc: '' };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Sockets the panel refuses to run without. */
const CORE: readonly BlockId[] = ['trigger', 'context', 'agent', 'tool_tests', 'stop_success'];

/** HUMAN GATE count at which the person becomes the loop. */
const GATES_EVERYWHERE = 3;

/** Per-iteration token burn for a well-formed loop. */
const BURN_PER_ITERATION = 4;

function pickTemplate(templates: string[], rand: () => number, n: number): string {
  const t = templates[Math.floor(rand() * templates.length)] ?? templates[0] ?? '';
  return t.replaceAll('{n}', String(n));
}

/**
 * Evaluate an assembled loop. Verdict priority mirrors the comedy of the
 * §7.2 table: structural refusal first, then the verifier sins, then the
 * missing feedback, then the missing stops, then the human bottleneck.
 */
export function evaluateLoop(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const has = (id: BlockId): boolean => def.blocks.includes(id);
  const gates = def.blocks.filter((b) => b === 'human_gate').length;
  const escalatePresent = has('escalate');
  const verifierReal = has('verifier_machine');
  const V = LOOP_CONTENT.verdicts;

  const missingCore = CORE.filter((id) => !has(id));
  if (missingCore.length > 0) {
    return {
      verdict: 'incomplete',
      banner: V.incomplete.banner,
      timeline: missingCore.map((id) => ({
        tone: 'warn' as Tone,
        line: V.incomplete.missing[id] ?? `Missing: ${id}`,
        speed: 'normal' as Speed,
      })),
      score: { iterationsUsed: 0, tokensSpent: 0, humanInterventions: 0, verifierReal, tokensBanked: 0 },
      tokensDelta: 0,
      daysDelta: 0,
      moraleDelta: 0,
      deathCause: null,
      escalated: false,
      missingCore,
    };
  }

  if (!verifierReal && !has('verifier_subjective')) return noVerifier(def, opts);
  if (!verifierReal) return subjectiveVerifier(def, opts);
  if (!has('observe')) return noObserve(def, opts);
  // Gates outrank the stop checks: with a person at every step, the person
  // IS the cap and the budget. (Also: ten sockets cannot hold all of it.)
  if (gates >= GATES_EVERYWHERE) return gatesEverywhere(def, opts, gates);
  if (!has('stop_cap')) return noStopCap(def, opts, escalatePresent);
  if (!has('stop_budget')) return noStopBudget(def, opts);
  return success(def, opts, gates);
}

// --- timeline helpers -------------------------------------------------------

interface Builder {
  events: TimelineEvent[];
  tokens: number;
  visit(blockId: BlockId, line?: string, tone?: Tone, speed?: Speed): void;
  log(line: string, tone?: Tone, speed?: Speed, fx?: Fx): void;
  spend(amount: number): void;
}

function makeBuilder(startTokens: number): Builder {
  const b: Builder = {
    events: [],
    tokens: startTokens,
    visit(blockId, line, tone = 'info', speed = 'normal') {
      const ev: TimelineEvent = { blockId, tone, speed, tokensAfter: Math.max(0, Math.round(b.tokens)) };
      if (line !== undefined) ev.line = line;
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

/** Walk the ring once, pulsing through every seated block, with stock visit lines. */
function lapOnce(b: Builder, def: LoopDefinition, speed: Speed = 'normal'): void {
  const stock = LOOP_CONTENT.run.visitLines;
  for (const id of def.blocks) {
    b.visit(id, stock[id], 'info', speed);
  }
}

// --- verdict builders -------------------------------------------------------

function success(def: LoopDefinition, opts: SimOptions, gates: number): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.success;
  const b = makeBuilder(opts.startTokens);
  const iterations = 3;
  const interventions = gates * iterations;

  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def);
  c.lines.forEach((line, i) => {
    b.spend(BURN_PER_ITERATION);
    const isLast = i === c.lines.length - 1;
    b.visit(
      isLast ? 'stop_success' : i % 2 === 0 ? 'tool_tests' : 'observe',
      line,
      isLast ? 'ok' : 'info',
    );
    if (gates > 0 && i < iterations) {
      b.spend(1);
      b.visit('human_gate', c.gateLine.replaceAll('{n}', String(i + 1)), 'warn');
    }
  });

  const tokensSpent = iterations * BURN_PER_ITERATION + interventions;
  const tokensBanked = Math.max(8, 40 - tokensSpent - 4 * interventions);
  b.log(c.scoreLine.replaceAll('{banked}', String(tokensBanked)), 'ok', 'normal', 'flash');

  return {
    verdict: 'success',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: iterations, tokensSpent, humanInterventions: interventions, verifierReal: true, tokensBanked },
    tokensDelta: tokensBanked,
    daysDelta: gates > 0 ? gates : 0,
    moraleDelta: 4,
    deathCause: null,
    escalated: false,
    missingCore: [],
  };
}

function noVerifier(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_verifier;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def, 'fast');
  b.spend(6);
  for (const check of c.checks) {
    b.log(check, 'ok', 'fast', 'checks');
  }
  b.spend(12);
  c.lines.forEach((line, i) => {
    b.log(line, i === 0 ? 'info' : 'fail', 'normal', i === c.lines.length - 1 ? 'spark' : undefined);
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
    escalated: false,
    missingCore: [],
  };
}

function subjectiveVerifier(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.subjective_verifier;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def);
  c.lines.forEach((line, i) => {
    b.spend(5);
    b.visit('verifier_subjective', line, i < 2 ? 'info' : 'warn', i < 3 ? 'normal' : 'fast');
  });
  b.spend(5);
  b.log(c.drain, 'fail', 'fast', 'spark');

  return {
    verdict: 'subjective_verifier',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: c.lines.length, tokensSpent: 30, humanInterventions: 0, verifierReal: false, tokensBanked: 0 },
    tokensDelta: -30,
    daysDelta: 1,
    moraleDelta: -5,
    deathCause: c.cause,
    escalated: false,
    missingCore: [],
  };
}

function noStopCap(def: LoopDefinition, opts: SimOptions, escalated: boolean): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_stop_cap;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def, 'fast');

  const shownIterations = escalated ? 6 : 14;
  for (let n = 1; n <= shownIterations; n++) {
    b.spend(escalated ? 2 : 1.8);
    const line =
      n % 4 === 3
        ? pickTemplate(c.iterVariants, opts.rand, n)
        : c.iterLine.replaceAll('{n}', String(n));
    b.visit(n % 2 === 0 ? 'agent' : 'tool_tests', line, n > 8 ? 'warn' : 'info', n > 4 ? 'frantic' : 'fast');
    if (n === 8) b.log(c.watch, 'warn', 'fast');
  }
  if (escalated) {
    for (const line of c.escalated) b.visit('escalate', line, 'warn');
  } else {
    for (const line of c.lines) b.log(line, 'fail', 'normal', 'spark');
  }

  const tokensSpent = escalated ? 12 : 26;
  return {
    verdict: 'no_stop_cap',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: shownIterations, tokensSpent, humanInterventions: 0, verifierReal: true, tokensBanked: 0 },
    tokensDelta: -tokensSpent,
    daysDelta: 1,
    moraleDelta: escalated ? -2 : -6,
    deathCause: escalated ? null : c.cause,
    escalated,
    missingCore: [],
  };
}

function noStopBudget(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_stop_budget;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def);
  c.lines.forEach((line, i) => {
    b.spend(12);
    b.visit(i === c.lines.length - 1 ? 'stop_success' : 'agent', line, 'info');
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
    escalated: false,
    missingCore: [],
  };
}

function noObserve(def: LoopDefinition, opts: SimOptions): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.no_observe;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def);
  c.lines.forEach((line, i) => {
    b.spend(3);
    const isLast = i === c.lines.length - 1;
    if (isLast) {
      b.log(line, 'fail', 'normal', 'spark');
    } else {
      b.visit(line.startsWith('TOOL') ? 'tool_tests' : 'agent', line, i >= 3 ? 'warn' : 'info');
    }
  });

  return {
    verdict: 'no_observe',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: 3, tokensSpent: 16, humanInterventions: 0, verifierReal: true, tokensBanked: 0 },
    tokensDelta: -16,
    daysDelta: 1,
    moraleDelta: -4,
    deathCause: c.cause,
    escalated: false,
    missingCore: [],
  };
}

function gatesEverywhere(def: LoopDefinition, opts: SimOptions, gates: number): LoopOutcome {
  const c = LOOP_CONTENT.verdicts.human_gate_everywhere;
  const b = makeBuilder(opts.startTokens);
  b.log(LOOP_CONTENT.run.start, 'ok');
  lapOnce(b, def);
  c.lines.forEach((line, i) => {
    b.spend(1.5);
    const isLast = i === c.lines.length - 1;
    if (isLast) {
      b.log(line, 'warn');
    } else {
      b.visit(line.startsWith('VERIFIER') ? 'verifier_machine' : 'human_gate', line, i < 2 ? 'info' : 'warn');
    }
  });

  const iterations = 4;
  const interventions = gates * iterations;
  return {
    verdict: 'human_gate_everywhere',
    banner: c.banner,
    timeline: b.events,
    score: { iterationsUsed: iterations, tokensSpent: 12, humanInterventions: interventions, verifierReal: true, tokensBanked: 8 },
    tokensDelta: 8 - 12,
    daysDelta: 11,
    moraleDelta: -8,
    deathCause: null,
    escalated: false,
    missingCore: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence — best loop (spec §7.2 scoring; Wave 3 reads this)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bbdm:loopbuilder';
const STORAGE_VERSION = 1;

export interface BestLoopRecord {
  mechanic: string;
  blocks: BlockId[];
  score: LoopScore;
  /** ISO timestamp. */
  when: string;
}

export interface LoopBuilderStore {
  v: number;
  runs: number;
  best?: BestLoopRecord;
}

export function loadLoopStore(): LoopBuilderStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: STORAGE_VERSION, runs: 0 };
    const parsed = JSON.parse(raw) as LoopBuilderStore;
    if (parsed.v !== STORAGE_VERSION || typeof parsed.runs !== 'number') {
      return { v: STORAGE_VERSION, runs: 0 };
    }
    return parsed;
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
        blocks: [...def.blocks],
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
