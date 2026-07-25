/**
 * TrailScene — the main loop screen (Wave 3: events + deadlines live).
 *
 * Mile + day counters, the doom clock, six resource bars (value glyphs
 * ✓/!/× so status never rides on color alone), pace control,
 * Travel/Rest/Hunt actions, active-deadline line, notice log, party
 * status with glyphs — plus the modal layer the event engine feeds:
 *
 *  - EVENT MODALS   — random/flagged/escalation events with choices;
 *  - COURIER MODALS — a surprise deadline arrives (stamp-slam entrance);
 *  - DEADLINE MANAGER — per-deadline COMPLY / DEFER / BUY EXCEPTION;
 *  - CAMPFIRE       — Boring & Brilliant's deadpan reactions after a
 *                     landmark's HEED choice (set by LandmarkScene).
 *
 * Keyboard map (fully operable without a mouse):
 *   Up/Down     move the cursor (menu or modal)
 *   Enter/Space run the selected action / choose the modal option
 *   Left/Right  change pace
 *   C           comply with the first active surprise deadline
 *   D           open the deadline manager
 *   F           toggle dev fast mode (see config.fastModeMultiplier)
 *
 * All flavor prose comes from content JSON (events/deadlines/boring-
 * brilliant); strings authored here are functional UI copy only.
 * Every animation (stamp slam, night tick) has a reduced-motion fallback.
 */

import Phaser from 'phaser';
import {
  EXCEPTION_CREDIBILITY_COST,
  GAME_WIDTH,
  HUNT_COST_DAYS,
  PACES,
  PACE_ORDER,
  ROLES,
  TOTAL_MILES,
  fastModeMultiplier,
} from '../config';
import { actions, getState, hasRun } from '../systems/state';
import type { SurpriseDeadline } from '../systems/state';
import { advanceDays, type DayAction } from '../systems/economy';
import { buyException, complyDeadline, doomClock } from '../systems/deadlines';
import { applyChoice, visibleChoices, type TriggeredEvent } from '../systems/eventEngine';
import { bbForLandmark } from '../systems/content';
import { saveRun } from '../systems/save';
import { isFieldNoteOpen, showCurriculumCard } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import { MINIGAMES } from './index';

/** Apple II palette (docs/DECISIONS.md). */
const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
};

const GREEN_HEX = 0x1bcb01;
const ORANGE_HEX = 0xf55d08;
const VIOLET_HEX = 0xbb36ff;
const WHITE_HEX = 0xffffff;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface BarSpec {
  key: 'tokens' | 'context' | 'trust' | 'greenBuilds' | 'morale' | 'credibility';
  label: string;
  max: () => number;
  /** Context is inverted: full is bad. */
  inverted: boolean;
}

type MenuAction = DayAction | 'hunt';

const MENU_ITEMS: readonly { label: string; action: MenuAction }[] = [
  { label: 'TRAVEL', action: 'travel' },
  { label: 'REST', action: 'rest' },
  { label: 'HUNT', action: 'hunt' },
];

/** Curriculum cards shown AFTER specific event modals close (the joke
 * lands first — §10.1). Gated once per run by flag `card_<id>`. */
const CURRICULUM_AFTER: Record<string, string> = {
  procedure_trap_leak: 'enforcement_in_harness',
};

// ---------------------------------------------------------------------------
// Modal plumbing
// ---------------------------------------------------------------------------

interface ModalOption {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface ModalSpec {
  /** Stamp header above the title (courier arrivals). */
  header?: string;
  title: string;
  titleColor?: string;
  body: string;
  options: ModalOption[];
  borderHex?: number;
  /** Stamp-slam entrance (reduced-motion: instant). */
  slam?: boolean;
}

interface ActiveModal {
  spec: ModalSpec;
  container: Phaser.GameObjects.Container;
  optionTexts: Phaser.GameObjects.Text[];
  index: number;
}

export class TrailScene extends Phaser.Scene {
  private menuIndex = 0;
  private fastOn = false;
  private drawn: Phaser.GameObjects.GameObject[] = [];
  private modal: ActiveModal | null = null;
  /** Queued modal openers; drained one per close via pumpQueue(). */
  private queue: (() => void)[] = [];
  /** Scene routing deferred until the modal queue drains. */
  private pendingRoute: (() => void) | null = null;

  constructor() {
    super('Trail');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.cameras.main.setBackgroundColor('#000000');
    this.fastOn = fastModeMultiplier() > 1;
    this.modal = null;
    this.queue = [];
    this.pendingRoute = null;
    // Reset the cursor to TRAVEL on a fresh run: the scene instance (and
    // its menuIndex) survives scene restarts, and a new party should not
    // inherit the previous party's selection.
    if (getState().day === 0) this.menuIndex = 0;

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.moveCursor(-1));
      kb.on('keydown-DOWN', () => this.moveCursor(1));
      kb.on('keydown-LEFT', () => this.shiftPace(-1));
      kb.on('keydown-RIGHT', () => this.shiftPace(1));
      kb.on('keydown-ENTER', () => this.confirm());
      kb.on('keydown-SPACE', () => this.confirm());
      kb.on('keydown-C', () => {
        if (!this.modal) this.complyFirst();
      });
      kb.on('keydown-D', () => {
        if (!this.modal) this.openDeadlineManager();
      });
      kb.on('keydown-F', () => {
        if (this.modal) return;
        this.fastOn = !this.fastOn;
        this.redraw();
      });
    }

    this.redraw();

    // Boring & Brilliant react to the landmark HEED choice at the first
    // campfire after the minigame (content boring-brilliant.json).
    const heed = getState().lastLandmarkHeed;
    if (heed) {
      const bb = bbForLandmark(heed.landmarkId);
      actions.setLastLandmarkHeed(null);
      saveRun(getState());
      if (bb) {
        this.queue.push(() =>
          this.openModal({
            title: 'AT THE CAMPFIRE',
            titleColor: C.blue,
            borderHex: 0x0da1ff,
            body: `BORING: ${bb.reaction.boring}\n\nBRILLIANT: ${bb.reaction.brilliant}`,
            options: [
              {
                label: 'BREAK CAMP',
                onSelect: () => {
                  this.closeModal();
                  this.pumpQueue();
                },
              },
            ],
          }),
        );
        this.pumpQueue();
      }
    }

    bus.emit('scene:ready', { scene: 'Trail' });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private moveCursor(delta: number): void {
    if (isFieldNoteOpen()) return;
    if (this.modal) {
      this.moveModalCursor(delta);
      return;
    }
    this.menuIndex = (this.menuIndex + delta + MENU_ITEMS.length) % MENU_ITEMS.length;
    this.redraw();
  }

  private shiftPace(delta: number): void {
    if (this.modal) return;
    const s = getState();
    const idx = PACE_ORDER.indexOf(s.pace);
    const next = PACE_ORDER[(idx + delta + PACE_ORDER.length) % PACE_ORDER.length];
    if (next) {
      actions.setPace(next);
      saveRun(getState());
      this.redraw();
    }
  }

  private confirm(): void {
    if (isFieldNoteOpen()) return;
    if (this.modal) {
      this.selectModalOption();
      return;
    }
    this.runSelected();
  }

  private runSelected(): void {
    const item = MENU_ITEMS[this.menuIndex];
    if (!item) return;
    if (item.action === 'hunt') {
      this.hunt();
      return;
    }
    const batch = this.fastOn ? Math.max(10, fastModeMultiplier()) : 1;
    const result = advanceDays(item.action, batch);

    if (result.died) {
      saveRun(getState());
      this.scene.start('Death', { cause: result.causeOfDeath ?? 'THE TRAIL' });
      return;
    }
    saveRun(getState());

    if (result.landmarkReached) {
      const id = result.landmarkReached.id;
      this.pendingRoute = () => this.scene.start('Landmark', { landmarkId: id });
    } else if (result.reachedEnd) {
      this.pendingRoute = () => this.scene.start('Score');
    }

    this.redraw();
    if (result.nightMiles > 0) this.showNightTick(result.nightMiles);

    for (const d of result.spawnedDeadlines) {
      this.queue.push(() => this.openCourierModal(d));
    }
    for (const t of result.triggers) {
      this.queue.push(() => this.openEventModal(t));
    }
    this.pumpQueue();
  }

  /** HUNT: a Bug Hunt away from the trail costs HUNT_COST_DAYS (1) — same
   * advanceDay simplification as deadline compliance: focused work burns
   * days, not miles. */
  private hunt(): void {
    actions.advanceDay(HUNT_COST_DAYS);
    actions.log(`HUNT — ${HUNT_COST_DAYS} day in the weeds.`);
    saveRun(getState());
    this.scene.start('BugHunt', { mechanic: 'bug_hunt' });
  }

  private complyFirst(): void {
    const s = getState();
    const first = s.activeDeadlines[0];
    if (!first) return;
    this.resolveComply(first.id);
  }

  private resolveComply(id: string): void {
    const notices = complyDeadline(id);
    if (notices.length > 0) actions.log(...notices);
    if (this.checkDeathAfterModal()) return;
    saveRun(getState());
    this.redraw();
  }

  /** Compliance/choices can drain the last tokens: check for starvation. */
  private checkDeathAfterModal(): boolean {
    if (getState().resources.tokens <= 0) {
      actions.markDead('TOKEN EXHAUSTION');
      saveRun(getState());
      this.scene.start('Death', { cause: 'TOKEN EXHAUSTION' });
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Modal queue
  // -------------------------------------------------------------------------

  private pumpQueue(): void {
    if (this.modal) return;
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    if (this.pendingRoute) {
      const route = this.pendingRoute;
      this.pendingRoute = null;
      route();
      return;
    }
    this.redraw();
  }

  // -------------------------------------------------------------------------
  // Event modals
  // -------------------------------------------------------------------------

  private openEventModal(t: TriggeredEvent): void {
    const s = getState();
    const choices = visibleChoices(t.event, s);
    const hostile = t.kind === 'escalation' || t.kind === 'trap' || t.kind === 'flagged';
    const borderHex = hostile ? VIOLET_HEX : ORANGE_HEX;
    const titleColor = hostile ? C.violet : C.orange;

    const options: ModalOption[] =
      choices.length > 0
        ? choices.map((choice) => ({
            label: choice.label,
            onSelect: () => {
              const notices = applyChoice(choice);
              if (notices.length > 0) actions.log(...notices);
              if (this.checkDeathAfterModal()) return;
              saveRun(getState());
              if (choice.outcome) {
                this.closeModal();
                this.openModal({
                  title: t.event.title,
                  titleColor,
                  borderHex,
                  body: choice.outcome,
                  options: [
                    {
                      label: 'CONTINUE',
                      onSelect: () => this.finishEventModal(t, choice.startsMechanic),
                    },
                  ],
                });
              } else {
                this.finishEventModal(t, choice.startsMechanic);
              }
            },
          }))
        : [{ label: 'CONTINUE', onSelect: () => this.finishEventModal(t, undefined) }];

    this.openModal({
      title: t.event.title,
      titleColor,
      borderHex,
      body: t.event.body,
      options,
      slam: hostile,
    });

    // Hostile events land with a shake even before a choice is made.
    if (hostile && !reducedMotion()) this.cameras.main.shake(150, 0.008);
  }

  private finishEventModal(t: TriggeredEvent, startsMechanic: string | undefined): void {
    this.closeModal();
    saveRun(getState());

    const proceed = () => {
      if (startsMechanic) {
        const entry = MINIGAMES[startsMechanic];
        if (entry) {
          this.scene.start(entry.sceneKey, { mechanic: startsMechanic });
          return;
        }
      }
      this.pumpQueue();
    };

    const cardId = CURRICULUM_AFTER[t.event.id];
    if (cardId && !getState().flags[`card_${cardId}`]) {
      actions.setFlag(`card_${cardId}`);
      saveRun(getState());
      void showCurriculumCard(cardId).then(proceed);
    } else {
      proceed();
    }
  }

  // -------------------------------------------------------------------------
  // Deadline modals
  // -------------------------------------------------------------------------

  private openCourierModal(d: SurpriseDeadline): void {
    this.openModal({
      header: `A COURIER ARRIVES. THE COURIER IS FROM ${d.source.toUpperCase()}.`,
      title: d.title,
      titleColor: C.orange,
      borderHex: ORANGE_HEX,
      body: d.body ?? '',
      options: this.deadlineOptions(d, () => this.afterCourier()),
      slam: true,
    });
  }

  /** The first courier ever teaches the mechanic (§10 surprise deadlines). */
  private afterCourier(): void {
    if (!getState().flags['card_surprise_deadlines']) {
      actions.setFlag('card_surprise_deadlines');
      saveRun(getState());
      void showCurriculumCard('surprise_deadlines').then(() => this.pumpQueue());
    } else {
      this.pumpQueue();
    }
  }

  private deadlineOptions(d: SurpriseDeadline, after: () => void): ModalOption[] {
    const days = d.complyCost.days ?? 0;
    const tokens = d.complyCost.tokens ?? 0;
    const credibility = getState().resources.credibility;
    return [
      {
        label: `COMPLY — ${days} DAY${days === 1 ? '' : 'S'}, ${tokens} TOKENS`,
        onSelect: () => {
          const notices = complyDeadline(d.id);
          if (notices.length > 0) actions.log(...notices);
          this.closeModal();
          if (this.checkDeathAfterModal()) return;
          saveRun(getState());
          after();
        },
      },
      {
        label: `DEFER — DUE DAY ${d.dueOnDay}`,
        onSelect: () => {
          actions.log(`Deferred: ${d.source} — ${d.title}. Due day ${d.dueOnDay}.`);
          this.closeModal();
          saveRun(getState());
          after();
        },
      },
      {
        label: `BUY EXCEPTION — ${EXCEPTION_CREDIBILITY_COST} CREDIBILITY`,
        disabled: credibility < EXCEPTION_CREDIBILITY_COST,
        onSelect: () => {
          const notices = buyException(d.id);
          if (!notices) return; // insufficient credibility (disabled anyway)
          actions.log(...notices);
          this.closeModal();
          saveRun(getState());
          after();
        },
      },
    ];
  }

  private openDeadlineManager(): void {
    const deadlines = getState().activeDeadlines;
    if (deadlines.length === 0) return;
    const options: ModalOption[] = deadlines.map((d) => ({
      label: `${d.source.toUpperCase()}: ${d.title} — DUE DAY ${d.dueOnDay}`,
      onSelect: () => {
        this.closeModal();
        this.openModal({
          title: d.title,
          titleColor: C.orange,
          borderHex: ORANGE_HEX,
          body: d.body ?? '',
          options: this.deadlineOptions(d, () => this.pumpQueue()),
        });
      },
    }));
    options.push({
      label: 'CLOSE',
      onSelect: () => {
        this.closeModal();
        this.pumpQueue();
      },
    });
    this.openModal({
      title: 'ACTIVE MANDATES',
      titleColor: C.orange,
      borderHex: ORANGE_HEX,
      body: '',
      options,
    });
  }

  // -------------------------------------------------------------------------
  // Modal rendering
  // -------------------------------------------------------------------------

  private openModal(spec: ModalSpec): void {
    this.closeModal();

    const container = this.add.container(0, 0).setDepth(100);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.82);
    g.fillRect(0, 0, GAME_WIDTH, 200);
    container.add(g);

    const panelX = 8;
    const panelW = GAME_WIDTH - 16;
    let y = 16;

    const panel = this.add.graphics();
    container.add(panel);

    if (spec.header) {
      const header = this.add
        .text(GAME_WIDTH / 2, y, spec.header, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.orange,
          align: 'center',
          wordWrap: { width: panelW - 12 },
        })
        .setOrigin(0.5, 0);
      container.add(header);
      y += header.height + 5;
    }

    const title = this.add
      .text(GAME_WIDTH / 2, y, spec.title, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: spec.titleColor ?? C.white,
        align: 'center',
        wordWrap: { width: panelW - 12 },
      })
      .setOrigin(0.5, 0);
    container.add(title);
    y += title.height + 5;

    if (spec.body.length > 0) {
      const body = this.add
        .text(panelX + 6, y, spec.body, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.green,
          lineSpacing: 1,
          wordWrap: { width: panelW - 12 },
        })
        .setOrigin(0, 0);
      container.add(body);
      y += body.height + 6;
    }

    const optionTexts: Phaser.GameObjects.Text[] = [];
    spec.options.forEach((opt, i) => {
      const t = this.add
        .text(panelX + 10, y, opt.label, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.green,
          wordWrap: { width: panelW - 24 },
        })
        .setOrigin(0, 0);
      if (!opt.disabled) {
        t.setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => {
          if (!this.modal) return;
          this.modal.index = i;
          this.selectModalOption();
        });
      }
      container.add(t);
      optionTexts.push(t);
      y += t.height + 3;
    });

    const panelTop = 10;
    const panelBottom = Math.min(196, y + 4);
    panel.lineStyle(1, spec.borderHex ?? GREEN_HEX, 1);
    panel.strokeRect(panelX, panelTop, panelW, panelBottom - panelTop);
    panel.fillStyle(0x000000, 0.9);
    // Fill behind (redraw order: fill first). Re-stroke on top of fill:
    panel.fillRect(panelX, panelTop, panelW, panelBottom - panelTop);
    panel.lineStyle(1, spec.borderHex ?? GREEN_HEX, 1);
    panel.strokeRect(panelX, panelTop, panelW, panelBottom - panelTop);
    container.sendToBack(panel);
    container.sendToBack(g);

    const firstEnabled = spec.options.findIndex((o) => !o.disabled);
    this.modal = { spec, container, optionTexts, index: Math.max(0, firstEnabled) };
    this.styleModalOptions();

    // Stamp-slam entrance: the notice smashes down onto the desk.
    if (spec.slam && !reducedMotion()) {
      container.setScale(1.5).setAlpha(0);
      this.tweens.add({
        targets: container,
        scale: 1,
        alpha: 1,
        duration: 160,
        ease: 'Quad.easeIn',
        onComplete: () => this.cameras.main.shake(120, 0.012),
      });
    }
  }

  private styleModalOptions(): void {
    if (!this.modal) return;
    const { spec, optionTexts, index } = this.modal;
    optionTexts.forEach((t, i) => {
      const opt = spec.options[i];
      if (!opt) return;
      const selected = i === index;
      const raw = opt.label.replace(/^> /, '');
      if (opt.disabled) {
        t.setText(`  ${raw} ×`);
        t.setColor(C.green);
        t.setAlpha(0.35);
      } else {
        t.setText(`${selected ? '>' : ' '} ${raw}`);
        t.setColor(selected ? C.white : C.green);
        t.setAlpha(1);
      }
    });
  }

  private moveModalCursor(delta: number): void {
    const m = this.modal;
    if (!m) return;
    const n = m.spec.options.length;
    let next = m.index;
    for (let i = 0; i < n; i++) {
      next = (next + delta + n) % n;
      if (!m.spec.options[next]?.disabled) break;
    }
    m.index = next;
    this.styleModalOptions();
  }

  private selectModalOption(): void {
    const m = this.modal;
    if (!m) return;
    const opt = m.spec.options[m.index];
    if (!opt || opt.disabled) return;
    opt.onSelect();
  }

  private closeModal(): void {
    if (!this.modal) return;
    this.modal.container.destroy(true);
    this.modal = null;
  }

  // -------------------------------------------------------------------------
  // Night tick — the overnight loop banks miles (blue, §13 ledger night)
  // -------------------------------------------------------------------------

  private showNightTick(miles: number): void {
    const t = this.add
      .text(GAME_WIDTH - 6, 22, `☾ +${miles} MI OVERNIGHT`, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: C.blue,
      })
      .setOrigin(1, 0)
      .setDepth(50);
    if (reducedMotion()) {
      // No motion: show the fact plainly, then remove it.
      this.time.delayedCall(1200, () => t.destroy());
    } else {
      this.tweens.add({
        targets: t,
        y: 14,
        alpha: 0,
        duration: 1100,
        ease: 'Quad.easeOut',
        onComplete: () => t.destroy(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Rendering (rebuilt each state change; 320x200 text UI)
  // -------------------------------------------------------------------------

  private text(
    x: number,
    y: number,
    str: string,
    color: string,
    size = 8,
    origin: 0 | 0.5 = 0,
  ): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, str, { fontFamily: 'monospace', fontSize: `${size}px`, color })
      .setOrigin(origin, 0);
    this.drawn.push(t);
    return t;
  }

  private redraw(): void {
    this.drawn.forEach((o) => o.destroy());
    this.drawn = [];
    const s = getState();
    const role = ROLES[s.role];

    // Row 1: mile / day / fast indicator
    this.text(4, 2, `MILE ${Math.floor(s.mile)}/${TOTAL_MILES}`, C.white);
    this.text(130, 2, `DAY ${s.day}`, C.white);
    if (this.fastOn) {
      this.text(GAME_WIDTH - 4, 2, `FAST x${Math.max(10, fastModeMultiplier())}`, C.blue).setOrigin(1, 0);
    }

    // Row 2: doom clock
    const clock = doomClock(s.day);
    const clockColor = clock.phase === 'missed' ? C.violet : clock.phase === 'warn' ? C.orange : C.green;
    const clockGlyph = clock.phase === 'missed' ? '×' : clock.phase === 'warn' ? '!' : '✓';
    const clockText =
      clock.phase === 'missed'
        ? `${clockGlyph} GO-LIVE: DAY ${clock.deadlineDay} — ${-clock.daysRemaining} DAYS PAST`
        : `${clockGlyph} GO-LIVE: DAY ${clock.deadlineDay} — ${clock.daysRemaining} DAYS REMAIN`;
    this.text(4, 12, clockText, clockColor);

    // Resource bars
    const bars: BarSpec[] = [
      { key: 'tokens', label: 'TOKENS', max: () => role.starting.tokens, inverted: false },
      { key: 'context', label: 'CONTEXT', max: () => 100, inverted: true },
      { key: 'trust', label: 'TRUST', max: () => 10, inverted: false },
      { key: 'greenBuilds', label: 'BUILDS', max: () => 10, inverted: false },
      { key: 'morale', label: 'MORALE', max: () => 100, inverted: false },
      { key: 'credibility', label: 'CRED', max: () => 100, inverted: false },
    ];
    bars.forEach((bar, i) => this.drawBar(bar, 24 + i * 11, s.resources[bar.key]));

    // Deadline line
    const firstDeadline = s.activeDeadlines[0];
    if (firstDeadline) {
      this.text(
        4,
        94,
        `! ${firstDeadline.source.toUpperCase()}: ${firstDeadline.title} — DUE DAY ${firstDeadline.dueOnDay} [C/D]`,
        C.orange,
        7,
      );
      if (s.activeDeadlines.length > 1) {
        this.text(GAME_WIDTH - 4, 87, `+${s.activeDeadlines.length - 1} more [D]`, C.orange, 7).setOrigin(1, 0);
      }
    }

    // Pace
    const pace = PACES[s.pace];
    this.text(4, 106, `PACE: < ${pace.label} >  (${pace.milesPerDay} MI/DAY)`, C.blue);

    // Menu
    MENU_ITEMS.forEach((item, i) => {
      const selected = i === this.menuIndex;
      const t = this.text(12, 118 + i * 10, `${selected ? '>' : ' '} ${item.label}`, selected ? C.white : C.green);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        if (this.modal) return;
        this.menuIndex = i;
        this.runSelected();
      });
    });

    // Notice log (last few lines, wrapped)
    const logY = 150;
    const logLines = s.recentLog.slice(-3);
    logLines.forEach((line, i) => {
      const t = this.add
        .text(4, logY + i * 12, line, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.green,
          wordWrap: { width: GAME_WIDTH - 8 },
          maxLines: 2,
        })
        .setOrigin(0, 0);
      this.drawn.push(t);
    });

    // Party status line — glyph per member so loss survives colorblindness.
    let px = 4;
    this.text(px, 190, 'PARTY:', C.white, 7);
    px += 30;
    s.party.forEach((m) => {
      const glyph = m.alive ? '✓' : '×';
      const t = this.text(px, 190, `${glyph}${m.name}`, m.alive ? C.green : C.violet, 7);
      px += t.width + 5;
    });
  }

  private drawBar(bar: BarSpec, y: number, rawValue: number): void {
    const value = Math.max(0, rawValue);
    const max = bar.max();
    const frac = Math.max(0, Math.min(1, value / max));

    // Health semantics: for context, fuller is worse.
    const health = bar.inverted ? 1 - frac : frac;
    const glyph = health <= 0.001 ? '×' : health < 0.3 ? '!' : '✓';
    const color = health <= 0.001 ? C.violet : health < 0.3 ? C.orange : C.green;
    const hexColor = health <= 0.001 ? VIOLET_HEX : health < 0.3 ? ORANGE_HEX : GREEN_HEX;

    this.text(4, y, bar.label.padEnd(8, ' '), C.white, 7);

    const barX = 70;
    const barW = 140;
    const g = this.add.graphics();
    g.lineStyle(1, WHITE_HEX, 1);
    g.strokeRect(barX, y, barW, 7);
    g.fillStyle(hexColor, 1);
    g.fillRect(barX + 1, y + 1, Math.round((barW - 2) * frac), 5);
    this.drawn.push(g);

    this.text(barX + barW + 6, y, `${Math.round(value)} ${glyph}`, color, 7);
  }
}
