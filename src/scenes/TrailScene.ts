/**
 * TrailScene — the main loop screen.
 *
 * Mile + day counters, the doom clock, six resource bars (value glyphs
 * ✓/!/× so status never rides on color alone), pace control, Travel/Rest
 * actions, surprise-deadline line, notice log, party status line.
 *
 * Keyboard map (fully operable without a mouse):
 *   Up/Down     move the action cursor (TRAVEL / REST)
 *   Enter/Space run the selected action
 *   Left/Right  change pace
 *   C           comply with the first active surprise deadline
 *   F           toggle dev fast mode (see config.fastModeMultiplier)
 */

import Phaser from 'phaser';
import {
  GAME_WIDTH,
  PACES,
  PACE_ORDER,
  ROLES,
  TOTAL_MILES,
  fastModeMultiplier,
} from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { advanceDays, type DayAction } from '../systems/economy';
import { complyDeadline, doomClock } from '../systems/deadlines';
import { saveRun } from '../systems/save';
import { bus } from '../ui/overlay';

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

interface BarSpec {
  key: 'tokens' | 'context' | 'trust' | 'greenBuilds' | 'morale' | 'credibility';
  label: string;
  max: () => number;
  /** Context is inverted: full is bad. */
  inverted: boolean;
}

const MENU_ITEMS: readonly { label: string; action: DayAction }[] = [
  { label: 'TRAVEL', action: 'travel' },
  { label: 'REST', action: 'rest' },
];

export class TrailScene extends Phaser.Scene {
  private menuIndex = 0;
  private fastOn = false;
  private drawn: Phaser.GameObjects.GameObject[] = [];

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
    // Reset the cursor to TRAVEL on a fresh run: the scene instance (and
    // its menuIndex) survives scene restarts, and a new party should not
    // inherit the previous party's REST selection.
    if (getState().day === 0) this.menuIndex = 0;

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.moveCursor(-1));
      kb.on('keydown-DOWN', () => this.moveCursor(1));
      kb.on('keydown-LEFT', () => this.shiftPace(-1));
      kb.on('keydown-RIGHT', () => this.shiftPace(1));
      kb.on('keydown-ENTER', () => this.runSelected());
      kb.on('keydown-SPACE', () => this.runSelected());
      kb.on('keydown-C', () => this.complyFirst());
      kb.on('keydown-F', () => {
        this.fastOn = !this.fastOn;
        this.redraw();
      });
    }

    this.redraw();
    bus.emit('scene:ready', { scene: 'Trail' });
  }

  private moveCursor(delta: number): void {
    this.menuIndex = (this.menuIndex + delta + MENU_ITEMS.length) % MENU_ITEMS.length;
    this.redraw();
  }

  private shiftPace(delta: number): void {
    const s = getState();
    const idx = PACE_ORDER.indexOf(s.pace);
    const next = PACE_ORDER[(idx + delta + PACE_ORDER.length) % PACE_ORDER.length];
    if (next) {
      actions.setPace(next);
      saveRun(getState());
      this.redraw();
    }
  }

  private runSelected(): void {
    const item = MENU_ITEMS[this.menuIndex];
    if (!item) return;
    const batch = this.fastOn ? Math.max(10, fastModeMultiplier()) : 1;
    const result = advanceDays(item.action, batch);

    if (result.died) {
      saveRun(getState());
      this.scene.start('Death', { cause: result.causeOfDeath ?? 'THE TRAIL' });
      return;
    }
    saveRun(getState());
    if (result.landmarkReached) {
      this.scene.start('Landmark', { landmarkId: result.landmarkReached.id });
      return;
    }
    if (result.reachedEnd) {
      this.scene.start('Score');
      return;
    }
    this.redraw();
  }

  private complyFirst(): void {
    const s = getState();
    const first = s.activeDeadlines[0];
    if (!first) return;
    const notices = complyDeadline(first.id);
    if (notices.length > 0) actions.log(...notices);
    // Compliance can drain the last tokens: check for starvation.
    if (getState().resources.tokens <= 0) {
      actions.markDead('TOKEN EXHAUSTION');
      saveRun(getState());
      this.scene.start('Death', { cause: 'TOKEN EXHAUSTION' });
      return;
    }
    saveRun(getState());
    this.redraw();
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
        `! ${firstDeadline.source.toUpperCase()}: ${firstDeadline.title} — DUE DAY ${firstDeadline.dueOnDay} [C=COMPLY]`,
        C.orange,
        7,
      );
      if (s.activeDeadlines.length > 1) {
        this.text(GAME_WIDTH - 4, 103, `+${s.activeDeadlines.length - 1} more`, C.orange, 7).setOrigin(1, 0);
      }
    }

    // Pace
    const pace = PACES[s.pace];
    this.text(4, 106, `PACE: < ${pace.label} >  (${pace.milesPerDay} MI/DAY)`, C.blue);

    // Menu
    MENU_ITEMS.forEach((item, i) => {
      const selected = i === this.menuIndex;
      const t = this.text(12, 120 + i * 11, `${selected ? '>' : ' '} ${item.label}`, selected ? C.white : C.green);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        this.menuIndex = i;
        this.runSelected();
      });
    });

    // Notice log (last few lines, wrapped)
    const logY = 146;
    const logLines = s.recentLog.slice(-3);
    logLines.forEach((line, i) => {
      const t = this.add
        .text(4, logY + i * 14, line, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: C.green,
          wordWrap: { width: GAME_WIDTH - 8 },
          maxLines: 2,
        })
        .setOrigin(0, 0);
      this.drawn.push(t);
    });

    // Party status line
    const aliveMembers = s.party.filter((m) => m.alive);
    const names = aliveMembers.map((m) => m.name).join(', ');
    this.text(4, 190, `PARTY ${aliveMembers.length}/${s.party.length}: ${names}`, C.white, 7);
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
