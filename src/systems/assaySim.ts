/**
 * assaySim — pure decision math for THE ASSAY OFFICE (mile 900).
 *
 * The teaching sim for prompt/agent EVALS, per the evals course canon:
 * golden sets with known-good answers; grader types (exact match /
 * code-graded / model-graded rubric); iterate on the measured score, not
 * the feeling. Fiction: an assayer weighs claims; one nugget is an
 * anecdote.
 *
 * DETERMINISTIC ON PURPOSE — no Rand parameter anywhere. An eval is the
 * one part of this game that is supposed to produce the same number
 * twice. The player's choices (which cases, which graders, which prompt
 * revision) fully determine the score; reruns with the same choices
 * match. That determinism IS the lesson.
 *
 * No Phaser, no state imports: the scene applies deltas/days itself
 * (same contract as cabSim).
 *
 * GRADER-MISMATCH TABLE (how false passes/fails happen, visibly):
 *
 *   chosen \ right     exact           code            model
 *   exact              truth           FALSE FAIL      FALSE FAIL
 *   code               truth*          truth           FALSE FAIL
 *   model              FALSE PASS      FALSE PASS      truth
 *
 *   * code-graded can implement an exact check, so it reports the truth —
 *     but it is the wrong instrument (over-tooled) and scores no
 *     instrument credit. FALSE FAIL = the grader stamps ✗ regardless of
 *     truth (brittle: string drift, whitespace, many-correct-answers).
 *     FALSE PASS = the grader stamps ✓ regardless of truth (a charitable
 *     rubric with nothing precise to hold on to).
 *
 *   A case with NO expected output has no truth at all: exact/code stamp
 *   ✗ (nothing to compare against), model stamps ✓ (the judge liked it).
 *   Neither verdict means anything — which is why the assayer tells you
 *   to leave it out of the set.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraderId = 'exact' | 'code' | 'model';

/** The prompt under assay: the original claim plus the three revisions. */
export type RevisionId = 'v1' | 'fix' | 'superstition' | 'overfit';

export const GRADER_ORDER: readonly GraderId[] = ['exact', 'code', 'model'];

/** Mechanical half of a test case (prose lives in content/assay-office.json). */
export interface AssayCaseDef {
  id: string;
  /** False for the trap case: no known-good answer exists. */
  hasExpected: boolean;
  /** Set when this case duplicates another offered case (adds no signal). */
  redundantOf?: string;
  /** The right instrument. Absent exactly when hasExpected is false. */
  bestGrader?: GraderId;
  /** Ground truth per revision: does the agent's output actually satisfy
   * intent on this case under that prompt? Meaningless when !hasExpected. */
  actual?: Partial<Record<RevisionId, boolean>>;
}

export interface CaseVerdict {
  caseId: string;
  grader: GraderId;
  /** Truth under the active revision; null when no expected output exists. */
  actual: boolean | null;
  /** What the grader stamps on the ledger. */
  reported: boolean;
  /** 'pass' = stamped ✓ falsely; 'fail' = stamped ✗ falsely; also set (to
   * the stamp's direction) for the no-expected case, whose verdict can
   * never be trusted in either direction. */
  falseKind: 'pass' | 'fail' | null;
  /** Chosen grader is the case's bestGrader (instrument credit). */
  rightInstrument: boolean;
}

export interface AssayRunResult {
  revision: RevisionId;
  verdicts: CaseVerdict[];
  /** Measured passes (what the ledger says), 0..5. */
  score: number;
  /** True passes (what the gold actually weighs), 0..5. */
  trueScore: number;
  /** Model-graded cases in this run (each costs tokens). */
  modelCount: number;
  /** Tokens burned by model grading this run. */
  tokenCost: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const ASSAY = {
  /** Golden-set size the assayer will accept. */
  setSize: 5,
  /** Tokens per model-graded case, per weighing (rubric judges bill hourly). */
  modelTokensPerCase: 2,
  /** Calendar days per weighing (advanceDay + one tickDeadlines, cab contract). */
  daysPerRun: 1,
  reward: {
    /** Tokens per measured pass at settlement. */
    tokensPerPass: 3,
    /** Bonus for 5/5 measured with every instrument right (a clean assay). */
    cleanBonus: 5,
    /** Credibility = round(gradervQ * instrumentWeight + setQ * setWeight) + base. */
    instrumentWeight: 8,
    setWeight: 4,
    credibilityBase: -3,
    moraleHigh: 4,
    moraleLow: -3,
  },
} as const;

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function gradeCase(
  def: AssayCaseDef,
  grader: GraderId,
  revision: RevisionId,
): CaseVerdict {
  if (!def.hasExpected) {
    // No truth exists. exact/code find nothing to compare; model approves.
    const reported = grader === 'model';
    return {
      caseId: def.id,
      grader,
      actual: null,
      reported,
      falseKind: reported ? 'pass' : 'fail',
      rightInstrument: false,
    };
  }
  const actual = def.actual?.[revision] ?? false;
  const best = def.bestGrader ?? 'exact';
  if (grader === best || (grader === 'code' && best === 'exact')) {
    // Right instrument (or code over-implementing an exact check): truth.
    return {
      caseId: def.id,
      grader,
      actual,
      reported: actual,
      falseKind: null,
      rightInstrument: grader === best,
    };
  }
  if (grader === 'model') {
    // Charitable rubric on a factual case: stamps ✓ regardless.
    return {
      caseId: def.id,
      grader,
      actual,
      reported: true,
      falseKind: actual ? null : 'pass',
      rightInstrument: false,
    };
  }
  // exact (or code) applied where answers legitimately vary: stamps ✗.
  return {
    caseId: def.id,
    grader,
    actual,
    reported: false,
    falseKind: actual ? 'fail' : null,
    rightInstrument: false,
  };
}

/** Weigh the whole set. `graders` maps caseId → chosen grader. */
export function runAssay(
  cases: readonly AssayCaseDef[],
  graders: Readonly<Record<string, GraderId>>,
  revision: RevisionId,
): AssayRunResult {
  const verdicts = cases.map((def) => gradeCase(def, graders[def.id] ?? 'exact', revision));
  const modelCount = verdicts.filter((v) => v.grader === 'model').length;
  return {
    revision,
    verdicts,
    score: verdicts.filter((v) => v.reported).length,
    trueScore: verdicts.filter((v) => v.actual === true).length,
    modelCount,
    tokenCost: modelCount * ASSAY.modelTokensPerCase,
  };
}

// ---------------------------------------------------------------------------
// Set & instrument quality
// ---------------------------------------------------------------------------

/**
 * Fraction of the set whose chosen grader is the case's bestGrader
 * (0..1). The no-expected case can never earn instrument credit — no
 * instrument is right for a case with no answer.
 */
export function graderChoiceQuality(
  cases: readonly AssayCaseDef[],
  graders: Readonly<Record<string, GraderId>>,
): number {
  if (cases.length === 0) return 0;
  const right = cases.filter(
    (def) => def.hasExpected && def.bestGrader === (graders[def.id] ?? 'exact'),
  ).length;
  return right / cases.length;
}

/**
 * Fraction of the set that carries new signal (0..1). A case is
 * uninformative if it has no expected output, or if it duplicates another
 * selected case (only the SECOND of a dupe pair is penalized — one of
 * them is a perfectly good case).
 */
export function setQuality(cases: readonly AssayCaseDef[]): number {
  if (cases.length === 0) return 0;
  const ids = new Set(cases.map((c) => c.id));
  let informative = 0;
  for (const def of cases) {
    if (!def.hasExpected) continue;
    if (def.redundantOf !== undefined && ids.has(def.redundantOf)) continue;
    informative++;
  }
  return informative / cases.length;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface AssaySettlement {
  tokens: number;
  credibility: number;
  morale: number;
  /** 5/5 measured with every instrument right. */
  clean: boolean;
}

/** Rewards scale with the final measured score AND grader-choice quality:
 * a big number weighed with the wrong instruments settles poorly. */
export function settle(score: number, graderQ: number, setQ: number): AssaySettlement {
  const r = ASSAY.reward;
  const clean = score >= ASSAY.setSize && graderQ >= 1;
  return {
    tokens: score * r.tokensPerPass + (clean ? r.cleanBonus : 0),
    credibility: Math.round(graderQ * r.instrumentWeight + setQ * r.setWeight) + r.credibilityBase,
    morale: score >= 4 ? r.moraleHigh : score <= 2 ? r.moraleLow : 0,
    clean,
  };
}

// ---------------------------------------------------------------------------
// Persistence — localStorage `bbdm:assay`
// ---------------------------------------------------------------------------
// SHAPE (documented for the endgame's Discernment scoring, which reads it):
//   { v: 1,
//     score: <final measured score, 0..5>,
//     graderAccuracy: <graderChoiceQuality of the final set, 0..1>,
//     iterations: <number of weighings run, >= 1> }
// Written once at settlement; overwritten by a later visit. NOT run-scoped
// (survives newRun by design, like bbdm:loopbuilder's trophy).

const ASSAY_KEY = 'bbdm:assay';
const ASSAY_STORE_VERSION = 1;

export interface AssayStore {
  v: number;
  score: number;
  graderAccuracy: number;
  iterations: number;
}

export function readAssayStore(): AssayStore | null {
  try {
    const raw = window.localStorage.getItem(ASSAY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssayStore>;
    if (parsed.v !== ASSAY_STORE_VERSION) return null;
    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.graderAccuracy !== 'number' ||
      typeof parsed.iterations !== 'number'
    ) {
      return null;
    }
    return {
      v: ASSAY_STORE_VERSION,
      score: parsed.score,
      graderAccuracy: parsed.graderAccuracy,
      iterations: parsed.iterations,
    };
  } catch {
    return null;
  }
}

export function writeAssayStore(store: Omit<AssayStore, 'v'>): void {
  try {
    window.localStorage.setItem(
      ASSAY_KEY,
      JSON.stringify({ v: ASSAY_STORE_VERSION, ...store } satisfies AssayStore),
    );
  } catch {
    // Storage blocked: the assay simply isn't remembered. Non-fatal.
  }
}
