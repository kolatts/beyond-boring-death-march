/**
 * AssayOfficeScene — THE ASSAY OFFICE (mile 900). Mechanic key:
 * `assay_office`. An assayer's office that weighs claims: the player
 * arrives with a prompt that worked once, on one nugget, in good light,
 * and leaves with a measured score. A demonstrative introduction to
 * prompt/agent EVALS: golden sets, grader types (exact match /
 * code-graded / model-graded rubric), and iterating on the number.
 *
 * Entry: `{ landmarkId?, mechanic }` — landmarkId is optional so the
 * scene works standalone via the dev deep link (?minigame=assay_office)
 * before the landmark entry lands.
 *
 * Flow: claim → pick 5 of 8 cases → choose graders → animated weighing
 * (scale tips, stamps slam, score rolls) → iterate on the prompt (the
 * set stays fixed) → settle. Death is not possible here; failure is weak
 * rewards and the assayer's disappointment.
 *
 * All outcome math lives in systems/assaySim.ts (deterministic — an eval
 * should produce the same number twice); all prose lives in
 * content/assay-office.json. Days are applied via actions.advanceDay +
 * ONE tickDeadlines() call per weighing (the cabSim contract).
 *
 * Keyboard: Up/Down move, Left/Right cycle graders, Space toggles,
 * Enter confirms, digits pick directly. Fully tap-playable (padHit).
 * Reduced motion: every effect cuts to its end state.
 */

import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { doomClock, tickDeadlines } from '../systems/deadlines';
import { showCurriculumCard, isFieldNoteOpen } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import { padHit } from '../ui/touch';
import { winBurst, failPuff, prefersReducedMotion } from '../ui/transitions';
import {
  ASSAY,
  GRADER_ORDER,
  graderChoiceQuality,
  runAssay,
  setQuality,
  settle,
  writeAssayStore,
  type AssayCaseDef,
  type AssayRunResult,
  type GraderId,
  type RevisionId,
} from '../systems/assaySim';
import rawContent from '../content/assay-office.json';

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

interface CaseContent extends AssayCaseDef {
  label: string;
  category: string;
  desc: string;
  hint: string;
}

interface AssayContent {
  claim: {
    promptTitle: string;
    promptText: string;
    exampleTitle: string;
    exampleText: string;
    playerLine: string;
    assayerLines: string[];
    continueLabel: string;
  };
  pick: {
    prompt: string;
    confirmLabel: string;
    needMore: string;
    dupeNote: string;
    noExpectedNote: string;
  };
  cases: CaseContent[];
  graders: {
    prompt: string;
    confirmLabel: string;
    cycleHint: string;
    options: { id: GraderId; label: string; name: string; desc: string }[];
  };
  weigh: {
    startLine: string;
    scoreLabel: string;
    tokenNote: string;
    falsePassNote: string;
    falseFailNote: string;
    noTruthNote: string;
    firstLowLines: string[];
    firstHighLines: string[];
    continueLabel: string;
  };
  iterate: {
    prompt: string;
    activeTag: string;
    rerunNote: string;
    options: { id: RevisionId; label: string; desc: string }[];
    regradeLabel: string;
    regradeDesc: string;
    settleLabel: string;
    settleDesc: string;
  };
  done: {
    title: string;
    summaryLine: string;
    iterationsLine: string;
    cleanLines: string[];
    goodLines: string[];
    poorLines: string[];
    rewardLine: string;
    continueLabel: string;
  };
  ui: {
    title: string;
    subtitle: string;
    selectedMark: string;
    unselectedMark: string;
    pendingMark: string;
    passStamp: string;
    failStamp: string;
  };
}

const CONTENT = rawContent as AssayContent;

/** Palette (docs/DECISIONS.md). */
const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
};
const HEX = { white: 0xffffff, green: 0x1bcb01, violet: 0xbb36ff, orange: 0xf55d08, blue: 0x0da1ff };

// Layout (320x200 logical).
const SCALE_X = 160;
const SCALE_Y = 52;
const BEAM_HALF = 48;
const PAN_DROP = 12;
/** Beam resting tilt before a nugget lands: the standard side is heavier. */
const REST_TILT = -0.5;

type Phase = 'claim' | 'pick' | 'graders' | 'weigh' | 'iterate' | 'done';

export class AssayOfficeScene extends Phaser.Scene {
  private reduced = false;
  private phase: Phase = 'claim';
  private cursor = 0;

  private selectedIds: string[] = [];
  private graders: Record<string, GraderId> = {};
  private revision: RevisionId = 'v1';
  private lastRun: AssayRunResult | null = null;
  private iterations = 0;
  private busy = false;

  private headerObjs: Phaser.GameObjects.GameObject[] = [];
  private phaseObjs: Phaser.GameObjects.GameObject[] = [];
  private ledgerRows: Phaser.GameObjects.Text[] = [];
  private scaleG: Phaser.GameObjects.Graphics | null = null;
  private nugget: Phaser.GameObjects.Image | null = null;
  private tilt = REST_TILT;
  private swayTween: Phaser.Tweens.Tween | null = null;

  constructor() {
    super('AssayOffice');
  }

  init(_data: { landmarkId?: string; mechanic?: string }): void {
    // landmarkId intentionally unused: the scene works from any entry.
    this.phase = 'claim';
    this.cursor = 0;
    this.selectedIds = [];
    this.graders = {};
    this.revision = 'v1';
    this.lastRun = null;
    this.iterations = 0;
    this.busy = false;
    this.headerObjs = [];
    this.phaseObjs = [];
    this.ledgerRows = [];
    this.scaleG = null;
    this.nugget = null;
    this.tilt = REST_TILT;
    this.swayTween = null;
    this.scaleLabels = [];
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.reduced = prefersReducedMotion();
    this.cameras.main.setBackgroundColor('#000000');
    this.makeTextures();
    this.drawHeader();

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.onMove(-1));
      kb.on('keydown-DOWN', () => this.onMove(1));
      kb.on('keydown-LEFT', () => this.onCycle(-1));
      kb.on('keydown-RIGHT', () => this.onCycle(1));
      kb.on('keydown-SPACE', () => this.onToggle());
      kb.on('keydown-ENTER', () => this.onConfirm());
      const digits = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'] as const;
      digits.forEach((key, i) => kb.on(`keydown-${key}`, () => this.onDigit(i)));
    }

    this.showClaim();
    bus.emit('scene:ready', { scene: 'AssayOffice' });
  }

  // -------------------------------------------------------------------------
  // Input routing (all guarded against an open Field Note)
  // -------------------------------------------------------------------------

  private onMove(delta: number): void {
    if (isFieldNoteOpen() || this.busy) return;
    const n = this.listLength();
    if (n === 0) return;
    this.cursor = (this.cursor + delta + n) % n;
    this.redrawPhase();
  }

  private onCycle(delta: number): void {
    if (isFieldNoteOpen() || this.busy) return;
    if (this.phase !== 'graders') return;
    const caseId = this.selectedIds[this.cursor];
    if (caseId === undefined) return;
    const current = this.graders[caseId] ?? 'exact';
    const i = GRADER_ORDER.indexOf(current);
    const next = GRADER_ORDER[(i + delta + GRADER_ORDER.length) % GRADER_ORDER.length];
    if (next) this.graders[caseId] = next;
    this.redrawPhase();
  }

  private onToggle(): void {
    if (isFieldNoteOpen() || this.busy) return;
    if (this.phase === 'pick') {
      this.togglePick(this.cursor);
    } else {
      this.onConfirm();
    }
  }

  private onDigit(index: number): void {
    if (isFieldNoteOpen() || this.busy) return;
    switch (this.phase) {
      case 'pick':
        if (index < CONTENT.cases.length) {
          this.cursor = index;
          this.togglePick(index);
        }
        break;
      case 'graders': {
        // 1/2/3 set the grader for the cursor row.
        const grader = GRADER_ORDER[index];
        const caseId = this.selectedIds[this.cursor];
        if (grader && caseId !== undefined) {
          this.graders[caseId] = grader;
          this.redrawPhase();
        }
        break;
      }
      case 'iterate':
        if (index < this.iterateOptionCount()) {
          this.cursor = index;
          this.redrawPhase();
          this.onConfirm();
        }
        break;
      default:
        break;
    }
  }

  private onConfirm(): void {
    if (isFieldNoteOpen() || this.busy) return;
    switch (this.phase) {
      case 'claim':
        this.showPick();
        break;
      case 'pick':
        if (this.selectedIds.length === ASSAY.setSize) this.showGraders();
        else this.redrawPhase();
        break;
      case 'graders':
        this.startWeigh();
        break;
      case 'weigh':
        void this.afterWeigh();
        break;
      case 'iterate':
        this.confirmIterate();
        break;
      case 'done':
        this.scene.start('Trail');
        break;
    }
  }

  private listLength(): number {
    switch (this.phase) {
      case 'pick':
        return CONTENT.cases.length;
      case 'graders':
        return this.selectedIds.length;
      case 'iterate':
        return this.iterateOptionCount();
      default:
        return 0;
    }
  }

  private iterateOptionCount(): number {
    return CONTENT.iterate.options.length + 2; // + regrade + settle
  }

  private redrawPhase(): void {
    switch (this.phase) {
      case 'pick':
        this.showPick(true);
        break;
      case 'graders':
        this.showGraders(true);
        break;
      case 'iterate':
        this.showIterate(true);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Phase 1 — THE CLAIM
  // -------------------------------------------------------------------------

  private showClaim(): void {
    this.phase = 'claim';
    this.clearPhase();
    const cl = CONTENT.claim;
    let y = 24;
    y = this.para(cl.promptTitle, y, C.white, 7) + 2;
    y = this.para(cl.promptText, y, C.green, 7) + 4;
    y = this.para(cl.exampleTitle, y, C.white, 7) + 2;
    y = this.para(cl.exampleText, y, C.green, 7) + 4;
    y = this.para(cl.playerLine, y, C.blue, 7) + 4;
    for (const line of cl.assayerLines) {
      y = this.para(line, y, C.orange, 7) + 2;
    }
    this.drawContinue(cl.continueLabel);
  }

  // -------------------------------------------------------------------------
  // Phase 2 — BUILD THE GOLDEN SET
  // -------------------------------------------------------------------------

  private togglePick(index: number): void {
    const def = CONTENT.cases[index];
    if (!def) return;
    const at = this.selectedIds.indexOf(def.id);
    if (at >= 0) this.selectedIds.splice(at, 1);
    else if (this.selectedIds.length < ASSAY.setSize) this.selectedIds.push(def.id);
    this.showPick(true);
  }

  private showPick(redraw = false): void {
    if (!redraw) {
      this.phase = 'pick';
      this.cursor = 0;
      this.destroyScale();
    }
    this.clearPhase();
    this.para(CONTENT.pick.prompt, 22, C.blue, 6);
    CONTENT.cases.forEach((def, i) => {
      const y = 38 + i * 12;
      const picked = this.selectedIds.includes(def.id);
      const mark = picked ? CONTENT.ui.selectedMark : CONTENT.ui.unselectedMark;
      const color = picked ? C.green : i === this.cursor ? C.white : '#8a8a8a';
      const row = this.text(8, y, `${i === this.cursor ? '>' : ' '} ${mark} ${i + 1}. ${def.label}`, color, 7);
      padHit(row, 8, 2, 12);
      row.on('pointerdown', () => {
        if (this.busy) return;
        this.cursor = i;
        this.togglePick(i);
      });
      const cat = this.add
        .text(GAME_WIDTH - 6, y + 1, `[${def.category}]`, {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: picked ? C.green : C.blue,
        })
        .setOrigin(1, 0);
      this.phaseObjs.push(row, cat);
    });

    // Cursor case detail.
    const cur = CONTENT.cases[this.cursor];
    if (cur) {
      let y = 138;
      y = this.para(cur.desc, y, C.green, 6) + 1;
      this.para(cur.hint, y, C.blue, 6);
    }
    // The assayer comments on questionable picks before the weighing.
    const noteY = 170;
    if (this.selectedIds.includes('no_expected')) {
      this.para(CONTENT.pick.noExpectedNote, noteY, C.orange, 6);
    } else if (this.hasDupePick()) {
      this.para(CONTENT.pick.dupeNote, noteY, C.orange, 6);
    }

    if (this.selectedIds.length === ASSAY.setSize) {
      this.drawContinue(CONTENT.pick.confirmLabel);
    } else {
      const t = this.text(
        4,
        190,
        subst(CONTENT.pick.needMore, { need: ASSAY.setSize, have: this.selectedIds.length }),
        C.blue,
        6,
      );
      this.phaseObjs.push(t);
    }
  }

  private hasDupePick(): boolean {
    const ids = new Set(this.selectedIds);
    return this.selectedCases().some((d) => d.redundantOf !== undefined && ids.has(d.redundantOf));
  }

  private selectedCases(): CaseContent[] {
    return this.selectedIds
      .map((id) => CONTENT.cases.find((c) => c.id === id))
      .filter((c): c is CaseContent => c !== undefined);
  }

  // -------------------------------------------------------------------------
  // Phase 3 — CHOOSE GRADERS
  // -------------------------------------------------------------------------

  private showGraders(redraw = false): void {
    if (!redraw) {
      this.phase = 'graders';
      this.cursor = 0;
      for (const id of this.selectedIds) {
        if (!this.graders[id]) this.graders[id] = 'exact';
      }
    }
    this.clearPhase();
    this.para(CONTENT.graders.prompt, 22, C.blue, 6);

    const cases = this.selectedCases();
    cases.forEach((def, i) => {
      const y = 40 + i * 13;
      const grader = this.graders[def.id] ?? 'exact';
      const opt = CONTENT.graders.options.find((o) => o.id === grader);
      const sel = i === this.cursor;
      const row = this.text(8, y, `${sel ? '>' : ' '} ${def.label}`, sel ? C.white : C.green, 7);
      padHit(row, 8, 2, 13);
      row.on('pointerdown', () => {
        if (this.busy) return;
        if (this.cursor === i) this.onCycle(1);
        else {
          this.cursor = i;
          this.redrawPhase();
        }
      });
      const g = this.add
        .text(GAME_WIDTH - 6, y, `◄ ${opt?.label ?? grader} ►`, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: grader === 'model' ? C.orange : C.white,
        })
        .setOrigin(1, 0);
      padHit(g, 8, 2, 13);
      g.on('pointerdown', () => {
        if (this.busy) return;
        this.cursor = i;
        this.onCycle(1);
      });
      this.phaseObjs.push(row, g);
    });

    // Cursor case + grader detail.
    const cur = cases[this.cursor];
    if (cur) {
      let y = 112;
      y = this.para(cur.desc, y, C.green, 6) + 2;
      const grader = this.graders[cur.id] ?? 'exact';
      const opt = CONTENT.graders.options.find((o) => o.id === grader);
      if (opt) {
        y = this.para(
          `${opt.name}: ${subst(opt.desc, { tokens: ASSAY.modelTokensPerCase })}`,
          y,
          C.white,
          6,
        ) + 2;
      }
      this.para(CONTENT.graders.cycleHint, y, C.blue, 6);
    }

    const modelCount = this.selectedIds.filter((id) => this.graders[id] === 'model').length;
    if (modelCount > 0) {
      const t = this.text(
        4,
        176,
        subst(CONTENT.weigh.tokenNote, { tokens: modelCount * ASSAY.modelTokensPerCase }),
        C.orange,
        6,
      );
      this.phaseObjs.push(t);
    }
    this.drawContinue(CONTENT.graders.confirmLabel);
  }

  // -------------------------------------------------------------------------
  // Phase 4 — RUN THE ASSAY (the weighing)
  // -------------------------------------------------------------------------

  private startWeigh(): void {
    this.phase = 'weigh';
    this.busy = true;
    this.clearPhase();

    const cases = this.selectedCases();
    const run = runAssay(cases, this.graders, this.revision);
    this.lastRun = run;
    this.iterations += 1;

    // State truth first; the animation is a replay (cab contract: one
    // advanceDay + one tickDeadlines per weighing).
    if (run.tokenCost > 0) {
      actions.applyResourceDelta(
        { tokens: -run.tokenCost },
        subst(CONTENT.weigh.tokenNote, { tokens: run.tokenCost }),
      );
    }
    actions.advanceDay(ASSAY.daysPerRun);
    const notices = tickDeadlines();
    if (notices.length > 0) actions.log(...notices);
    saveRun(getState());
    this.drawHeader();

    this.para(CONTENT.weigh.startLine, 22, C.blue, 6);
    this.buildScale(false);

    // The ledger: one row per case, stamped as the weighing proceeds.
    this.ledgerRows = cases.map((def, i) => {
      const grader = this.graders[def.id] ?? 'exact';
      const opt = CONTENT.graders.options.find((o) => o.id === grader);
      const row = this.text(
        8,
        112 + i * 10,
        `${CONTENT.ui.pendingMark} ${def.label} [${opt?.label ?? grader}]`,
        '#8a8a8a',
        7,
      );
      this.phaseObjs.push(row);
      return row;
    });

    if (this.reduced) {
      run.verdicts.forEach((_, i) => this.stampLedger(i));
      this.finishWeigh();
      return;
    }
    this.weighCase(0);
  }

  /** One case: nugget pans onto the scale, the beam answers, a stamp slams. */
  private weighCase(index: number): void {
    const run = this.lastRun;
    if (!run) return;
    const verdict = run.verdicts[index];
    if (!verdict) {
      this.finishWeigh();
      return;
    }
    this.ledgerRows[index]?.setColor(C.white);

    const nug = this.add.image(GAME_WIDTH + 12, 18, 'assay_nugget').setDepth(6);
    this.nugget = nug;
    this.phaseObjs.push(nug);
    const pan = this.panPoint(1);
    this.tweens.add({
      targets: nug,
      x: pan.x,
      y: pan.y - 3,
      angle: -14,
      duration: 380,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        // The beam answers: balanced for true weight, hard tip for short.
        this.tweenTilt(verdict.reported ? 0 : -0.9, 420, () => {
          this.slamStamp(verdict.reported, () => {
            this.stampLedger(index);
            this.tweens.add({ targets: nug, alpha: 0, duration: 180, delay: 120 });
            this.tweenTilt(REST_TILT, 260, () => {
              this.nugget = null;
              this.time.delayedCall(180, () => this.weighCase(index + 1));
            });
          });
        });
      },
    });
  }

  private stampLedger(index: number): void {
    const verdict = this.lastRun?.verdicts[index];
    const row = this.ledgerRows[index];
    const def = this.selectedCases()[index];
    if (!verdict || !row || !def) return;
    const glyph = verdict.reported ? '✓' : '×';
    const flag = verdict.falseKind !== null ? ' !' : '';
    const grader = CONTENT.graders.options.find((o) => o.id === verdict.grader);
    row.setText(`${glyph} ${def.label} [${grader?.label ?? verdict.grader}]${flag}`);
    row.setColor(verdict.reported ? C.green : C.violet);
  }

  private slamStamp(pass: boolean, done: () => void): void {
    const label = pass ? `${CONTENT.ui.passStamp} ✓` : `${CONTENT.ui.failStamp} ×`;
    const stamp = this.add
      .text(SCALE_X, 34, label, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: pass ? C.green : C.violet,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(12)
      .setScale(2.4)
      .setAlpha(0)
      .setAngle(-6);
    this.phaseObjs.push(stamp);
    this.tweens.add({
      targets: stamp,
      scale: 1,
      alpha: 1,
      duration: 190,
      ease: 'Back.easeIn',
      onComplete: () => {
        if (pass) this.cameras.main.flash(90, 27, 203, 1);
        else this.cameras.main.shake(150, 0.008);
        this.tweens.add({ targets: stamp, alpha: 0, duration: 220, delay: 320 });
        this.time.delayedCall(420, done);
      },
    });
  }

  /** Score counter rolls up, then the assayer speaks. */
  private finishWeigh(): void {
    const run = this.lastRun;
    if (!run) return;
    const scoreText = this.add
      .text(SCALE_X, 98, subst(CONTENT.weigh.scoreLabel, { score: 0, total: ASSAY.setSize }), {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: C.white,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.phaseObjs.push(scoreText);

    const showRest = (): void => {
      scoreText.setText(subst(CONTENT.weigh.scoreLabel, { score: run.score, total: ASSAY.setSize }));
      scoreText.setColor(run.score >= 4 ? C.green : run.score <= 2 ? C.orange : C.white);
      // Under the ledger: the assayer's first-weighing verdict, then any
      // distinct false-verdict notes (the visible lies), once each.
      let y = 163;
      if (this.iterations === 1) {
        const assayerLines =
          run.score >= 4 ? CONTENT.weigh.firstHighLines : CONTENT.weigh.firstLowLines;
        y = this.para(assayerLines.join(' '), y, C.white, 6);
      }
      const kinds = new Set(run.verdicts.map((v) => (v.actual === null ? 'none' : v.falseKind)));
      if (kinds.has('none')) y = this.para(CONTENT.weigh.noTruthNote, y, C.orange, 6);
      if (kinds.has('pass')) y = this.para(CONTENT.weigh.falsePassNote, y, C.orange, 6);
      if (kinds.has('fail')) this.para(CONTENT.weigh.falseFailNote, y, C.orange, 6);
      this.busy = false;
      this.drawContinue(CONTENT.weigh.continueLabel);
      // The office settles; the beam breathes while you read the ledger.
      this.startSway();
    };

    if (this.reduced) {
      showRest();
      return;
    }
    let shown = 0;
    const roll = this.time.addEvent({
      delay: 110,
      repeat: Math.max(0, run.score),
      callback: () => {
        scoreText.setText(subst(CONTENT.weigh.scoreLabel, { score: shown, total: ASSAY.setSize }));
        scoreText.setScale(1.25);
        this.tweens.add({ targets: scoreText, scale: 1, duration: 90 });
        if (shown >= run.score) {
          roll.remove();
          this.time.delayedCall(220, showRest);
        }
        shown++;
      },
    });
  }

  /** Continue from the ledger: curriculum card (first weighing), then iterate. */
  private async afterWeigh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // The lesson, after the joke (the score) has landed. Deferred one
    // macrotask so the Enter that dismissed the ledger can't also dismiss
    // the card (same guard as CabCrossingScene).
    if (!getState().flags['assayEvalCardShown']) {
      actions.setFlag('assayEvalCardShown');
      saveRun(getState());
      await new Promise((r) => setTimeout(r, 0));
      await showCurriculumCard('eval_measurement');
    }
    this.busy = false;
    this.showIterate();
  }

  // -------------------------------------------------------------------------
  // Phase 5 — ITERATE
  // -------------------------------------------------------------------------

  private showIterate(redraw = false): void {
    if (!redraw) {
      this.phase = 'iterate';
      this.cursor = 0;
      this.destroyScale();
    }
    this.clearPhase();
    this.para(CONTENT.iterate.prompt, 22, C.blue, 6);
    const run = this.lastRun;
    if (run) {
      const t = this.text(
        4,
        34,
        `${subst(CONTENT.weigh.scoreLabel, { score: run.score, total: ASSAY.setSize })}  (WEIGHING ${this.iterations})`,
        run.score >= 4 ? C.green : C.orange,
        7,
      );
      this.phaseObjs.push(t);
    }

    const rows: { label: string; desc: string; tag?: string }[] = [
      ...CONTENT.iterate.options.map((o) => {
        const entry: { label: string; desc: string; tag?: string } = {
          label: o.label,
          desc: o.desc,
        };
        if (o.id === this.revision) entry.tag = CONTENT.iterate.activeTag;
        return entry;
      }),
      { label: CONTENT.iterate.regradeLabel, desc: CONTENT.iterate.regradeDesc },
      { label: CONTENT.iterate.settleLabel, desc: CONTENT.iterate.settleDesc },
    ];
    rows.forEach((row, i) => {
      const y = 48 + i * 14;
      const sel = i === this.cursor;
      const t = this.text(
        8,
        y,
        `${sel ? '>' : ' '} ${i + 1}. ${row.label}${row.tag ? `  [${row.tag}]` : ''}`,
        sel ? C.white : i >= rows.length - 2 ? C.blue : C.green,
        7,
      );
      padHit(t, 8, 2, 14);
      t.on('pointerdown', () => {
        if (this.busy) return;
        if (this.cursor === i) this.onConfirm();
        else {
          this.cursor = i;
          this.redrawPhase();
        }
      });
      this.phaseObjs.push(t);
    });

    const cur = rows[this.cursor];
    if (cur) {
      const y = this.para(cur.desc, 128, C.green, 6) + 2;
      this.para(subst(CONTENT.iterate.rerunNote, { days: ASSAY.daysPerRun }), y, C.blue, 6);
    }
  }

  private confirmIterate(): void {
    const revisionCount = CONTENT.iterate.options.length;
    if (this.cursor < revisionCount) {
      const opt = CONTENT.iterate.options[this.cursor];
      if (opt) {
        this.revision = opt.id;
        this.startWeigh();
      }
      return;
    }
    if (this.cursor === revisionCount) {
      // RECONSIDER THE INSTRUMENTS: same prompt, new graders, then rerun.
      this.showGraders();
      return;
    }
    this.showDone();
  }

  // -------------------------------------------------------------------------
  // Phase 6 — SETTLEMENT
  // -------------------------------------------------------------------------

  private showDone(): void {
    this.phase = 'done';
    this.clearPhase();
    this.destroyScale();
    const run = this.lastRun;
    const cases = this.selectedCases();
    const score = run?.score ?? 0;
    const graderQ = graderChoiceQuality(cases, this.graders);
    const setQ = setQuality(cases);
    const s = settle(score, graderQ, setQ);

    // Rewards scale with score + grader-choice quality; the endgame's
    // Discernment scoring reads bbdm:assay (shape documented in assaySim).
    actions.applyResourceDelta(
      { tokens: s.tokens, credibility: s.credibility, morale: s.morale },
      `ASSAY SETTLED: ${score}/${ASSAY.setSize}`,
    );
    writeAssayStore({ score, graderAccuracy: graderQ, iterations: this.iterations });
    saveRun(getState());
    this.drawHeader();

    const d = CONTENT.done;
    let y = 28;
    y = this.para(d.title, y, C.white, 9) + 4;
    y =
      this.para(
        subst(d.summaryLine, {
          score,
          total: ASSAY.setSize,
          graders: Math.round(graderQ * 100),
          set: Math.round(setQ * 100),
        }),
        y,
        score >= 4 ? C.green : C.orange,
        7,
      ) + 3;
    y = this.para(subst(d.iterationsLine, { iterations: this.iterations }), y, C.blue, 7) + 5;
    const lines = s.clean ? d.cleanLines : score >= 3 ? d.goodLines : d.poorLines;
    for (const line of lines) {
      y = this.para(line, y, C.orange, 7) + 2;
    }
    y += 3;
    this.para(
      subst(d.rewardLine, {
        tokens: s.tokens,
        credibility: signed(s.credibility),
        morale: signed(s.morale),
      }),
      y,
      C.white,
      7,
    );
    this.drawContinue(d.continueLabel);

    if (s.clean || score >= 4) winBurst(this, GAME_WIDTH / 2, 70);
    else if (score <= 2) failPuff(this, GAME_WIDTH / 2, 70);
  }

  // -------------------------------------------------------------------------
  // The scale (drawn primitives; Wave 4 swaps in sprites)
  // -------------------------------------------------------------------------

  private buildScale(ambient: boolean): void {
    if (!this.scaleG) {
      this.scaleG = this.add.graphics().setDepth(4);
    }
    if (this.scaleLabels.length === 0) {
      const std = this.add
        .text(SCALE_X - BEAM_HALF, SCALE_Y + 34, 'STANDARD', {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: C.green,
        })
        .setOrigin(0.5, 0)
        .setDepth(4);
      const spec = this.add
        .text(SCALE_X + BEAM_HALF, SCALE_Y + 34, 'THE CLAIM', {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: C.orange,
        })
        .setOrigin(0.5, 0)
        .setDepth(4);
      this.scaleLabels = [std, spec];
    }
    this.tilt = REST_TILT;
    if (ambient) {
      this.startSway();
    } else {
      // A weighing is about to drive the tilt; the idle sway yields.
      this.swayTween?.remove();
      this.swayTween = null;
    }
    this.drawScale();
  }

  /** Ambient sway: the standard is heavier; the beam breathes. */
  private startSway(): void {
    if (this.reduced || this.swayTween) return;
    this.swayTween = this.tweens.addCounter({
      from: REST_TILT - 0.06,
      to: REST_TILT + 0.06,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        this.tilt = tw.getValue() ?? REST_TILT;
        this.drawScale();
      },
    });
  }

  private destroyScale(): void {
    this.swayTween?.remove();
    this.swayTween = null;
    this.scaleG?.destroy();
    this.scaleG = null;
    this.nugget?.destroy();
    this.nugget = null;
    this.scaleLabels.forEach((t) => t.destroy());
    this.scaleLabels = [];
  }

  /** Beam end point: side -1 = standard pan (left), +1 = specimen pan. */
  private panPoint(side: -1 | 1): { x: number; y: number } {
    const dy = Math.sin(this.tilt * 0.35) * BEAM_HALF;
    return { x: SCALE_X + side * BEAM_HALF, y: SCALE_Y + side * dy + PAN_DROP };
  }

  private drawScale(): void {
    const g = this.scaleG;
    if (!g) return;
    g.clear();
    // Stand.
    g.fillStyle(HEX.white, 0.9);
    g.fillRect(SCALE_X - 22, 94, 44, 2);
    g.fillRect(SCALE_X - 1, SCALE_Y, 3, 94 - SCALE_Y);
    // Beam.
    const dy = Math.sin(this.tilt * 0.35) * BEAM_HALF;
    const lx = SCALE_X - BEAM_HALF;
    const rx = SCALE_X + BEAM_HALF;
    const ly = SCALE_Y - dy;
    const ry = SCALE_Y + dy;
    g.lineStyle(2, HEX.white, 1);
    g.lineBetween(lx, ly, rx, ry);
    g.fillStyle(HEX.orange, 1);
    g.fillRect(SCALE_X - 2, SCALE_Y - 2, 4, 4); // pivot pin
    // Chains + pans.
    for (const [ex, ey, side] of [
      [lx, ly, -1],
      [rx, ry, 1],
    ] as const) {
      g.lineStyle(1, HEX.blue, 0.9);
      g.lineBetween(ex - 8, ey + 1, ex, ey + PAN_DROP - 2);
      g.lineBetween(ex + 8, ey + 1, ex, ey + PAN_DROP - 2);
      g.fillStyle(HEX.white, 1);
      g.fillRect(ex - 13, ey + PAN_DROP - 2, 26, 2);
      if (side === -1) {
        // The standard: the known-good weight. The golden set, in brass.
        g.fillStyle(HEX.green, 1);
        g.fillRect(ex - 5, ey + PAN_DROP - 9, 10, 7);
      }
    }
  }

  private scaleLabels: Phaser.GameObjects.Text[] = [];

  private tweenTilt(to: number, duration: number, done: () => void): void {
    if (this.reduced) {
      this.tilt = to;
      this.drawScale();
      done();
      return;
    }
    const from = this.tilt;
    this.tweens.addCounter({
      from,
      to,
      duration,
      ease: 'Back.easeOut',
      onUpdate: (tw) => {
        this.tilt = tw.getValue() ?? to;
        this.drawScale();
        // The nugget rides the specimen pan.
        if (this.nugget) {
          const p = this.panPoint(1);
          this.nugget.setPosition(p.x, p.y - 3);
        }
      },
      onComplete: () => done(),
    });
  }

  // -------------------------------------------------------------------------
  // Shared UI
  // -------------------------------------------------------------------------

  private text(x: number, y: number, str: string, color: string, size = 8): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, str, { fontFamily: 'monospace', fontSize: `${size}px`, color })
      .setOrigin(0, 0)
      .setDepth(8);
  }

  /** Wrapped paragraph; returns the y just under it. */
  private para(str: string, y: number, color: string, size: number): number {
    const t = this.add
      .text(4, y, str, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        wordWrap: { width: GAME_WIDTH - 8 },
        lineSpacing: 1,
      })
      .setOrigin(0, 0)
      .setDepth(8);
    this.phaseObjs.push(t);
    return y + t.height + 2;
  }

  private drawContinue(label: string): void {
    const t = this.add
      .text(GAME_WIDTH / 2, 190, label, { fontFamily: 'monospace', fontSize: '8px', color: C.white })
      .setOrigin(0.5, 0)
      .setDepth(10);
    padHit(t, 20, 5);
    t.on('pointerdown', () => this.onConfirm());
    this.phaseObjs.push(t);
  }

  private drawHeader(): void {
    this.headerObjs.forEach((o) => o.destroy());
    this.headerObjs = [];
    const s = getState();
    const title = this.text(4, 2, CONTENT.ui.title, C.white);
    const sub = this.text(4, 12, CONTENT.ui.subtitle, C.blue, 6);
    const md = this.add
      .text(GAME_WIDTH - 4, 2, `MILE ${Math.floor(s.mile)}  DAY ${s.day}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: C.white,
      })
      .setOrigin(1, 0);
    const clock = doomClock(s.day);
    const clockColor = clock.phase === 'missed' ? C.violet : clock.phase === 'warn' ? C.orange : C.green;
    const glyph = clock.phase === 'missed' ? '×' : clock.phase === 'warn' ? '!' : '✓';
    const clockText =
      clock.phase === 'missed'
        ? `${glyph} GO-LIVE ${-clock.daysRemaining}d PAST`
        : `${glyph} GO-LIVE ${clock.daysRemaining}d`;
    const clockLine = this.add
      .text(GAME_WIDTH - 4, 12, clockText, { fontFamily: 'monospace', fontSize: '6px', color: clockColor })
      .setOrigin(1, 0);
    this.headerObjs.push(title, sub, md, clockLine);
  }

  private clearPhase(): void {
    this.phaseObjs.forEach((o) => o.destroy());
    this.phaseObjs = [];
    this.ledgerRows = [];
  }

  private makeTextures(): void {
    if (!this.textures.exists('assay_nugget')) {
      const g = this.add.graphics();
      g.fillStyle(HEX.orange, 1);
      g.fillRect(1, 3, 9, 5);
      g.fillRect(3, 1, 5, 7);
      g.fillStyle(HEX.white, 0.9);
      g.fillRect(3, 2, 2, 1); // the glint that sold the demo
      g.generateTexture('assay_nugget', 11, 9);
      g.destroy();
    }
  }
}

// ---------------------------------------------------------------------------

function subst(line: string, subs: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in subs ? String(subs[key]) : match,
  );
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
