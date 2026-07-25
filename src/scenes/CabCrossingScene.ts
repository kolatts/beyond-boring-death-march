/**
 * CabCrossingScene — THE CAB CROSSING (spec §7.5, mile 830 + random
 * re-trigger). The Change Advisory Board is a river. Its depth is measured
 * in business days and the measurement was taken by someone who is out
 * this week.
 *
 * Entry: `{ landmarkId?, mechanic }` — landmarkId is optional so a later
 * wave can re-fire this as a random event from anywhere on the trail.
 * Outcome math lives in systems/cabSim.ts (seeded via actions.rand);
 * all prose lives in content/cab-crossing.json.
 *
 * Keyboard: Up/Down move the cursor, Enter/Space select, 1–4 pick
 * directly, Enter advances outcome beats. Fully mouse-playable too.
 *
 * DAYS: crossing days are applied via actions.advanceDay + ONE
 * tickDeadlines() call — same simplification as complyDeadline (see the
 * contract comment in systems/cabSim.ts). The ferry interacts with the
 * Day-120 doom clock exactly as painfully as intended.
 *
 * Reduced motion: every effect (paperwork drift, wagon tilt, splash,
 * camera shake, calendar tear, stamp slam) cuts to its end state.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { coverBackdrop, queueArt } from '../systems/art';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { doomClock, tickDeadlines } from '../systems/deadlines';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import { padHit } from '../ui/touch';
import {
  CAB,
  readCabStore,
  resolveCaulk,
  resolveFerry,
  resolveFord,
  resolveWait,
  rollRiver,
  writeCabStore,
  type CabBeat,
  type CabChoice,
  type CabOutcome,
  type RiverState,
} from '../systems/cabSim';
import rawContent from '../content/cab-crossing.json';

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

interface CabContent {
  arrival: { prompt: string; depthLine: string };
  conditions: string[];
  options: { id: CabChoice; label: string; hint: string }[];
  outcomes: Record<CabBeat, string[]>;
  ui: {
    registerNote: string;
    cannotAffordCaulk: string;
    continueLabel: string;
    chooseAgainLabel: string;
    stamp: string;
  };
}

const CONTENT = rawContent as CabContent;

/** Apple II palette (docs/DECISIONS.md). */
const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
};
const HEX = { white: 0xffffff, green: 0x1bcb01, violet: 0xbb36ff, orange: 0xf55d08, blue: 0x0da1ff };

// Layout (320x200 logical).
const RIVER_TOP = 48;
const RIVER_BOTTOM = 110;
const WAGON_START = { x: 64, y: 110 };
/** Far shore: just inside the river's top edge, clear of the sign text. */
const WAGON_END = { x: 64, y: RIVER_TOP + 9 };
const TEXT_AREA_Y = 120;

type Phase = 'choice' | 'playing' | 'done';

interface Step {
  beat: CabBeat;
  /** Substitutions for {placeholders} in this beat's lines. */
  subs: Record<string, string | number>;
  /** Optional extra line (orange) appended under the beat copy. */
  extraLine?: string;
  /** Visual effect; must call done() exactly once. Checks reduced motion itself. */
  effect: (done: () => void) => void;
}

export class CabCrossingScene extends Phaser.Scene {
  private reduced = false;
  private phase: Phase = 'choice';
  private menuIndex = 0;
  private river: RiverState = { depthDays: 8, conditionIndex: 0 };

  private headerObjs: Phaser.GameObjects.GameObject[] = [];
  private signObjs: Phaser.GameObjects.GameObject[] = [];
  private menuObjs: Phaser.GameObjects.GameObject[] = [];
  private beatObjs: Phaser.GameObjects.GameObject[] = [];
  private forms: Phaser.GameObjects.Image[] = [];
  private formSpeeds: number[] = [];
  private wagon!: Phaser.GameObjects.Image;

  private steps: Step[] = [];
  private stepIndex = -1;
  private stepReady = false;
  private finishing = false;
  private outcome: CabOutcome | null = null;
  private deadlineNotices: string[] = [];
  private noticeShown = false;

  constructor() {
    super('CabCrossing');
  }

  init(_data: { landmarkId?: string; mechanic?: string }): void {
    // landmarkId intentionally unused: the scene works from any entry
    // (landmark arrival or a random-event re-trigger).
    this.phase = 'choice';
    this.menuIndex = 0;
    this.steps = [];
    this.stepIndex = -1;
    this.stepReady = false;
    this.finishing = false;
    this.outcome = null;
    this.deadlineNotices = [];
    this.noticeShown = false;
    this.headerObjs = [];
    this.signObjs = [];
    this.menuObjs = [];
    this.beatObjs = [];
    this.forms = [];
    this.formSpeeds = [];
  }

  preload(): void {
    // Lazy per-scene art: the CAB river hero piece.
    queueArt(this, { 'cab-river-art': 'cab-river.png' });
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.setBackgroundColor('#000000');
    this.makeTextures();

    // The river of paperwork, as painted. Dimmed so the crossing geometry
    // (banks, drifting forms, the wagon) stays readable on top; veils keep
    // the header and the options menu legible.
    if (coverBackdrop(this, 'cab-river-art', GAME_WIDTH, GAME_HEIGHT, 0.55)) {
      this.add.rectangle(GAME_WIDTH / 2, 22, GAME_WIDTH, 46, 0x000000, 0.5);
      this.add.rectangle(GAME_WIDTH / 2, TEXT_AREA_Y + 42, GAME_WIDTH, 92, 0x000000, 0.72);
    }

    // The river: a band of drifting paperwork.
    this.add.rectangle(GAME_WIDTH / 2, (RIVER_TOP + RIVER_BOTTOM) / 2, GAME_WIDTH, RIVER_BOTTOM - RIVER_TOP, HEX.blue, 0.22);
    this.add.rectangle(GAME_WIDTH / 2, RIVER_TOP, GAME_WIDTH, 1, HEX.blue, 0.9);
    this.add.rectangle(GAME_WIDTH / 2, RIVER_BOTTOM, GAME_WIDTH, 1, HEX.blue, 0.9);
    // Far bank.
    this.add.rectangle(GAME_WIDTH / 2, RIVER_TOP - 3, GAME_WIDTH, 5, HEX.green, 0.25);
    this.add
      .text(GAME_WIDTH - 4, RIVER_TOP - 10, 'PRODUCTION →', { fontFamily: 'monospace', fontSize: '7px', color: C.green })
      .setOrigin(1, 0);
    this.spawnPaperwork();

    this.wagon = this.add.image(WAGON_START.x, WAGON_START.y, 'cab_wagon').setDepth(5);

    this.river = rollRiver(actions.rand, CONTENT.conditions.length);
    saveRun(getState());

    this.drawHeader();
    this.drawSign();
    this.drawMenu();

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.moveCursor(-1));
      kb.on('keydown-DOWN', () => this.moveCursor(1));
      kb.on('keydown-ENTER', () => this.confirm());
      kb.on('keydown-SPACE', () => this.confirm());
      kb.on('keydown-ONE', () => this.pick(0));
      kb.on('keydown-TWO', () => this.pick(1));
      kb.on('keydown-THREE', () => this.pick(2));
      kb.on('keydown-FOUR', () => this.pick(3));
    }

    bus.emit('scene:ready', { scene: 'CabCrossing' });
  }

  override update(_time: number, delta: number): void {
    if (this.reduced) return;
    // Paperwork drifts downstream forever. It is never processed.
    for (let i = 0; i < this.forms.length; i++) {
      const f = this.forms[i];
      const v = this.formSpeeds[i];
      if (!f || v === undefined) continue;
      f.x += (v * delta) / 1000;
      if (f.x > GAME_WIDTH + 10) f.x = -10;
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private moveCursor(delta: number): void {
    if (this.phase !== 'choice') return;
    const n = CONTENT.options.length;
    this.menuIndex = (this.menuIndex + delta + n) % n;
    this.drawMenu();
  }

  private pick(index: number): void {
    if (this.phase !== 'choice') return;
    this.menuIndex = index;
    this.drawMenu();
    this.confirm();
  }

  private confirm(): void {
    if (this.phase === 'choice') {
      const opt = CONTENT.options[this.menuIndex];
      if (opt) this.choose(opt.id);
    } else if (this.phase === 'playing' && this.stepReady) {
      this.advanceStep();
    }
  }

  // -------------------------------------------------------------------------
  // Choice → outcome
  // -------------------------------------------------------------------------

  private choose(choice: CabChoice): void {
    const s = getState();
    if (choice === 'caulk' && s.resources.tokens < CAB.caulk.tokens) {
      this.flashCaulkNote();
      return;
    }

    let outcome: CabOutcome;
    switch (choice) {
      case 'ford': {
        const candidates = s.party
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.alive && m.specialization !== 'you')
          .map(({ i }) => i);
        outcome = resolveFord(this.river, actions.rand, candidates);
        break;
      }
      case 'caulk':
        outcome = resolveCaulk(actions.rand);
        break;
      case 'ferry':
        outcome = resolveFerry(actions.rand);
        break;
      case 'wait':
      default:
        outcome = resolveWait(actions.rand);
        break;
    }
    this.outcome = outcome;
    this.applyOutcome(outcome);
    this.steps = this.buildSteps(outcome);
    this.stepIndex = -1;
    this.phase = 'playing';
    this.clearMenu();
    this.advanceStep();
  }

  /** State truth first; the animation is a replay. */
  private applyOutcome(o: CabOutcome): void {
    if (Object.keys(o.delta).length > 0) actions.applyResourceDelta({ ...o.delta });
    if (o.days > 0) {
      actions.advanceDay(o.days);
      // One reconciliation tick — see the contract note in systems/cabSim.ts.
      this.deadlineNotices = tickDeadlines();
      if (this.deadlineNotices.length > 0) actions.log(...this.deadlineNotices);
    }
    if (o.registerMemberIndex !== null) {
      const name = getState().party[o.registerMemberIndex]?.name ?? 'A party member';
      actions.setFlag('enhancedDeliveryOversight');
      const store = readCabStore();
      if (!store.register.includes(name)) store.register.push(name);
      writeCabStore(store);
    }
    if (o.beats.includes('caulk_success')) {
      const store = readCabStore();
      store.floats += 1;
      writeCabStore(store);
    }
    if (getState().resources.tokens <= 0) {
      actions.markDead('TOKEN EXHAUSTION');
    }
    saveRun(getState());
    // The calendar is truth now; let the header (day + doom clock) say so
    // while the animation replays what it cost.
    this.drawHeader();
  }

  // -------------------------------------------------------------------------
  // Step engine — one beat of copy + one effect per step; Enter advances
  // -------------------------------------------------------------------------

  private buildSteps(o: CabOutcome): Step[] {
    const registerName =
      o.registerMemberIndex !== null
        ? (getState().party[o.registerMemberIndex]?.name ?? 'A party member')
        : '';
    const steps: Step[] = [];
    for (const beat of o.beats) {
      switch (beat) {
        case 'ford_success':
          steps.push({ beat, subs: {}, effect: (d) => this.fxCross(1100, d) });
          break;
        case 'ford_failure':
          steps.push({ beat, subs: {}, effect: (d) => this.fxFordFail(d) });
          break;
        case 'ford_register':
          steps.push({
            beat,
            subs: { member: registerName },
            extraLine: subst(CONTENT.ui.registerNote, { member: registerName.toUpperCase() }),
            effect: (d) => this.fxRegister(d),
          });
          break;
        case 'caulk_success':
          steps.push({ beat, subs: { tokens: CAB.caulk.tokens }, effect: (d) => this.fxCaulk(false, d) });
          break;
        case 'caulk_scrape':
          steps.push({ beat, subs: { tokens: CAB.caulk.tokens }, effect: (d) => this.fxCaulk(true, d) });
          break;
        case 'ferry_file':
          steps.push({
            beat,
            subs: { wait: o.ferry?.firstWait ?? 0 },
            effect: (d) => this.fxFerryCount(0, o.ferry?.cveOnDay ?? 1, o.ferry?.firstWait ?? 1, d),
          });
          break;
        case 'ferry_cve':
          steps.push({
            beat,
            subs: { day: o.ferry?.cveOnDay ?? 0, wait: o.ferry?.secondWait ?? 0 },
            effect: (d) => this.fxCveStamp(o.ferry?.secondWait ?? 1, d),
          });
          break;
        case 'ferry_arrive':
          steps.push({
            beat,
            subs: { days: o.days },
            effect: (d) => this.fxFerryArrive(o.ferry?.secondWait ?? 1, d),
          });
          break;
        case 'wait':
          steps.push({ beat, subs: { days: o.days }, effect: (d) => this.fxSecondParty(d) });
          break;
      }
    }
    return steps;
  }

  private advanceStep(): void {
    this.stepIndex++;
    const step = this.steps[this.stepIndex];
    if (!step) {
      this.finishPlayback();
      return;
    }
    this.stepReady = false;
    this.drawBeat(step);
    step.effect(() => {
      this.stepReady = true;
      this.drawAdvanceHint();
    });
  }

  private drawBeat(step: Step): void {
    this.clearBeat();
    const lines = CONTENT.outcomes[step.beat] ?? [];
    let y = TEXT_AREA_Y;
    for (const line of lines) {
      const t = this.add
        .text(4, y, subst(line, step.subs), {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.green,
          wordWrap: { width: GAME_WIDTH - 8 },
          lineSpacing: 1,
        })
        .setOrigin(0, 0)
        .setDepth(10);
      this.beatObjs.push(t);
      y += t.height + 3;
    }
    if (step.extraLine) {
      const t = this.add
        .text(4, y, step.extraLine, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.orange,
          wordWrap: { width: GAME_WIDTH - 8 },
        })
        .setOrigin(0, 0)
        .setDepth(10);
      this.beatObjs.push(t);
    }
  }

  private drawAdvanceHint(): void {
    const last = this.stepIndex >= this.steps.length - 1;
    const label = !last
      ? '> CONTINUE (ENTER)'
      : this.outcome?.crossed === false
        ? CONTENT.ui.chooseAgainLabel
        : CONTENT.ui.continueLabel;
    const t = this.add
      .text(GAME_WIDTH / 2, 190, label, { fontFamily: 'monospace', fontSize: '8px', color: C.white })
      .setOrigin(0.5, 0)
      .setDepth(10);
    padHit(t, 20, 5);
    t.on('pointerdown', () => this.confirm());
    this.beatObjs.push(t);

    // Any deadline fallout from the days just spent (shown once, first hint).
    if (!this.noticeShown && this.deadlineNotices.length > 0) {
      this.noticeShown = true;
      const n = this.add
        .text(4, 181, this.deadlineNotices.join('\n'), {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: C.orange,
          wordWrap: { width: GAME_WIDTH - 8 },
          maxLines: 2,
        })
        .setOrigin(0, 0)
        .setDepth(10);
      this.beatObjs.push(n);
    }
  }

  private finishPlayback(): void {
    if (this.finishing) return;
    const o = this.outcome;
    if (!o) return;

    if (!o.crossed) {
      // WAIT: back to the bank. Depth does not improve. Conditions rotate,
      // which is not the same thing.
      this.river = {
        depthDays: this.river.depthDays,
        conditionIndex: Math.floor(actions.rand() * CONTENT.conditions.length),
      };
      saveRun(getState());
      this.clearBeat();
      this.drawHeader();
      this.drawSign();
      this.phase = 'choice';
      this.drawMenu();
      return;
    }

    this.finishing = true;
    this.drawHeader();
    void this.finishAsync(o);
  }

  private async finishAsync(o: CabOutcome): Promise<void> {
    if (!getState().alive) {
      const cause = getState().causeOfDeath ?? 'TOKEN EXHAUSTION';
      this.scene.start('Death', { cause });
      return;
    }
    // Curriculum, after the joke has landed (spec §10.1). Each mount is
    // deferred one macrotask: the card focuses its close button, and if it
    // mounted during an Enter keydown's dispatch, the browser's default
    // action (activate the focused element) would click it shut instantly.
    const showCard = async (id: string): Promise<void> => {
      await new Promise((r) => setTimeout(r, 0));
      await showCurriculumCard(id);
    };
    if (!getState().flags['cabRiskGatesShown']) {
      actions.setFlag('cabRiskGatesShown');
      saveRun(getState());
      await showCard('risk_gates');
    }
    if (o.beats.includes('caulk_success')) {
      const store = readCabStore();
      if (store.floats >= 2 && !store.featureFlagsCardShown) {
        store.featureFlagsCardShown = true;
        writeCabStore(store);
        await showCard('feature_flags');
      }
    }
    this.scene.start('Trail');
  }

  // -------------------------------------------------------------------------
  // Effects (each checks reduced motion and cuts to the end state)
  // -------------------------------------------------------------------------

  /** Straight crossing, near bank to far bank. */
  private fxCross(duration: number, done: () => void): void {
    if (this.reduced) {
      this.wagon.setPosition(WAGON_END.x, WAGON_END.y).setAngle(0).setAlpha(1);
      done();
      return;
    }
    this.tweens.add({
      targets: this.wagon,
      x: WAGON_END.x,
      y: WAGON_END.y,
      duration,
      ease: 'Sine.easeInOut',
      onComplete: () => done(),
    });
  }

  /** Ford failure: tilt midstream, splash, camera shake, limp across. */
  private fxFordFail(done: () => void): void {
    if (this.reduced) {
      this.wagon.setPosition(WAGON_END.x, WAGON_END.y).setAngle(0);
      done();
      return;
    }
    const midY = (RIVER_TOP + RIVER_BOTTOM) / 2;
    this.tweens.add({
      targets: this.wagon,
      x: WAGON_END.x,
      y: midY,
      duration: 600,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.splash(this.wagon.x, this.wagon.y + 4);
        this.cameras.main.shake(280, 0.012);
        this.tweens.add({
          targets: this.wagon,
          angle: 38,
          y: midY + 5,
          duration: 220,
          ease: 'Back.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: this.wagon,
              angle: 0,
              x: WAGON_END.x,
              y: WAGON_END.y,
              duration: 1100,
              delay: 350,
              ease: 'Sine.easeInOut',
              onComplete: () => done(),
            });
          },
        });
      },
    });
  }

  /** The register beat: a short, bureaucratic thud. */
  private fxRegister(done: () => void): void {
    if (this.reduced) {
      done();
      return;
    }
    this.cameras.main.shake(120, 0.004);
    this.time.delayedCall(250, done);
  }

  /** Caulk and float: ship dark (alpha down), cross low-key, flip on. */
  private fxCaulk(scrape: boolean, done: () => void): void {
    if (this.reduced) {
      this.wagon.setPosition(WAGON_END.x, WAGON_END.y).setAlpha(1).setAngle(0);
      done();
      return;
    }
    this.tweens.add({ targets: this.wagon, alpha: 0.35, duration: 300 });
    this.tweens.add({
      targets: this.wagon,
      x: WAGON_END.x,
      y: WAGON_END.y,
      duration: 1400,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (scrape) this.cameras.main.shake(140, 0.005);
        // The flag flips on from dry land. Quietly.
        this.tweens.add({
          targets: this.wagon,
          alpha: 1,
          duration: 250,
          onComplete: () => {
            this.cameras.main.flash(120, 27, 203, 1);
            done();
          },
        });
      },
    });
  }

  // --- Ferry: the dock, the calendar, the stamp ---------------------------

  private ferryBar: Phaser.GameObjects.Graphics | null = null;
  private ferryText: Phaser.GameObjects.Text | null = null;

  private drawFerryWait(day: number, target: number, color: number): void {
    const cx = GAME_WIDTH / 2;
    const y = (RIVER_TOP + RIVER_BOTTOM) / 2 - 6;
    if (!this.ferryBar) {
      this.ferryBar = this.add.graphics().setDepth(8);
      this.beatObjs.push(this.ferryBar);
    }
    if (!this.ferryText) {
      this.ferryText = this.add
        .text(cx, y - 10, '', { fontFamily: 'monospace', fontSize: '8px', color: C.white })
        .setOrigin(0.5, 0)
        .setDepth(8);
      this.beatObjs.push(this.ferryText);
    }
    this.ferryText.setText(`DAY ${day} OF ${target} AT THE DOCK`);
    const barW = 160;
    const g = this.ferryBar;
    g.clear();
    g.fillStyle(0x000000, 0.6);
    g.fillRect(cx - barW / 2 - 2, y + 2, barW + 4, 9);
    g.lineStyle(1, HEX.white, 1);
    g.strokeRect(cx - barW / 2 - 2, y + 2, barW + 4, 9);
    g.fillStyle(color, 1);
    g.fillRect(cx - barW / 2, y + 4, Math.round(barW * Math.min(1, day / target)), 5);
  }

  /** Count days at the dock from `from` to `to` against `target`; tear pages. */
  private fxFerryCount(from: number, to: number, target: number, done: () => void): void {
    if (this.reduced) {
      this.drawFerryWait(to, target, HEX.blue);
      done();
      return;
    }
    let day = from;
    this.drawFerryWait(day, target, HEX.blue);
    const stepMs = Math.max(45, Math.min(140, 1600 / Math.max(1, to - from)));
    const timer = this.time.addEvent({
      delay: stepMs,
      repeat: to - from - 1,
      callback: () => {
        day++;
        this.drawFerryWait(day, target, HEX.blue);
        this.tearPage();
        if (day >= to) {
          timer.remove();
          this.time.delayedCall(250, done);
        }
      },
    });
  }

  /** A calendar page tears off and drifts away. */
  private tearPage(): void {
    const cx = GAME_WIDTH / 2;
    const y = (RIVER_TOP + RIVER_BOTTOM) / 2 - 14;
    const page = this.add.image(cx + 52, y, 'cab_form').setDepth(9).setAlpha(0.9);
    this.tweens.add({
      targets: page,
      x: cx + 90 + Math.random() * 40,
      y: y - 18 - Math.random() * 14,
      angle: 50 + Math.random() * 90,
      alpha: 0,
      duration: 550,
      ease: 'Sine.easeOut',
      onComplete: () => page.destroy(),
    });
  }

  /** The CVE lands: stamp slam, clock resets to zero with a new target. */
  private fxCveStamp(newTarget: number, done: () => void): void {
    if (this.reduced) {
      this.drawFerryWait(0, newTarget, HEX.violet);
      done();
      return;
    }
    const stamp = this.add
      .text(GAME_WIDTH / 2, (RIVER_TOP + RIVER_BOTTOM) / 2 - 2, CONTENT.ui.stamp, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: C.violet,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(12)
      .setScale(3)
      .setAlpha(0)
      .setAngle(-8);
    this.beatObjs.push(stamp);
    this.tweens.add({
      targets: stamp,
      scale: 1,
      alpha: 1,
      duration: 260,
      ease: 'Back.easeIn',
      onComplete: () => {
        this.cameras.main.shake(300, 0.014);
        this.cameras.main.flash(140, 187, 54, 255);
        // The reset. Watch the bar drain. This is the part that hurts.
        const o = this.outcome;
        const fromDay = o?.ferry?.cveOnDay ?? 1;
        const fromTarget = o?.ferry?.firstWait ?? 1;
        let d = fromDay;
        const drain = this.time.addEvent({
          delay: 60,
          repeat: fromDay,
          callback: () => {
            d--;
            this.drawFerryWait(Math.max(0, d), fromTarget, HEX.violet);
            if (d <= 0) {
              drain.remove();
              this.drawFerryWait(0, newTarget, HEX.violet);
              this.tweens.add({ targets: stamp, alpha: 0.55, duration: 400, delay: 300 });
              this.time.delayedCall(500, done);
            }
          },
        });
      },
    });
  }

  /** The second wait, then the ferry actually crosses. */
  private fxFerryArrive(target: number, done: () => void): void {
    const cross = (): void => {
      const platform = this.add
        .rectangle(this.wagon.x, this.wagon.y + 7, 30, 4, HEX.blue, 1)
        .setDepth(4);
      this.beatObjs.push(platform);
      if (this.reduced) {
        this.wagon.setPosition(WAGON_END.x, WAGON_END.y);
        platform.setPosition(WAGON_END.x, WAGON_END.y + 7);
        done();
        return;
      }
      this.tweens.add({
        targets: [this.wagon, platform],
        y: `-=${WAGON_START.y - WAGON_END.y}`,
        duration: 900,
        ease: 'Sine.easeInOut',
        onComplete: () => done(),
      });
    };
    if (this.reduced) {
      this.drawFerryWait(target, target, HEX.blue);
      cross();
      return;
    }
    // Recount 0 → newTarget (faster; the second wait is somehow familiar).
    let day = 0;
    const stepMs = Math.max(35, Math.min(120, 1300 / target));
    const timer = this.time.addEvent({
      delay: stepMs,
      repeat: target - 1,
      callback: () => {
        day++;
        this.drawFerryWait(day, target, HEX.blue);
        this.tearPage();
        if (day >= target) {
          timer.remove();
          this.time.delayedCall(300, cross);
        }
      },
    });
  }

  /** WAIT: a second party arrives behind you and fords it. Successfully. */
  private fxSecondParty(done: () => void): void {
    const other = this.add
      .image(WAGON_START.x + 52, WAGON_START.y, 'cab_wagon')
      .setTint(HEX.green)
      .setDepth(5);
    this.beatObjs.push(other);
    if (this.reduced) {
      other.setPosition(WAGON_START.x + 52, WAGON_END.y);
      const check = this.add
        .text(WAGON_START.x + 52, WAGON_END.y - 12, '✓', { fontFamily: 'monospace', fontSize: '9px', color: C.green })
        .setOrigin(0.5, 0.5)
        .setDepth(6);
      this.beatObjs.push(check);
      done();
      return;
    }
    this.tweens.add({
      targets: other,
      y: WAGON_END.y,
      duration: 1500,
      delay: 400,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        const check = this.add
          .text(other.x, other.y - 12, '✓', { fontFamily: 'monospace', fontSize: '9px', color: C.green })
          .setOrigin(0.5, 0.5)
          .setDepth(6);
        this.beatObjs.push(check);
        done();
      },
    });
  }

  private splash(x: number, y: number): void {
    const emitter = this.add.particles(x, y, 'cab_px', {
      speed: { min: 30, max: 90 },
      angle: { min: 200, max: 340 },
      lifespan: 450,
      scale: { start: 1.4, end: 0 },
      tint: [HEX.blue, HEX.white],
      emitting: false,
    });
    emitter.setDepth(11);
    emitter.explode(18, x, y);
    this.time.delayedCall(600, () => emitter.destroy());
  }

  // -------------------------------------------------------------------------
  // Static UI
  // -------------------------------------------------------------------------

  private text(x: number, y: number, str: string, color: string, size = 8): Phaser.GameObjects.Text {
    return this.add.text(x, y, str, { fontFamily: 'monospace', fontSize: `${size}px`, color }).setOrigin(0, 0);
  }

  private drawHeader(): void {
    this.headerObjs.forEach((o) => o.destroy());
    this.headerObjs = [];
    const s = getState();
    const title = this.text(4, 2, 'THE CAB CROSSING', C.white);
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
        ? `${glyph} GO-LIVE: DAY ${clock.deadlineDay} — ${-clock.daysRemaining} DAYS PAST`
        : `${glyph} GO-LIVE: DAY ${clock.deadlineDay} — ${clock.daysRemaining} DAYS REMAIN`;
    const clockLine = this.text(4, 12, clockText, clockColor, 7);
    this.headerObjs.push(title, md, clockLine);
  }

  private drawSign(): void {
    this.signObjs.forEach((o) => o.destroy());
    this.signObjs = [];
    const depth = this.add
      .text(4, 24, subst(CONTENT.arrival.depthLine, { depth: this.river.depthDays }), {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: C.orange,
        wordWrap: { width: GAME_WIDTH - 8 },
      })
      .setOrigin(0, 0);
    const cond = this.add
      .text(4, 33, CONTENT.conditions[this.river.conditionIndex] ?? '', {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: C.white,
        wordWrap: { width: GAME_WIDTH - 8 },
      })
      .setOrigin(0, 0);
    this.signObjs.push(depth, cond);
  }

  private drawMenu(): void {
    this.clearMenu();
    const s = getState();
    const prompt = this.text(4, TEXT_AREA_Y - 3, CONTENT.arrival.prompt, C.blue, 6);
    this.menuObjs.push(prompt);
    CONTENT.options.forEach((opt, i) => {
      const y = TEXT_AREA_Y + 6 + i * 17;
      const selected = i === this.menuIndex;
      const affordable = opt.id !== 'caulk' || s.resources.tokens >= CAB.caulk.tokens;
      const labelColor = !affordable ? C.violet : selected ? C.white : C.green;
      const label = this.text(10, y, `${selected ? '>' : ' '} ${i + 1}. ${opt.label}${affordable ? '' : ' ×'}`, labelColor);
      padHit(label, 8, 3);
      label.on('pointerdown', () => this.pick(i));
      const hintText = affordable
        ? subst(opt.hint, { tokens: CAB.caulk.tokens })
        : subst(CONTENT.ui.cannotAffordCaulk, { tokens: CAB.caulk.tokens });
      const hint = this.text(22, y + 9, hintText, C.blue, 6);
      this.menuObjs.push(label, hint);
    });
  }

  private flashCaulkNote(): void {
    if (this.reduced) return;
    this.cameras.main.shake(90, 0.004);
  }

  private clearMenu(): void {
    this.menuObjs.forEach((o) => o.destroy());
    this.menuObjs = [];
  }

  private clearBeat(): void {
    this.beatObjs.forEach((o) => o.destroy());
    this.beatObjs = [];
    this.ferryBar = null;
    this.ferryText = null;
  }

  // -------------------------------------------------------------------------
  // Textures (drawn primitives; Wave 4 swaps in sprites)
  // -------------------------------------------------------------------------

  private makeTextures(): void {
    if (!this.textures.exists('cab_px')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('cab_px', 2, 2);
      g.destroy();
    }
    if (!this.textures.exists('cab_form')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 12, 8);
      g.fillStyle(0x555555, 1);
      g.fillRect(2, 2, 8, 1);
      g.fillRect(2, 4, 6, 1);
      g.fillRect(2, 6, 7, 1);
      g.generateTexture('cab_form', 12, 8);
      g.destroy();
    }
    if (!this.textures.exists('cab_wagon')) {
      const g = this.add.graphics();
      // Body.
      g.fillStyle(HEX.orange, 1);
      g.fillRect(1, 7, 20, 4);
      // Canvas cover.
      g.fillStyle(HEX.white, 1);
      g.fillRect(3, 2, 16, 5);
      // Wheels.
      g.lineStyle(1, HEX.white, 1);
      g.strokeCircle(6, 12, 3);
      g.strokeCircle(16, 12, 3);
      g.generateTexture('cab_wagon', 22, 16);
      g.destroy();
    }
  }

  private spawnPaperwork(): void {
    const count = 13;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * GAME_WIDTH;
      const y = RIVER_TOP + 6 + Math.random() * (RIVER_BOTTOM - RIVER_TOP - 12);
      const img = this.add
        .image(x, y, 'cab_form')
        .setAlpha(0.35 + Math.random() * 0.45)
        .setAngle(Math.random() * 24 - 12)
        .setDepth(2);
      this.forms.push(img);
      this.formSpeeds.push(6 + Math.random() * 14);
    }
  }
}

// ---------------------------------------------------------------------------

function subst(line: string, subs: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in subs ? String(subs[key]) : match,
  );
}
