/**
 * ContextPackScene — Context Canyon (§7.3), mile 660. Mechanic: context_pack.
 *
 * A knapsack with VISIBLE values. Every item shows its relevance band
 * (VITAL / USEFUL / NOISE / DEAD WEIGHT) from the start — the puzzle is
 * that the good stuff does not fit, and the three tools are the way
 * through: COMPACT / SUBAGENT / RETRIEVE-ON-DEMAND (logic in
 * systems/contextSim.ts). The ticket is the one exception: DEPENDS,
 * resolving only when packed.
 *
 * Keyboard: ↑/↓ select · ENTER/SPACE pack/unpack
 * · C compact · S scout · R mark for retrieval · D depart.
 * Fully mouse-playable via row clicks + detail-panel buttons.
 *
 * Juice: the wagon sags under load, items snap in with squash tweens,
 * overfill closes the canyon walls with camera shake, the first useful
 * scout gets a flash + particle celebration. All effects cut to instant
 * under prefers-reduced-motion.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import {
  canScout,
  compact,
  createSession,
  displayBand,
  evaluate,
  loadStats,
  packedSize,
  saveStats,
  scout,
  sizeLabel,
  toggleMark,
  tryPack,
  unpack,
  SCOUT_TOKENS,
  OVERFLOW_CONTEXT,
  OVERFLOW_TOKENS,
  STRINGS,
  type Band,
  type DepartResult,
  type PackItem,
  type PackSession,
} from '../systems/contextSim';

const GREEN = '#1bcb01';
const WHITE = '#ffffff';
const BLUE = '#0da1ff';
const ORANGE = '#f55d08';
const VIOLET = '#bb36ff';
const GREY = '#9a9a9a';

const LIST_X = 4;
const LIST_Y = 16;
const ROW_H = 8;
const DETAIL_X = 176;
const WAGON_Y = 156;

type Mode = 'pack' | 'anim' | 'outcome';

export class ContextPackScene extends Phaser.Scene {
  private session!: PackSession;
  private mechanic = 'context_pack';
  private selected = 0;
  private mode: Mode = 'pack';
  private reduced = false;

  private rows: Phaser.GameObjects.Text[] = [];
  private detail: Phaser.GameObjects.Text[] = [];
  private buttons: Phaser.GameObjects.Text[] = [];
  private ticker!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private capText!: Phaser.GameObjects.Text;
  private reqBadge!: Phaser.GameObjects.Text;
  private wagon!: Phaser.GameObjects.Graphics;
  private wagonContainer!: Phaser.GameObjects.Container;
  private wallL!: Phaser.GameObjects.Rectangle;
  private wallR!: Phaser.GameObjects.Rectangle;
  private outcomePanel: Phaser.GameObjects.GameObject[] = [];

  private overflowCardShown = false;
  private compactionCardShown = false;
  private daysHere = 0;

  constructor() {
    super('ContextPack');
  }

  init(data: { landmarkId?: string; mechanic?: string }): void {
    // Several mechanics may share a scene class; only context_pack today.
    this.mechanic = data.mechanic ?? 'context_pack';
  }

  create(): void {
    if (!hasRun() || this.mechanic !== 'context_pack') {
      this.scene.start(hasRun() ? 'Trail' : 'Title');
      return;
    }
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.session = createSession(() => actions.rand());
    this.selected = 0;
    this.mode = 'pack';
    this.overflowCardShown = false;
    this.compactionCardShown = false;
    this.daysHere = 0;

    const stats = loadStats();
    stats.plays += 1;
    saveStats(stats);

    this.cameras.main.setBackgroundColor('#000000');

    // 2x2 white pixel for particle emitters.
    if (!this.textures.exists('cc-px')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('cc-px', 2, 2);
      g.destroy();
    }

    // Canyon walls (they close when you overfill).
    this.wallL = this.add.rectangle(0, 0, 5, GAME_HEIGHT, 0x4b1566).setOrigin(0, 0).setDepth(5);
    this.wallR = this.add
      .rectangle(GAME_WIDTH, 0, 5, GAME_HEIGHT, 0x4b1566)
      .setOrigin(1, 0)
      .setDepth(5);

    this.add
      .text(GAME_WIDTH / 2, 2, 'CONTEXT CANYON — PACK THE WINDOW', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: WHITE,
      })
      .setOrigin(0.5, 0);

    this.hud = this.add
      .text(GAME_WIDTH - 8, 11, '', { fontFamily: 'monospace', fontSize: '6px', color: BLUE })
      .setOrigin(1, 0);
    this.reqBadge = this.add
      .text(8, 11, '', { fontFamily: 'monospace', fontSize: '6px', color: VIOLET })
      .setOrigin(0, 0);

    // Item rows.
    this.rows = this.session.items.map((item, i) => {
      const row = this.add
        .text(LIST_X + 4, LIST_Y + 6 + i * ROW_H, '', {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: GREY,
        })
        .setInteractive({ useHandCursor: true });
      row.on('pointerover', () => {
        if (this.mode === 'pack') {
          this.selected = i;
          this.refresh();
        }
      });
      row.on('pointerdown', () => {
        if (this.mode !== 'pack') return;
        if (this.selected === i) this.togglePack();
        else {
          this.selected = i;
          this.refresh();
        }
      });
      void item;
      return row;
    });

    // Detail panel (right side).
    const mk = (y: number, color: string, size = '6px'): Phaser.GameObjects.Text =>
      this.add.text(DETAIL_X, y, '', {
        fontFamily: 'monospace',
        fontSize: size,
        color,
        wordWrap: { width: GAME_WIDTH - DETAIL_X - 10 },
        lineSpacing: 1,
      });
    this.detail = [
      mk(18, WHITE, '7px'), // name
      mk(28, BLUE), // size / relevance line
      mk(46, GREEN), // blurb + dry aside
    ];

    // Detail-panel action buttons (functional copy stays plain — §12.3).
    const actionsDef: Array<[string, () => void]> = [
      ['[ENTER] PACK / UNPACK', () => this.togglePack()],
      ['[C] COMPACT (LOSSY)', () => this.doCompact()],
      [`[S] SEND SUBAGENT (-${SCOUT_TOKENS} TKN, 1 DAY)`, () => this.doScout()],
      ['[R] MARK: RETRIEVE LATER', () => this.doMark()],
      ['[D] DEPART THE CANYON', () => this.doDepart()],
    ];
    this.buttons = actionsDef.map(([label, fn], i) => {
      const t = this.add
        .text(DETAIL_X, 100 + i * 8, label, {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: GREY,
        })
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setColor(WHITE));
      t.on('pointerout', () => t.setColor(GREY));
      t.on('pointerdown', () => {
        if (this.mode === 'pack') fn();
      });
      return t;
    });

    // Feedback ticker.
    this.ticker = this.add.text(6, WAGON_Y - 10, STRINGS['intro'] ?? '', {
      fontFamily: 'monospace',
      fontSize: '6px',
      color: GREEN,
      wordWrap: { width: GAME_WIDTH - 12 },
    });

    // The wagon (context bar) + capacity readout.
    this.wagon = this.add.graphics();
    this.wagonContainer = this.add.container(0, 0, [this.wagon]);
    this.capText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 6, '', {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: WHITE,
      })
      .setOrigin(0.5, 1);

    // Keyboard. Every handler is guarded against the Curriculum Card modal:
    // its window listener stopPropagation()s, but listeners on the SAME
    // node still run, so the dismissing Enter would otherwise leak here.
    const safe = (fn: () => void) => (): void => {
      if (document.querySelector('.field-note-backdrop')) return;
      fn();
    };
    const packMode = (fn: () => void): (() => void) =>
      safe(() => {
        if (this.mode === 'pack') fn();
      });
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', packMode(() => this.move(-1)));
      kb.on('keydown-DOWN', packMode(() => this.move(1)));
      kb.on('keydown-ENTER', safe(() => this.onEnter()));
      kb.on('keydown-SPACE', packMode(() => this.togglePack()));
      kb.on('keydown-C', packMode(() => this.doCompact()));
      kb.on('keydown-S', packMode(() => this.doScout()));
      kb.on('keydown-R', packMode(() => this.doMark()));
      kb.on('keydown-D', packMode(() => this.doDepart()));
      kb.on(
        'keydown-X',
        safe(() => {
          if (this.mode === 'outcome') this.outcomeSecondary?.();
        }),
      );
    }

    this.refresh();
    bus.emit('scene:ready', { scene: 'ContextPack' });
  }

  // -------------------------------------------------------------------------
  // Selection + rendering
  // -------------------------------------------------------------------------

  private get item(): PackItem {
    const it = this.session.items[this.selected];
    if (!it) throw new Error('ContextPack: selection out of range');
    return it;
  }

  private move(dir: number): void {
    if (this.mode !== 'pack') return;
    const n = this.session.items.length;
    this.selected = (this.selected + dir + n) % n;
    this.refresh();
  }

  private onEnter(): void {
    if (this.mode === 'pack') this.togglePack();
    else if (this.mode === 'outcome') this.outcomePrimary?.();
  }

  private bandGlyph(band: Band): string {
    if (band === 'VITAL' || band === 'USEFUL') return '✓';
    if (band === 'DEPENDS') return '?';
    if (band === 'NOISE') return '!';
    return '×';
  }

  private refresh(): void {
    const s = this.session;
    s.items.forEach((item, i) => {
      const row = this.rows[i];
      if (!row) return;
      const sel = i === this.selected ? '>' : ' ';
      const st = item.state === 'packed' ? '✓' : item.state === 'marked' ? 'R' : '·';
      const band = this.bandGlyph(displayBand(item));
      const name = item.name.padEnd(23).slice(0, 23);
      row.setText(`${sel}${st} ${name}${String(item.size).padStart(3)} ${band}`);
      const color =
        i === this.selected
          ? WHITE
          : item.state === 'packed'
            ? GREEN
            : item.state === 'marked'
              ? BLUE
              : GREY;
      row.setColor(color);
    });

    const item = this.item;
    const band = displayBand(item);
    this.detail[0]?.setText(item.name.toUpperCase());
    const rel =
      band === 'DEPENDS'
        ? 'DEPENDS ? — resolves when packed'
        : `${band} ${this.bandGlyph(band)} (${item.relevance})`;
    this.detail[1]?.setText(`SIZE ${item.size} — ${sizeLabel(item.size)}\nRELEVANCE: ${rel}`);
    // Blurb plus the dry aside; drop the aside if it would overrun the column.
    this.detail[2]?.setText(`${item.blurb}\n\n${item.def.detail}`);
    const d2 = this.detail[2];
    if (d2 && d2.y + d2.height > 98) d2.setText(item.blurb);

    // Grey out tools that don't apply to the selection.
    this.buttons[1]?.setAlpha(item.size > 1 ? 1 : 0.4);
    this.buttons[2]?.setAlpha(canScout(item) ? 1 : 0.4);
    this.buttons[3]?.setAlpha(item.state !== 'packed' ? 1 : 0.4);

    const r = getState().resources;
    this.hud.setText(`TOKENS ${Math.floor(r.tokens)}  DAY +${this.daysHere}`);
    this.reqBadge.setText(this.session.requirementLost ? (STRINGS['requirementBadge'] ?? '') : '');

    const fill = packedSize(s);
    const over = fill / s.capacity;
    this.capText.setText(`CONTEXT ${fill}/${s.capacity}${over >= 0.85 ? ' !' : ''}`);
    this.capText.setColor(over >= 0.85 ? ORANGE : WHITE);
    this.drawWagon();
  }

  /** The context bar is a wagon. It sags. That is the whole point. */
  private drawWagon(): void {
    const g = this.wagon;
    g.clear();
    const s = this.session;
    const bedX = 36;
    const bedW = GAME_WIDTH - 2 * bedX;
    const bedY = WAGON_Y + 8;
    const bedH = 12;
    const fill = packedSize(s);
    const ratio = Math.min(1, fill / s.capacity);
    const droop = ratio * 6;

    const dipAt = (x: number): number =>
      Math.sin(Math.PI * Phaser.Math.Clamp((x - bedX) / bedW, 0, 1)) * droop;

    // Bed outline, drawn in short segments so the sag reads as a bend.
    g.lineStyle(1, 0xffffff, 1);
    const seg = 16;
    for (let x = bedX; x < bedX + bedW; x += seg) {
      const x2 = Math.min(bedX + bedW, x + seg);
      g.lineBetween(x, bedY + dipAt(x), x2, bedY + dipAt(x2));
      g.lineBetween(x, bedY + bedH + dipAt(x), x2, bedY + bedH + dipAt(x2));
    }
    g.lineBetween(bedX, bedY, bedX, bedY + bedH);
    g.lineBetween(bedX + bedW, bedY, bedX + bedW, bedY + bedH);

    // Cargo blocks, packing order, coloured by band (bands are public now;
    // packing resolves the one DEPENDS item, so packed cargo is always known).
    let cursor = bedX + 1;
    for (const item of s.items) {
      if (item.state !== 'packed') continue;
      const w = Math.max(2, (item.size / s.capacity) * (bedW - 2) - 1);
      const cx = cursor + w / 2;
      const dy = dipAt(cx);
      const color =
        item.relevance >= 40 ? 0x1bcb01 : item.relevance >= 10 ? 0xf55d08 : 0xbb36ff;
      g.fillStyle(color, 1);
      g.fillRect(cursor, bedY + 2 + dy, w, bedH - 3);
      cursor += w + 1;
    }

    // Wheels splay slightly as the load bears down.
    const splay = droop > 4 ? 2 : 0;
    const wy = bedY + bedH + 8;
    for (const wx of [bedX + 44 - splay, bedX + bedW - 44 + splay]) {
      g.lineStyle(1, 0xffffff, 1);
      g.strokeCircle(wx, wy, 7);
      g.lineBetween(wx - 5, wy, wx + 5, wy);
      g.lineBetween(wx, wy - 5, wx, wy + 5);
    }
  }

  private setTicker(text: string, color = GREEN): void {
    this.ticker.setText(text).setColor(color);
  }

  private persist(): void {
    saveRun(getState());
  }

  // -------------------------------------------------------------------------
  // Moves
  // -------------------------------------------------------------------------

  private togglePack(): void {
    const item = this.item;
    if (item.state === 'packed') {
      unpack(item);
      this.setTicker(`${item.name} is back on the ground.`, GREY);
      this.refresh();
      return;
    }
    const res = tryPack(this.session, item);
    if (!res.ok && res.overBy > 0) {
      this.onOverflow(item, res.overBy);
      return;
    }
    if (res.ok) {
      if (res.resolved) {
        // The DEPENDS item commits to a band the moment someone relies on it.
        const band = displayBand(item);
        this.setTicker(
          `${STRINGS['ticketResolved'] ?? ''} ${band} ${this.bandGlyph(band)}.`,
          BLUE,
        );
      }
      this.snapIn(item);
      this.refresh();
    }
  }

  /** Weight-appropriate squash tween: heavier items land harder. */
  private snapIn(item: PackItem): void {
    if (this.reduced) return;
    const row = this.rows[this.selected];
    const heavy = Math.min(1, item.size / 12);
    const chip = this.add.rectangle(
      row ? row.x + 30 : GAME_WIDTH / 2,
      row ? row.y + 3 : 80,
      6 + heavy * 10,
      5,
      0x1bcb01,
    );
    this.tweens.add({
      targets: chip,
      x: GAME_WIDTH / 2,
      y: WAGON_Y + 12,
      scaleY: 0.5,
      duration: 160 + heavy * 120,
      ease: 'Quad.easeIn',
      onComplete: () => {
        chip.destroy();
        this.wagonContainer.setScale(1, 1 - 0.06 - heavy * 0.08);
        this.tweens.add({
          targets: this.wagonContainer,
          scaleY: 1,
          duration: 180,
          ease: 'Back.easeOut',
        });
      },
    });
  }

  /** Overfill: the canyon walls close. Damage, then the lesson. */
  private onOverflow(item: PackItem, overBy: number): void {
    const isNodeModules = item.def.id === 'node_modules';
    const line = isNodeModules ? STRINGS['overflowNodeModules'] : STRINGS['overflow'];
    this.setTicker(`${line ?? ''} (over by ${overBy})`, ORANGE);
    actions.applyResourceDelta(
      { tokens: -OVERFLOW_TOKENS, context: OVERFLOW_CONTEXT },
      'The canyon walls closed on an overfull wagon.',
    );
    this.persist();

    const stats = loadStats();
    stats.overflows += 1;
    saveStats(stats);

    const finish = (): void => {
      this.mode = 'pack';
      this.refresh();
      if (!this.overflowCardShown) {
        this.overflowCardShown = true;
        void showCurriculumCard('context_budget');
      }
    };

    if (this.reduced) {
      finish();
      return;
    }
    this.mode = 'anim';
    this.cameras.main.shake(220, 0.012);
    this.tweens.add({
      targets: this.wallL,
      width: 34,
      duration: 260,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    this.tweens.add({
      targets: this.wallR,
      width: 34,
      duration: 260,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: finish,
    });
    this.refresh();
  }

  private doCompact(): void {
    const item = this.item;
    const res = compact(this.session, item, () => actions.rand());
    if (!res.ok) {
      this.setTicker('Cannot compact further. It is one slot of pure summary.', GREY);
      return;
    }
    const relNote = item.revealed ? ` Relevance -${res.relevanceLost}.` : '';
    this.setTicker(`${STRINGS['compactNotice'] ?? ''} Size is now ${item.size}.${relNote}`);
    if (res.requirementLostNow) this.onRequirementLost();
    this.refresh();
  }

  /** Lossy compression has no error message — but the canyon narrates. */
  private onRequirementLost(): void {
    const stats = loadStats();
    stats.requirementLosses += 1;
    saveStats(stats);
    this.setTicker(STRINGS['compactRequirementLost'] ?? '', VIOLET);
    const show = (): void => {
      if (!this.compactionCardShown) {
        this.compactionCardShown = true;
        void showCurriculumCard('compaction_lossy');
      }
    };
    if (this.reduced) {
      show();
      return;
    }
    this.cameras.main.flash(180, 90, 20, 120);
    this.time.delayedCall(700, show);
  }

  private doScout(): void {
    const item = this.item;
    if (!canScout(item)) {
      this.setTicker('The scout looks at it and shrugs. Too small to be worth a separate bag.', GREY);
      return;
    }
    if (getState().resources.tokens < SCOUT_TOKENS) {
      this.setTicker(`Not enough tokens to provision a scout (${SCOUT_TOKENS} needed).`, ORANGE);
      return;
    }
    actions.applyResourceDelta({ tokens: -SCOUT_TOKENS });
    actions.advanceDay(1);
    this.daysHere += 1;
    this.persist();
    this.setTicker(STRINGS['scoutDepart'] ?? '', BLUE);
    this.mode = 'anim';

    const stats = loadStats();
    stats.scoutsSent += 1;
    saveStats(stats);

    const returnNow = (): void => {
      const res = scout(this.session, item);
      this.mode = 'pack';
      if (!res.ok) {
        this.refresh();
        return;
      }
      this.setTicker(`${STRINGS['scoutReturn'] ?? ''} ${item.blurb}`, GREEN);
      this.refresh();
      if (res.firstUseful) this.celebrateScout();
    };

    if (this.reduced) returnNow();
    else this.time.delayedCall(900, returnNow);
  }

  /** The first useful scout should feel GOOD. This is the trick. */
  private celebrateScout(): void {
    const show = (): void => void showCurriculumCard('subagents_isolate');
    if (this.reduced) {
      this.setTicker(`${STRINGS['scoutReturn'] ?? ''} ${STRINGS['scoutFirst'] ?? ''}`, GREEN);
      show();
      return;
    }
    this.cameras.main.flash(220, 27, 203, 1);
    const row = this.rows[this.selected];
    const x = row ? row.x + 60 : GAME_WIDTH / 2;
    const y = row ? row.y + 4 : 80;
    const emitter = this.add.particles(x, y, 'cc-px', {
      speed: { min: 30, max: 90 },
      lifespan: 600,
      quantity: 24,
      scale: { start: 1.4, end: 0 },
      tint: [0x1bcb01, 0xffffff, 0x0da1ff],
      emitting: false,
    });
    emitter.explode(24);
    const banner = this.add
      .text(GAME_WIDTH / 2, 78, STRINGS['scoutReturn'] ?? '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: GREEN,
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setScale(0.2);
    this.tweens.add({
      targets: banner,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(900, () => {
          banner.destroy();
          emitter.destroy();
          this.setTicker(STRINGS['scoutFirst'] ?? '', GREEN);
          show();
        });
      },
    });
  }

  private doMark(): void {
    const item = this.item;
    if (item.state === 'packed') {
      this.setTicker('It is already in the wagon. Unpack it first if you mean to leave it.', GREY);
      return;
    }
    const marked = toggleMark(item);
    this.setTicker((marked ? STRINGS['markNotice'] : STRINGS['unmarkNotice']) ?? '', BLUE);
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Departure
  // -------------------------------------------------------------------------

  private outcomePrimary: (() => void) | null = null;
  private outcomeSecondary: (() => void) | null = null;

  private doDepart(): void {
    const res = evaluate(this.session);

    const stats = loadStats();
    stats.departures += 1;
    if (res.outcome === 'tight' || res.outcome === 'pass') stats.successes += 1;
    if (res.score > stats.bestScore) stats.bestScore = res.score;
    saveStats(stats);

    actions.applyResourceDelta(res.delta, `Context Canyon: ${res.outcome.toUpperCase()}.`);
    const extraDays = res.reworkDays + res.retrievalDays;
    if (extraDays > 0) {
      actions.advanceDay(extraDays);
      this.daysHere += extraDays;
    }
    this.persist();
    this.refresh();
    this.showOutcome(res);
  }

  private showOutcome(res: DepartResult): void {
    this.mode = 'outcome';
    const panel: Phaser.GameObjects.GameObject[] = [];
    const bg = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 292, 150, 0x000000, 0.96)
      .setStrokeStyle(1, res.outcome === 'tight' || res.outcome === 'pass' ? 0x1bcb01 : 0xbb36ff)
      .setDepth(20);
    panel.push(bg);

    const won = res.outcome === 'tight' || res.outcome === 'pass';
    const title =
      res.outcome === 'tight'
        ? '✓ TIGHT PACK'
        : res.outcome === 'pass'
          ? '✓ THE WAGON CLEARS'
          : res.outcome === 'requirementLost'
            ? '× REQUIREMENT LOST'
            : '× WRONG PROBLEM, SOLVED';
    const prose =
      res.outcome === 'tight'
        ? STRINGS['successTight']
        : res.outcome === 'pass'
          ? STRINGS['successPass']
          : res.outcome === 'requirementLost'
            ? STRINGS['requirementLostOutcome']
            : STRINGS['wrongProblem'];

    panel.push(
      this.add
        .text(GAME_WIDTH / 2, 34, title, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: won ? GREEN : VIOLET,
        })
        .setOrigin(0.5, 0)
        .setDepth(21),
    );
    panel.push(
      this.add
        .text(GAME_WIDTH / 2, 50, prose ?? '', {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: won ? GREEN : WHITE,
          wordWrap: { width: 270 },
          lineSpacing: 2,
        })
        .setOrigin(0.5, 0)
        .setDepth(21),
    );

    const lines: string[] = [`RELEVANT FILL SCORE: ${res.score}`];
    if (res.retrievals > 0) {
      lines.push(
        `${STRINGS['departRetrieval'] ?? ''} (${res.retrievals} trips, -${res.retrievalTokens} tokens${res.retrievalDays ? ', -1 day' : ''})`,
      );
    }
    panel.push(
      this.add
        .text(GAME_WIDTH / 2, 116, lines.join('\n'), {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: BLUE,
          wordWrap: { width: 270 },
          align: 'center',
        })
        .setOrigin(0.5, 0)
        .setDepth(21),
    );

    const mkBtn = (x: number, label: string, fn: () => void): void => {
      const t = this.add
        .text(x, GAME_HEIGHT / 2 + 62, label, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: WHITE,
        })
        .setOrigin(0.5)
        .setDepth(21)
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setColor(GREEN));
      t.on('pointerout', () => t.setColor(WHITE));
      t.on('pointerdown', fn);
      panel.push(t);
    };

    if (won) {
      this.outcomePrimary = () => this.exitToTrail();
      this.outcomeSecondary = null;
      mkBtn(GAME_WIDTH / 2, '> CONTINUE THE MARCH [ENTER]', this.outcomePrimary);
    } else {
      this.outcomePrimary = () => this.repack(res);
      this.outcomeSecondary = () => this.exitToTrail();
      mkBtn(GAME_WIDTH / 2 - 74, '> REPACK [ENTER]', this.outcomePrimary);
      mkBtn(GAME_WIDTH / 2 + 74, '> PUSH ON ANYWAY [X]', this.outcomeSecondary);
    }
    this.outcomePanel = panel;

    // The compaction lesson also fires here if the loss happened un-carded
    // (e.g. overuse loss on the very last compaction before departing).
    if (res.outcome === 'requirementLost' && !this.compactionCardShown) {
      this.compactionCardShown = true;
      void showCurriculumCard('compaction_lossy');
    }
  }

  private closeOutcome(): void {
    this.outcomePanel.forEach((o) => o.destroy());
    this.outcomePanel = [];
    this.outcomePrimary = null;
    this.outcomeSecondary = null;
    this.mode = 'pack';
  }

  /** Failed departure: revert the beautiful wrong files, try again. */
  private repack(res: DepartResult): void {
    this.closeOutcome();
    let line = STRINGS['retryPrompt'] ?? '';
    if (res.outcome === 'requirementLost') {
      // Re-running the failing test restores THE REQUIREMENT — hard
      // constraints should live in a durable source the loop re-reads.
      const carrier = this.session.items.find((i) => i.def.carriesRequirement);
      if (carrier && !carrier.isSummary) {
        carrier.size = carrier.def.size;
        carrier.relevance = Array.isArray(carrier.def.relevance)
          ? carrier.relevance
          : carrier.def.relevance;
        carrier.compactions = 0;
      }
      this.session.requirementLost = false;
      this.session.compactionsTotal = 0;
      line = STRINGS['requirementRestored'] ?? line;
    }
    this.setTicker(line, ORANGE);
    this.refresh();
  }

  private exitToTrail(): void {
    this.closeOutcome();
    this.scene.start('Trail');
  }
}
