/**
 * LoopBuilderScene — the ★ core minigame (spec §7.2).
 *
 * One scene class, three mechanics (branch on init data):
 *  - tutorial_one_shot   (Fort Prompt, mile 140): fire a one-shot prompt,
 *    watch it plateau, watch a two-block loop walk past it.
 *  - loop_builder_guided (The Loop Fork, mile 310): pegboard with all
 *    blocks pre-placed except two; tooltips on; cannot fail permanently.
 *  - loop_builder_verifier (Verifier Ridge, mile 480): blank pegboard;
 *    the bridge is missing a plank shaped like a machine-checkable
 *    VERIFIER. No verifier — no exit.
 *
 * The pegboard is a physical patch-panel: brass sockets, hand-labelled
 * plates, sagging cables. On RUN the current visibly travels the cable
 * (glow pulse along bezier segments); a failing block sparks (particles)
 * and its cable goes dark. Evaluation lives in systems/loopSim.ts
 * (scene-independent; the Wave 3 boss reuses it).
 *
 * Keyboard (fully playable without a mouse):
 *   Arrows      move the cursor / switch between TRAY and BOARD
 *   Enter/Space pick up the focused block, or seat the held block
 *   X/Backspace return a seated block to the tray
 *   R           RUN the loop
 *   Esc         cancel a held block; leave (where leaving is possible)
 * Mouse: click a tray block to pick it up, click a socket to seat it
 * (drag also works — release over a socket).
 *
 * Reduced motion: every tween/particle/flash degrades to an instant cut.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, TOTAL_MILES } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import {
  LOOP_CONTENT,
  blockInfo,
  evaluateLoop,
  recordLoopOutcome,
  type BlockId,
  type LoopDefinition,
  type LoopOutcome,
  type TimelineEvent,
  type Tone,
} from '../systems/loopSim';

// ---------------------------------------------------------------------------
// Palette (docs/DECISIONS.md; shades/tints allowed per ART-DIRECTION v2)
// ---------------------------------------------------------------------------

const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
  brass: '#c9822e', // tint of orange — the sockets
  dim: '#6a6a6a', // shade of white — cold copy
};

const HEX = {
  white: 0xffffff,
  green: 0x1bcb01,
  violet: 0xbb36ff,
  orange: 0xf55d08,
  blue: 0x0da1ff,
  brass: 0xc9822e,
  brassDark: 0x6e4517,
  panel: 0x101408, // near-black tint of green — the board
  plate: 0x1c2412,
  cableIdle: 0x0d5e00, // dark green cable at rest
  cableDark: 0x2a2a2a, // a cable that has given up
  manila: 0xd8c7a0,
  carbon: 0x3a342b,
} as const;

// ---------------------------------------------------------------------------
// Layout (320x200 logical)
// ---------------------------------------------------------------------------

interface SocketSpot {
  x: number;
  y: number;
}

/** Ten sockets, clockwise ring. */
const SOCKET_SPOTS: readonly SocketSpot[] = [
  { x: 63, y: 34 },
  { x: 127, y: 34 },
  { x: 191, y: 34 },
  { x: 255, y: 34 },
  { x: 291, y: 64 },
  { x: 255, y: 96 },
  { x: 191, y: 96 },
  { x: 127, y: 96 },
  { x: 63, y: 96 },
  { x: 27, y: 64 },
];

const PLATE_W = 54;
const PLATE_H = 12;
const CAPTION_Y = 106;
const LOG_Y = 124;
const LOG_LINE_H = 8;
const LOG_MAX = 5;
const TRAY_ROW_Y = [172, 186] as const;
const TRAY_COLS = [28, 80, 132, 184, 236, 288] as const;
const BRIDGE_GAP = { x: 163, y: 67 };

type Mode = 'tutorial' | 'guided' | 'ridge';
type Phase = 'build' | 'running' | 'verdict' | 'crossing' | 'dead';

interface TrayEntry {
  id: BlockId;
  count: number;
}

interface CableSeg {
  g: Phaser.GameObjects.Graphics;
  curve: Phaser.Curves.QuadraticBezier;
}

/** Guided mode: which block each pre-wired socket expects (null = free). */
const GUIDED_LAYOUT: readonly (BlockId | null)[] = [
  'trigger',
  'context',
  'agent',
  'tool_tests',
  null, // observe goes here
  'verifier_machine',
  'stop_success',
  null, // stop_cap goes here
  'stop_budget',
  null, // spare socket
];

export class LoopBuilderScene extends Phaser.Scene {
  private mechanic = 'loop_builder_guided';
  private mode: Mode = 'guided';
  private reduced = false;

  private sockets: (BlockId | null)[] = [];
  private tray: TrayEntry[] = [];
  private zone: 'tray' | 'board' = 'tray';
  private cursor = 0;
  private holding: BlockId | null = null;
  private phase: Phase = 'build';
  private lastOutcome: LoopOutcome | null = null;

  private boardObjs: Phaser.GameObjects.GameObject[] = [];
  private runObjs: Phaser.GameObjects.GameObject[] = [];
  private cableSegs: CableSeg[] = [];
  private filledOrder: number[] = [];
  private logLines: { text: string; color: string }[] = [];
  private logTexts: Phaser.GameObjects.Text[] = [];
  private tokenText: Phaser.GameObjects.Text | null = null;
  private pulse: Phaser.GameObjects.Arc | null = null;
  private pulsePos = 0; // index into filledOrder
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shower: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private invoicePanel: Phaser.GameObjects.Container | null = null;
  private invoiceCount = 0;
  private ghost: Phaser.GameObjects.Container | null = null;
  private partyDots: Phaser.GameObjects.Rectangle[] = [];

  // Tutorial state
  private tutStep = 0;
  private tutBar = 0;
  private tutBarG: Phaser.GameObjects.Graphics | null = null;
  private tutBarText: Phaser.GameObjects.Text | null = null;
  private tutButton: Phaser.GameObjects.Text | null = null;
  private tutBusy = false;

  constructor() {
    super('LoopBuilder');
  }

  init(data: { landmarkId?: string; mechanic?: string }): void {
    this.mechanic = data.mechanic ?? 'loop_builder_guided';
    this.mode =
      this.mechanic === 'tutorial_one_shot'
        ? 'tutorial'
        : this.mechanic === 'loop_builder_verifier'
          ? 'ridge'
          : 'guided';
    this.sockets = [];
    this.tray = [];
    this.zone = 'tray';
    this.cursor = 0;
    this.holding = null;
    this.phase = 'build';
    this.lastOutcome = null;
    this.boardObjs = [];
    this.runObjs = [];
    this.cableSegs = [];
    this.filledOrder = [];
    this.logLines = [];
    this.logTexts = [];
    this.tokenText = null;
    this.pulse = null;
    this.pulsePos = 0;
    this.invoicePanel = null;
    this.invoiceCount = 0;
    this.ghost = null;
    this.partyDots = [];
    this.tutStep = 0;
    this.tutBar = 0;
    this.tutBusy = false;
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.setBackgroundColor('#000000');
    this.makePixelTexture();
    this.makeEmitters();

    if (this.mode === 'tutorial') {
      this.createTutorial();
    } else {
      this.createPegboard();
    }
    bus.emit('scene:ready', { scene: 'LoopBuilder' });
  }

  // =========================================================================
  // Shared plumbing
  // =========================================================================

  private makePixelTexture(): void {
    if (this.textures.exists('lb-px')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 2, 2);
    g.generateTexture('lb-px', 2, 2);
    g.destroy();
  }

  private makeEmitters(): void {
    this.sparks = this.add
      .particles(0, 0, 'lb-px', {
        speed: { min: 30, max: 90 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 250, max: 550 },
        scale: { start: 1, end: 0 },
        gravityY: 90,
        tint: [HEX.orange, HEX.violet, HEX.white],
        emitting: false,
      })
      .setDepth(8);
    this.shower = this.add
      .particles(0, 0, 'lb-px', {
        speed: { min: 20, max: 70 },
        angle: { min: 60, max: 120 },
        lifespan: { min: 400, max: 900 },
        scale: { start: 1, end: 0 },
        gravityY: 40,
        tint: [HEX.green, HEX.white],
        emitting: false,
      })
      .setDepth(8);
  }

  private glow(obj: Phaser.GameObjects.GameObject, color: number, strength = 3): void {
    if (this.game.renderer.type !== Phaser.WEBGL) return;
    try {
      (obj as unknown as { postFX?: { addGlow(c?: number, o?: number): unknown } }).postFX?.addGlow(
        color,
        strength,
      );
    } catch {
      /* fx unavailable: the plain shape still reads */
    }
  }

  /**
   * A Field Note modal (ui/curriculumCard.ts) owns the keyboard while it
   * is open; scene handlers must stand down so its dismissing Enter does
   * not leak into the pegboard (wave advisory).
   */
  private cardOpen(): boolean {
    return document.querySelector('.field-note-backdrop') !== null;
  }

  private wait(ms: number): Promise<void> {
    if (this.reduced || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private txt(
    x: number,
    y: number,
    str: string,
    color: string,
    size = 7,
    originX = 0,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, str, { fontFamily: 'monospace', fontSize: `${size}px`, color })
      .setOrigin(originX, 0);
  }

  private toneColor(tone: Tone): string {
    switch (tone) {
      case 'ok':
        return C.white;
      case 'warn':
        return C.orange;
      case 'fail':
        return C.violet;
      default:
        return C.green;
    }
  }

  private appendLog(line: string, tone: Tone): void {
    this.logLines.push({ text: line.replace('[ok]', '✓'), color: this.toneColor(tone) });
    if (this.logLines.length > 40) this.logLines.splice(0, this.logLines.length - 40);
    this.renderLog();
  }

  private renderLog(): void {
    this.logTexts.forEach((t) => t.destroy());
    this.logTexts = [];
    const tail = this.logLines.slice(-LOG_MAX);
    tail.forEach((l, i) => {
      this.logTexts.push(this.txt(4, LOG_Y + i * LOG_LINE_H, l.text, l.color, 7));
    });
  }

  private setTokenMeter(n: number): void {
    this.tokenText?.setText(`TOKENS ${n}`);
  }

  private exitToTrail(): void {
    saveRun(getState());
    this.scene.start('Trail');
  }

  // =========================================================================
  // Pegboard (guided + ridge)
  // =========================================================================

  private createPegboard(): void {
    if (this.mode === 'guided') {
      this.sockets = GUIDED_LAYOUT.map((b) => b);
      this.tray = [
        { id: 'observe', count: 1 },
        { id: 'stop_cap', count: 1 },
        { id: 'verifier_subjective', count: 1 },
        { id: 'human_gate', count: 3 },
        { id: 'escalate', count: 1 },
      ];
      this.appendLog(LOOP_CONTENT.guided.hint, 'info');
    } else {
      this.sockets = SOCKET_SPOTS.map(() => null);
      this.tray = [
        { id: 'trigger', count: 1 },
        { id: 'context', count: 1 },
        { id: 'agent', count: 1 },
        { id: 'tool_tests', count: 1 },
        { id: 'observe', count: 1 },
        { id: 'verifier_machine', count: 1 },
        { id: 'verifier_subjective', count: 1 },
        { id: 'stop_success', count: 1 },
        { id: 'stop_cap', count: 1 },
        { id: 'stop_budget', count: 1 },
        { id: 'human_gate', count: 3 },
        { id: 'escalate', count: 1 },
      ];
      this.appendLog(LOOP_CONTENT.ridge.intro, 'warn');
    }

    const kb = this.input.keyboard;
    if (kb) {
      const g = (fn: () => void) => () => {
        if (!this.cardOpen()) fn();
      };
      kb.on('keydown-LEFT', g(() => this.moveCursor(-1)));
      kb.on('keydown-RIGHT', g(() => this.moveCursor(1)));
      kb.on('keydown-UP', g(() => this.switchZone()));
      kb.on('keydown-DOWN', g(() => this.switchZone()));
      kb.on('keydown-ENTER', g(() => this.primary()));
      kb.on('keydown-SPACE', g(() => this.primary()));
      kb.on('keydown-X', g(() => this.removeAtCursor()));
      kb.on('keydown-BACKSPACE', g(() => this.removeAtCursor()));
      kb.on('keydown-R', g(() => this.runLoop()));
      kb.on('keydown-ESC', g(() => this.escape()));
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveGhost(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerRelease(p));

    this.redraw();
  }

  private redraw(): void {
    this.boardObjs.forEach((o) => o.destroy());
    this.boardObjs = [];
    this.cableSegs = [];

    const keep = (o: Phaser.GameObjects.GameObject): void => {
      this.boardObjs.push(o);
    };

    // Header
    const title =
      this.mode === 'guided' ? 'THE LOOP FORK — PEGBOARD' : 'VERIFIER RIDGE — PEGBOARD';
    keep(this.txt(4, 2, title, C.white, 9));
    this.tokenText = this.txt(GAME_WIDTH - 4, 3, `TOKENS ${Math.round(getState().resources.tokens)}`, C.green, 8, 1);
    keep(this.tokenText);

    // Board backdrop
    const board = this.add.rectangle(GAME_WIDTH / 2, 65, 312, 92, HEX.panel).setDepth(0);
    board.setStrokeStyle(1, HEX.brassDark);
    keep(board);

    if (this.mode === 'ridge') this.drawBridge(keep);

    // Cables between consecutive filled sockets (ring order, closed loop)
    this.filledOrder = this.sockets
      .map((b, i) => (b !== null ? i : -1))
      .filter((i) => i >= 0);
    if (this.filledOrder.length >= 2) {
      for (let k = 0; k < this.filledOrder.length; k++) {
        const aIdx = this.filledOrder[k];
        const bIdx = this.filledOrder[(k + 1) % this.filledOrder.length];
        if (aIdx === undefined || bIdx === undefined) continue;
        const a = SOCKET_SPOTS[aIdx];
        const b = SOCKET_SPOTS[bIdx];
        if (!a || !b) continue;
        const curve = this.cableCurve(a, b);
        const g = this.add.graphics().setDepth(1);
        this.drawCable(g, curve, HEX.cableIdle);
        keep(g);
        this.cableSegs.push({ g, curve });
      }
    }

    // Sockets + plates
    this.sockets.forEach((block, i) => {
      const spot = SOCKET_SPOTS[i];
      if (!spot) return;
      const socket = this.add.circle(spot.x, spot.y, 3, HEX.brass).setDepth(2);
      socket.setStrokeStyle(1, HEX.brassDark);
      keep(socket);
      if (block) {
        keep(this.drawPlate(spot.x, spot.y, block, 'board', i));
      } else {
        const slot = this.add.rectangle(spot.x, spot.y, PLATE_W, PLATE_H).setDepth(1);
        slot.setStrokeStyle(1, 0x3a3a3a);
        slot.setInteractive({ useHandCursor: true });
        slot.on('pointerdown', () => this.clickSocket(i));
        keep(slot);
      }
    });

    // Tray
    this.tray.forEach((entry, i) => {
      const col = TRAY_COLS[i % TRAY_COLS.length];
      const row = TRAY_ROW_Y[Math.floor(i / TRAY_COLS.length)] ?? TRAY_ROW_Y[0];
      if (col === undefined) return;
      keep(this.drawPlate(col, row, entry.id, 'tray', i, entry.count));
    });

    // Cursor highlight
    if (this.phase === 'build') {
      const pos = this.cursorPos();
      const cur = this.add.rectangle(pos.x, pos.y, PLATE_W + 4, PLATE_H + 4).setDepth(6);
      cur.setStrokeStyle(1, this.holding ? HEX.orange : HEX.white);
      keep(cur);
    }

    // Caption + RUN button + controls hint
    const caption = this.add
      .text(4, CAPTION_Y, this.captionText(), {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: C.white,
        wordWrap: { width: 250 },
        maxLines: 2,
      })
      .setOrigin(0, 0);
    keep(caption);
    const run = this.txt(GAME_WIDTH - 4, CAPTION_Y, '[R] RUN ▶', C.white, 9, 1);
    run.setInteractive({ useHandCursor: true });
    run.on('pointerdown', () => this.runLoop());
    keep(run);
    const hint =
      this.mode === 'guided'
        ? 'ARROWS move · ENTER pick/place · X remove · R run · ESC leave'
        : 'ARROWS move · ENTER pick/place · X remove · R run';
    keep(this.txt(4, 194, hint, C.dim, 6));

    this.renderLog();
  }

  private drawPlate(
    x: number,
    y: number,
    block: BlockId,
    where: 'board' | 'tray',
    index: number,
    count?: number,
  ): Phaser.GameObjects.Container {
    const info = blockInfo(block);
    const dim = where === 'tray' && (count ?? 1) <= 0;
    const rect = this.add.rectangle(0, 0, PLATE_W, PLATE_H, dim ? 0x141414 : HEX.plate);
    rect.setStrokeStyle(1, dim ? 0x333333 : HEX.brass);
    const labelColor = dim
      ? C.dim
      : block === 'verifier_machine'
        ? C.green
        : block === 'verifier_subjective'
          ? C.violet
          : C.white;
    const label = this.add
      .text(0, 0, info.label, { fontFamily: 'monospace', fontSize: '6px', color: labelColor })
      .setOrigin(0.5, 0.5);
    const parts: Phaser.GameObjects.GameObject[] = [rect, label];
    if (count !== undefined && count > 1) {
      parts.push(
        this.add
          .text(PLATE_W / 2 - 2, -PLATE_H / 2 + 1, `x${count}`, {
            fontFamily: 'monospace',
            fontSize: '6px',
            color: C.orange,
          })
          .setOrigin(1, 0),
      );
    }
    const cont = this.add.container(x, y, parts).setDepth(3);
    rect.setInteractive({ useHandCursor: true });
    if (where === 'tray') {
      rect.on('pointerdown', () => this.clickTray(index));
    } else {
      rect.on('pointerdown', () => this.clickSocket(index));
    }
    return cont;
  }

  private cableCurve(a: SocketSpot, b: SocketSpot): Phaser.Curves.QuadraticBezier {
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    const sag = 10 + dist * 0.1;
    const mid = new Phaser.Math.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2 + sag);
    return new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(a.x, a.y),
      mid,
      new Phaser.Math.Vector2(b.x, b.y),
    );
  }

  private drawCable(g: Phaser.GameObjects.Graphics, curve: Phaser.Curves.QuadraticBezier, color: number): void {
    g.clear();
    g.lineStyle(2, color, 1);
    curve.draw(g, 24);
  }

  private drawBridge(keep: (o: Phaser.GameObjects.GameObject) => void): void {
    // Chasm inside the ring: two cliffs, a plank bridge, one plank missing.
    const chasm = this.add.rectangle(163, 67, 166, 44, 0x050a12).setDepth(1);
    keep(chasm);
    keep(this.add.rectangle(96, 67, 32, 44, HEX.carbon).setDepth(1));
    keep(this.add.rectangle(230, 67, 32, 44, HEX.carbon).setDepth(1));
    for (let x = 118; x <= 208; x += 12) {
      if (Math.abs(x - BRIDGE_GAP.x) < 6) continue; // the missing plank
      keep(this.add.rectangle(x, 67, 8, 18, HEX.brassDark).setDepth(2));
    }
    const gap = this.add.rectangle(BRIDGE_GAP.x, BRIDGE_GAP.y, 8, 18).setDepth(2);
    gap.setStrokeStyle(1, HEX.green);
    keep(gap);
    if (!this.reduced && this.phase === 'build') {
      this.tweens.add({ targets: gap, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
    }
    // The party, waiting on the near cliff.
    this.partyDots = [];
    const dotColors = [HEX.white, HEX.green, HEX.blue, HEX.orange];
    dotColors.forEach((color, i) => {
      const d = this.add.rectangle(88 + (i % 2) * 5, 60 + Math.floor(i / 2) * 6, 3, 3, color).setDepth(3);
      this.partyDots.push(d);
      keep(d);
    });
    keep(
      this.add
        .text(163, 84, LOOP_CONTENT.ridge.plate, {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: C.brass,
        })
        .setOrigin(0.5, 0)
        .setDepth(3),
    );
  }

  private cursorPos(): SocketSpot {
    if (this.zone === 'board') {
      return SOCKET_SPOTS[this.cursor] ?? { x: 63, y: 34 };
    }
    const col = TRAY_COLS[this.cursor % TRAY_COLS.length] ?? 28;
    const row = TRAY_ROW_Y[Math.floor(this.cursor / TRAY_COLS.length)] ?? 172;
    return { x: col, y: row };
  }

  private captionText(): string {
    if (this.holding) {
      const info = blockInfo(this.holding);
      return `HOLDING ${info.label} (${info.sub}) — ENTER seats it. ESC returns it.`;
    }
    if (this.zone === 'tray') {
      const entry = this.tray[this.cursor];
      if (!entry) return '';
      const info = blockInfo(entry.id);
      const left = entry.count <= 0 ? ' (none left)' : '';
      return `${info.label} (${info.sub})${left} — ${info.desc}`;
    }
    const block = this.sockets[this.cursor];
    if (block) {
      const info = blockInfo(block);
      return `${info.label} (${info.sub}) — ${info.desc}`;
    }
    if (this.mode === 'guided') {
      const intended = GUIDED_LAYOUT[this.cursor];
      if (intended === null || intended === undefined) {
        const hints = LOOP_CONTENT.guided.socketHints;
        // The two teaching sockets carry their own hints.
        if (this.cursor === 4) return hints['observe'] ?? 'EMPTY SOCKET';
        if (this.cursor === 7) return hints['stop_cap'] ?? 'EMPTY SOCKET';
      }
    }
    return 'EMPTY SOCKET — seat a block here.';
  }

  // --- build-phase interaction ---------------------------------------------

  private moveCursor(delta: number): void {
    if (this.phase !== 'build') return;
    const len = this.zone === 'board' ? this.sockets.length : this.tray.length;
    if (len === 0) return;
    this.cursor = (this.cursor + delta + len) % len;
    this.redraw();
  }

  private switchZone(): void {
    if (this.phase !== 'build') return;
    this.zone = this.zone === 'board' ? 'tray' : 'board';
    const len = this.zone === 'board' ? this.sockets.length : this.tray.length;
    this.cursor = Math.min(this.cursor, Math.max(0, len - 1));
    this.redraw();
  }

  private primary(): void {
    if (this.phase === 'verdict') {
      this.verdictEnter();
      return;
    }
    if (this.phase !== 'build') return;
    if (this.zone === 'tray') {
      this.pickupFromTray(this.cursor);
    } else if (this.holding) {
      this.seat(this.cursor);
    } else {
      this.liftFromSocket(this.cursor);
    }
  }

  private pickupFromTray(idx: number): void {
    if (this.holding) return;
    const entry = this.tray[idx];
    if (!entry || entry.count <= 0) return;
    entry.count -= 1;
    this.holding = entry.id;
    this.zone = 'board';
    // Land the cursor on the first empty socket, if any.
    const empty = this.sockets.findIndex((b) => b === null);
    if (empty >= 0) this.cursor = empty;
    this.redraw();
  }

  private liftFromSocket(idx: number): void {
    const block = this.sockets[idx];
    if (!block) return;
    this.sockets[idx] = null;
    this.holding = block;
    this.redraw();
  }

  private seat(idx: number): void {
    if (!this.holding) return;
    const displaced = this.sockets[idx] ?? null;
    this.sockets[idx] = this.holding;
    this.holding = null;
    if (displaced) this.returnToTray(displaced);
    this.destroyGhost();
    this.redraw();
  }

  private returnToTray(block: BlockId): void {
    const entry = this.tray.find((e) => e.id === block);
    if (entry) {
      entry.count += 1;
    } else {
      this.tray.push({ id: block, count: 1 });
    }
  }

  private removeAtCursor(): void {
    if (this.phase !== 'build' || this.zone !== 'board') return;
    const block = this.sockets[this.cursor];
    if (!block) return;
    this.sockets[this.cursor] = null;
    this.returnToTray(block);
    this.redraw();
  }

  private escape(): void {
    if (this.phase === 'verdict') {
      this.verdictEscape();
      return;
    }
    if (this.phase !== 'build') return;
    if (this.holding) {
      this.returnToTray(this.holding);
      this.holding = null;
      this.destroyGhost();
      this.redraw();
      return;
    }
    if (this.mode === 'guided') {
      this.exitToTrail();
    } else {
      this.appendLog(LOOP_CONTENT.ridge.retreatDenied, 'warn');
    }
  }

  // --- pointer support -----------------------------------------------------

  private clickTray(idx: number): void {
    if (this.phase !== 'build') return;
    this.zone = 'tray';
    this.cursor = idx;
    if (this.holding) {
      // Clicking the tray while holding returns the block.
      this.returnToTray(this.holding);
      this.holding = null;
      this.destroyGhost();
      this.redraw();
      return;
    }
    this.pickupFromTray(idx);
  }

  private clickSocket(idx: number): void {
    if (this.phase !== 'build') return;
    this.zone = 'board';
    this.cursor = idx;
    if (this.holding) {
      this.seat(idx);
    } else {
      this.liftFromSocket(idx);
    }
  }

  private moveGhost(p: Phaser.Input.Pointer): void {
    if (this.phase !== 'build' || !this.holding) return;
    if (!this.ghost) {
      const info = blockInfo(this.holding);
      const rect = this.add.rectangle(0, 0, PLATE_W, PLATE_H, HEX.plate, 0.85);
      rect.setStrokeStyle(1, HEX.orange);
      const label = this.add
        .text(0, 0, info.label, { fontFamily: 'monospace', fontSize: '6px', color: C.white })
        .setOrigin(0.5, 0.5);
      this.ghost = this.add.container(p.worldX, p.worldY, [rect, label]).setDepth(9);
    }
    this.ghost.setPosition(p.worldX, p.worldY);
  }

  private pointerRelease(p: Phaser.Input.Pointer): void {
    if (this.phase !== 'build' || !this.holding || !this.ghost) return;
    // Drag semantics: releasing over a socket seats the block there.
    let nearest = -1;
    let best = 24;
    SOCKET_SPOTS.forEach((s, i) => {
      const d = Phaser.Math.Distance.Between(p.worldX, p.worldY, s.x, s.y);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest >= 0) {
      this.cursor = nearest;
      this.zone = 'board';
      this.seat(nearest);
    }
  }

  private destroyGhost(): void {
    this.ghost?.destroy();
    this.ghost = null;
  }

  // --- RUN -----------------------------------------------------------------

  private runLoop(): void {
    if (this.phase !== 'build' || this.mode === 'tutorial') return;
    if (this.holding) {
      this.returnToTray(this.holding);
      this.holding = null;
      this.destroyGhost();
    }
    const def: LoopDefinition = {
      blocks: this.sockets.filter((b): b is BlockId => b !== null),
    };
    const outcome = evaluateLoop(def, {
      startTokens: Math.round(getState().resources.tokens),
      rand: () => actions.rand(),
    });

    if (outcome.verdict === 'incomplete') {
      // Pre-flight refusal: log the cold sockets, stay in build.
      this.appendLog(outcome.banner, 'warn');
      outcome.timeline.forEach((ev) => {
        if (ev.line) this.appendLog(ev.line, ev.tone);
      });
      return;
    }

    this.phase = 'running';
    this.logLines = [];
    this.redrawForRun();
    void this.playRun(def, outcome);
  }

  private redrawForRun(): void {
    // Rebuild the board without the cursor (phase !== 'build' hides it).
    this.redraw();
  }

  private async playRun(def: LoopDefinition, outcome: LoopOutcome): Promise<void> {
    this.lastOutcome = outcome;
    await this.playTimeline(outcome);
    await this.resolveOutcome(def, outcome);
  }

  private async playTimeline(outcome: LoopOutcome): Promise<void> {
    for (const ev of outcome.timeline) {
      const delay = ev.speed === 'frantic' ? 55 : ev.speed === 'fast' ? 150 : 380;
      if (ev.blockId) await this.movePulseTo(ev.blockId);
      if (ev.fx === 'invoice') {
        this.invoiceLine(ev.line ?? '');
      } else if (ev.line) {
        this.appendLog(ev.line, ev.tone);
      }
      if (ev.tokensAfter !== undefined) this.setTokenMeter(ev.tokensAfter);
      if (ev.fx && ev.fx !== 'invoice') this.runFx(ev.fx, ev);
      await this.wait(delay);
    }
  }

  /** Current travels the cable: glide the glow pulse to the block's socket. */
  private async movePulseTo(blockId: BlockId): Promise<void> {
    const targetPos = this.findFilledPos(blockId);
    if (targetPos < 0) return;
    if (!this.pulse) {
      const startIdx = this.filledOrder[targetPos];
      const spot = startIdx !== undefined ? SOCKET_SPOTS[startIdx] : undefined;
      this.pulse = this.add.circle(spot?.x ?? 63, spot?.y ?? 34, 2, HEX.green).setDepth(7);
      this.glow(this.pulse, HEX.green, 4);
      this.runObjs.push(this.pulse);
      this.pulsePos = targetPos;
      return;
    }
    if (this.reduced) {
      const idx = this.filledOrder[targetPos];
      const spot = idx !== undefined ? SOCKET_SPOTS[idx] : undefined;
      if (spot) this.pulse.setPosition(spot.x, spot.y);
      this.pulsePos = targetPos;
      return;
    }
    // Walk forward around the ring, segment by segment.
    let guard = 0;
    while (this.pulsePos !== targetPos && guard < this.filledOrder.length + 1) {
      guard++;
      const seg = this.cableSegs[this.pulsePos];
      const nextPos = (this.pulsePos + 1) % this.filledOrder.length;
      if (seg) await this.glideAlong(seg.curve);
      this.pulsePos = nextPos;
    }
  }

  private glideAlong(curve: Phaser.Curves.QuadraticBezier): Promise<void> {
    return new Promise((resolve) => {
      const pulse = this.pulse;
      if (!pulse) {
        resolve();
        return;
      }
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 110,
        onUpdate: (tw) => {
          const p = curve.getPoint(tw.getValue() ?? 0);
          pulse.setPosition(p.x, p.y);
        },
        onComplete: () => resolve(),
      });
    });
  }

  private findFilledPos(blockId: BlockId): number {
    // Prefer the next matching socket at or after the pulse, ring order.
    const n = this.filledOrder.length;
    for (let step = 0; step < n; step++) {
      const pos = (this.pulsePos + step) % n;
      const idx = this.filledOrder[pos];
      if (idx !== undefined && this.sockets[idx] === blockId) return pos;
    }
    return -1;
  }

  private runFx(fx: NonNullable<TimelineEvent['fx']>, ev: TimelineEvent): void {
    switch (fx) {
      case 'spark':
        this.sparkAtPulse();
        break;
      case 'flash':
        if (!this.reduced) {
          this.cameras.main.flash(280, 27, 203, 1);
          this.shower?.explode(36, 160, 20);
        }
        break;
      case 'checks':
        this.spawnChecks();
        break;
      case 'shake':
        if (!this.reduced) this.cameras.main.shake(160, 0.008);
        break;
      case 'invoice':
        this.invoiceLine(ev.line ?? '');
        break;
    }
  }

  /** The failing block sparks; its cable — and everything after — goes dark. */
  private sparkAtPulse(): void {
    const idx = this.filledOrder[this.pulsePos];
    const spot = idx !== undefined ? SOCKET_SPOTS[idx] : undefined;
    if (spot && !this.reduced) {
      this.sparks?.explode(26, spot.x, spot.y);
      this.cameras.main.shake(200, 0.01);
    }
    for (let k = this.pulsePos; k < this.cableSegs.length; k++) {
      const seg = this.cableSegs[k];
      if (seg) this.drawCable(seg.g, seg.curve, HEX.cableDark);
    }
    if (this.pulse) this.pulse.setFillStyle(HEX.violet);
  }

  private spawnChecks(): void {
    if (this.reduced) return;
    for (let i = 0; i < 3; i++) {
      const x = 40 + Math.random() * 240;
      const y = 30 + Math.random() * 70;
      const t = this.txt(x, y, '✓', C.green, 9);
      t.setDepth(8);
      this.runObjs.push(t);
      this.tweens.add({
        targets: t,
        y: y - 18,
        alpha: 0,
        duration: 900,
        onComplete: () => t.destroy(),
      });
    }
  }

  private invoiceLine(line: string): void {
    if (!this.invoicePanel) {
      const paper = this.add.rectangle(0, 0, 190, 62, HEX.manila);
      paper.setStrokeStyle(1, HEX.carbon);
      this.invoicePanel = this.add.container(160, this.reduced ? 66 : 230, [paper]).setDepth(11);
      this.runObjs.push(this.invoicePanel);
      this.invoiceCount = 0;
      if (!this.reduced) {
        this.tweens.add({ targets: this.invoicePanel, y: 66, duration: 420, ease: 'Back.Out' });
      }
    }
    const t = this.add
      .text(-88, -25 + this.invoiceCount * 9, line, {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: '#3a342b',
      })
      .setOrigin(0, 0);
    this.invoicePanel.add(t);
    this.invoiceCount++;
  }

  // --- outcome -------------------------------------------------------------

  private async resolveOutcome(def: LoopDefinition, outcome: LoopOutcome): Promise<void> {
    const state = getState();
    const bankedFlag = `lbBanked_${this.mechanic}`;
    let tokensDelta = outcome.tokensDelta;

    // Guided mode cannot fail permanently: losses never drop tokens below 6.
    if (this.mode === 'guided' && tokensDelta < 0) {
      tokensDelta = Math.max(tokensDelta, -Math.max(0, state.resources.tokens - 6));
    }
    // Efficient loops bank Tokens — once per landmark (no farming the fork).
    if (outcome.verdict === 'success' && state.flags[bankedFlag]) {
      tokensDelta = 0;
    }

    actions.applyResourceDelta({ tokens: tokensDelta, morale: outcome.moraleDelta });
    if (outcome.daysDelta > 0) actions.advanceDay(outcome.daysDelta);
    if (outcome.verdict === 'success') actions.setFlag(bankedFlag);
    recordLoopOutcome(this.mechanic, def, outcome);
    saveRun(getState());
    this.setTokenMeter(Math.round(getState().resources.tokens));

    // Ridge is played for keeps: a drained party dies of the verdict.
    if (outcome.deathCause && getState().resources.tokens <= 0) {
      this.showBanner(outcome.banner, 'fail');
      this.phase = 'dead';
      actions.markDead(outcome.deathCause);
      saveRun(getState());
      await this.wait(1600);
      this.scene.start('Death', { cause: outcome.deathCause });
      return;
    }

    await this.wait(650); // let the joke land before the banner
    if (this.mode === 'ridge' && (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')) {
      // The bridge moment plays out in the clear, before the banner lands.
      await this.playCrossing(outcome.verdict === 'human_gate_everywhere');
    }
    this.showBanner(
      outcome.banner,
      outcome.verdict === 'success' ? 'ok' : outcome.verdict === 'human_gate_everywhere' ? 'warn' : 'fail',
    );
    await this.maybeShowCards(outcome);

    if (this.mode === 'guided' && outcome.verdict === 'success') {
      actions.setFlag('loopBuilderGuidedCleared');
      saveRun(getState());
    }

    this.phase = 'verdict';
    this.showVerdictHint(outcome);
  }

  private async maybeShowCards(outcome: LoopOutcome): Promise<void> {
    const flags = getState().flags;
    // The agentic loop: first successful RUN at the Loop Fork.
    if (this.mode === 'guided' && outcome.verdict === 'success' && !flags['lbCardAgentic']) {
      actions.setFlag('lbCardAgentic');
      saveRun(getState());
      await this.wait(700);
      await showCurriculumCard('agentic_loop');
    }
    // Machine-checkable verifiers: first "looks good" failure at the Ridge.
    if (this.mode === 'ridge' && outcome.verdict === 'subjective_verifier' && !flags['lbCardVerifier']) {
      actions.setFlag('lbCardVerifier');
      saveRun(getState());
      await this.wait(700);
      await showCurriculumCard('verifier_machine_checkable');
    }
    // Stop conditions: once per distinct stop-related failure.
    if (outcome.verdict === 'no_stop_cap' && !flags['lbCardStopCap']) {
      actions.setFlag('lbCardStopCap');
      saveRun(getState());
      await this.wait(700);
      await showCurriculumCard('stop_conditions');
    }
    if (outcome.verdict === 'no_stop_budget' && !flags['lbCardStopBudget']) {
      actions.setFlag('lbCardStopBudget');
      saveRun(getState());
      await this.wait(700);
      await showCurriculumCard('stop_conditions');
    }
  }

  /** The bridge plank slots in; the party crosses; miles are banked. */
  private async playCrossing(gated: boolean): Promise<void> {
    this.phase = 'crossing';
    const verifierSocket = this.sockets.findIndex((b) => b === 'verifier_machine');
    const spot = SOCKET_SPOTS[verifierSocket] ?? { x: 191, y: 34 };

    const plank = this.add.rectangle(spot.x, spot.y, 8, 18, HEX.brass).setDepth(9);
    this.runObjs.push(plank);
    if (this.reduced) {
      plank.setPosition(BRIDGE_GAP.x, BRIDGE_GAP.y);
    } else {
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: plank,
          x: BRIDGE_GAP.x,
          y: BRIDGE_GAP.y,
          angle: 360,
          duration: 750,
          ease: 'Cubic.Out',
          onComplete: () => resolve(),
        });
      });
      this.cameras.main.flash(240, 27, 203, 1);
      this.shower?.explode(30, BRIDGE_GAP.x, BRIDGE_GAP.y - 10);
    }

    // The party crosses.
    for (const [i, dot] of this.partyDots.entries()) {
      const targetX = 226 + (i % 2) * 5;
      if (this.reduced) {
        dot.setX(targetX);
      } else {
        this.tweens.add({ targets: dot, x: targetX, duration: 650, delay: i * 160 });
      }
    }
    await this.wait(1100);

    if (gated) {
      this.appendLog(LOOP_CONTENT.ridge.crossGated, 'warn');
    } else {
      for (const line of LOOP_CONTENT.ridge.crossSuccess) this.appendLog(line, 'ok');
      actions.travelMiles(40, TOTAL_MILES);
      actions.advanceDay(1);
      actions.setFlag('verifierRidgeCrossed');
      actions.log(LOOP_CONTENT.ridge.banked);
      saveRun(getState());
      this.appendLog(LOOP_CONTENT.ridge.banked, 'ok');
    }
  }

  private showBanner(text: string, tone: Tone): void {
    // The invoice had its scene; the verdict takes the stage.
    this.invoicePanel?.setDepth(9);
    const back = this.add.rectangle(GAME_WIDTH / 2, 66, 316, 48, 0x000000, 0.88).setDepth(10);
    back.setStrokeStyle(1, tone === 'ok' ? HEX.green : tone === 'warn' ? HEX.orange : HEX.violet);
    this.runObjs.push(back);
    const t = this.add
      .text(GAME_WIDTH / 2, 61, text, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: this.toneColor(tone),
        align: 'center',
        wordWrap: { width: 300 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(10);
    this.runObjs.push(t);
    this.glow(t, tone === 'ok' ? HEX.green : tone === 'warn' ? HEX.orange : HEX.violet, 2);
    if (!this.reduced) {
      t.setScale(0.6);
      this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.Out' });
    }
  }

  private showVerdictHint(outcome: LoopOutcome): void {
    let hint: string;
    if (this.mode === 'ridge' && (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')) {
      hint = 'ENTER - CONTINUE THE MARCH';
    } else if (outcome.verdict === 'success') {
      hint = 'ENTER - CONTINUE THE MARCH · ESC - KEEP TINKERING';
    } else if (this.mode === 'guided') {
      hint = 'ENTER - REWIRE THE PANEL · ESC - LEAVE';
    } else {
      hint = 'ENTER - REWIRE THE PANEL';
    }
    const t = this.txt(GAME_WIDTH / 2, 80, hint, C.white, 7, 0.5).setDepth(10);
    this.runObjs.push(t);
  }

  private verdictEnter(): void {
    const outcome = this.lastOutcome;
    if (!outcome) return;
    if (
      outcome.verdict === 'success' ||
      (this.mode === 'ridge' && outcome.verdict === 'human_gate_everywhere')
    ) {
      this.exitToTrail();
      return;
    }
    this.rewire();
  }

  private verdictEscape(): void {
    const outcome = this.lastOutcome;
    if (!outcome) return;
    if (this.mode === 'ridge' && (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')) {
      this.exitToTrail();
      return;
    }
    if (outcome.verdict === 'success') {
      this.rewire();
      return;
    }
    if (this.mode === 'guided') this.exitToTrail();
  }

  private rewire(): void {
    this.runObjs.forEach((o) => o.destroy());
    this.runObjs = [];
    this.pulse = null;
    this.pulsePos = 0;
    this.invoicePanel = null;
    this.invoiceCount = 0;
    this.phase = 'build';
    this.zone = 'board';
    this.redraw();
  }

  // =========================================================================
  // Tutorial (Fort Prompt, mile 140)
  // =========================================================================

  private createTutorial(): void {
    this.txt(4, 2, 'FORT PROMPT — MILE 140', C.white, 9);
    this.tokenText = this.txt(GAME_WIDTH - 4, 3, `TOKENS ${Math.round(getState().resources.tokens)}`, C.green, 8, 1);

    // The framed prompt.
    const frame = this.add.rectangle(GAME_WIDTH / 2, 36, 292, 40, HEX.panel);
    frame.setStrokeStyle(2, HEX.manila);
    this.txt(GAME_WIDTH / 2, 18, 'THE PROMPT (FRAMED)', C.dim, 6, 0.5);
    this.add
      .text(GAME_WIDTH / 2, 37, LOOP_CONTENT.tutorial.prompt, {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: C.green,
        align: 'center',
        wordWrap: { width: 276 },
      })
      .setOrigin(0.5, 0.5);

    // Completion bar.
    this.txt(4, 62, 'TASK COMPLETION', C.white, 7);
    this.tutBarG = this.add.graphics();
    this.tutBarText = this.txt(GAME_WIDTH - 4, 62, '0%', C.green, 7, 1);
    this.drawTutBar();

    // Action button.
    this.tutButton = this.txt(GAME_WIDTH / 2, 80, '> FIRE THE ONE-SHOT [ENTER]', C.white, 8, 0.5);
    this.tutButton.setInteractive({ useHandCursor: true });
    this.tutButton.on('pointerdown', () => void this.tutorialAdvance());

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', () => {
        if (!this.cardOpen()) void this.tutorialAdvance();
      });
      kb.on('keydown-SPACE', () => {
        if (!this.cardOpen()) void this.tutorialAdvance();
      });
      kb.on('keydown-R', () => {
        if (!this.cardOpen() && this.tutStep === 3) void this.tutorialAdvance();
      });
    }
  }

  private drawTutBar(): void {
    const g = this.tutBarG;
    if (!g) return;
    const x = 110;
    const w = 160;
    g.clear();
    g.lineStyle(1, HEX.white, 1);
    g.strokeRect(x, 62, w, 8);
    g.fillStyle(this.tutBar >= 100 ? HEX.white : HEX.green, 1);
    g.fillRect(x + 1, 63, Math.round((w - 2) * (this.tutBar / 100)), 6);
    this.tutBarText?.setText(`${Math.round(this.tutBar)}%`);
  }

  private animateBarTo(value: number): Promise<void> {
    if (this.reduced) {
      this.tutBar = value;
      this.drawTutBar();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: this.tutBar,
        to: value,
        duration: 800,
        ease: 'Cubic.Out',
        onUpdate: (tw) => {
          this.tutBar = tw.getValue() ?? this.tutBar;
          this.drawTutBar();
        },
        onComplete: () => {
          this.tutBar = value;
          this.drawTutBar();
          resolve();
        },
      });
    });
  }

  private spendTokensFloored(cost: number): void {
    const have = getState().resources.tokens;
    const spend = Math.min(cost, Math.max(0, have - 6));
    if (spend > 0) actions.applyResourceDelta({ tokens: -spend });
    saveRun(getState());
    this.setTokenMeter(Math.round(getState().resources.tokens));
  }

  private async tutorialAdvance(): Promise<void> {
    if (this.tutBusy) return;
    this.tutBusy = true;
    const T = LOOP_CONTENT.tutorial;

    if (this.tutStep === 0 || this.tutStep === 1 || this.tutStep === 2) {
      const fire = T.fires[this.tutStep] ?? [];
      const targets = [62, 64, 65];
      this.spendTokensFloored(3);
      await this.animateBarTo(targets[this.tutStep] ?? 65);
      for (const line of fire) {
        this.appendLog(line, this.tutStep === 0 ? 'info' : 'warn');
        await this.wait(500);
      }
      this.tutStep++;
      if (this.tutStep === 3) {
        this.appendLog(T.ceremony, 'warn');
        await this.wait(400);
        this.appendLog(T.loopIntro, 'info');
        this.revealMiniLoop();
        this.tutButton?.setText('> RUN THE LOOP [R]');
      } else {
        this.tutButton?.setText(
          this.tutStep === 1 ? '> FIRE IT AGAIN [ENTER]' : '> ADD A PERSONA AND A THREAT [ENTER]',
        );
      }
      this.tutBusy = false;
      return;
    }

    if (this.tutStep === 3) {
      this.tutStep = 4;
      this.tutButton?.setText('');
      await this.runMiniLoop();
      this.tutBusy = false;
      return;
    }

    if (this.tutStep === 5) {
      this.exitToTrail();
      return;
    }
    this.tutBusy = false;
  }

  private miniSockets: SocketSpot[] = [];
  private miniCurves: Phaser.Curves.QuadraticBezier[] = [];

  private revealMiniLoop(): void {
    // A two-block loop: AGENT STEP and OBSERVE, wired in a ring.
    this.miniSockets = [
      { x: 120, y: 104 },
      { x: 200, y: 104 },
    ];
    const [a, b] = this.miniSockets;
    if (!a || !b) return;
    const up = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(a.x, a.y),
      new Phaser.Math.Vector2((a.x + b.x) / 2, a.y - 16),
      new Phaser.Math.Vector2(b.x, b.y),
    );
    const down = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(b.x, b.y),
      new Phaser.Math.Vector2((a.x + b.x) / 2, a.y + 16),
      new Phaser.Math.Vector2(a.x, a.y),
    );
    this.miniCurves = [up, down];
    for (const curve of this.miniCurves) {
      const g = this.add.graphics().setDepth(1);
      this.drawCable(g, curve, HEX.cableIdle);
    }
    for (const [i, s] of this.miniSockets.entries()) {
      const sock = this.add.circle(s.x, s.y, 3, HEX.brass).setDepth(2);
      sock.setStrokeStyle(1, HEX.brassDark);
      this.drawPlate(s.x, s.y, i === 0 ? 'agent' : 'observe', 'board', i);
    }
  }

  private async runMiniLoop(): Promise<void> {
    const T = LOOP_CONTENT.tutorial;
    const targets = [74, 83, 91, 97, 100];
    const start = this.miniSockets[0];
    const pulse = this.add.circle(start?.x ?? 120, start?.y ?? 104, 2, HEX.green).setDepth(7);
    this.glow(pulse, HEX.green, 4);

    for (const [i, line] of T.loopLines.entries()) {
      for (const curve of this.miniCurves) {
        if (!this.reduced) {
          await new Promise<void>((resolve) => {
            this.tweens.addCounter({
              from: 0,
              to: 1,
              duration: 200,
              onUpdate: (tw) => {
                const p = curve.getPoint(tw.getValue() ?? 0);
                pulse.setPosition(p.x, p.y);
              },
              onComplete: () => resolve(),
            });
          });
        }
      }
      this.appendLog(line, i === T.loopLines.length - 1 ? 'ok' : 'info');
      await this.animateBarTo(targets[i] ?? 100);
    }

    if (!this.reduced) {
      this.cameras.main.flash(280, 27, 203, 1);
      this.shower?.explode(36, 160, 60);
    }
    actions.applyResourceDelta({ tokens: 12 }, 'Fort Prompt: the loop out-earned the prompt. +12 tokens.');
    saveRun(getState());
    this.setTokenMeter(Math.round(getState().resources.tokens));

    await this.wait(500);
    this.showBanner(T.banner, 'ok');
    this.appendLog(T.moral, 'ok');
    const hint = this.txt(GAME_WIDTH / 2, 90, 'ENTER - CONTINUE THE MARCH', C.white, 7, 0.5).setDepth(10);
    this.runObjs.push(hint);
    this.tutStep = 5;
  }
}
