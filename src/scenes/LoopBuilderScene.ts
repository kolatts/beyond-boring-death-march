/**
 * LoopBuilderScene — the ★ core minigame (spec §7.2), v2: THE SOCKET RING.
 *
 * One scene class, three mechanics (branch on init data):
 *  - tutorial_one_shot   (Fort Prompt, mile 140): fire a one-shot prompt,
 *    watch it plateau, watch a tiny two-station ring walk past it.
 *  - loop_builder_guided (The Loop Fork, mile 310): loop vs GRAPH. The
 *    player runs the same two jobs through a small fixed DAG and through
 *    the ring; the graph nails the pipeline cheaply and confidently ships
 *    the wrong fix on the surprise; the loop costs more and converges.
 *  - loop_builder_verifier (Verifier Ridge, mile 480): the ring, played
 *    for keeps. The bridge is missing a plank shaped like a REAL check —
 *    SQUINT AT IT does not count, which is the joke.
 *
 * The ring is pre-drawn and fixed: TRIGGER → AGENT → three CHECK sockets
 * → STOP → back to TRIGGER, plus a HUMAN GATE toggle in the middle. No
 * freeform wiring. The player seats check cards (RUN BUILD / RUN LINT /
 * RUN UI TESTS / SQUINT AT IT) and one stop config card (CAP / BUDGET /
 * BOTH / NONE), then presses RUN. The first iteration plays as slow
 * narration — the agent edits, each seated check fires in order, and a
 * failing check's output VISIBLY flows back into the agent's context
 * (observation is automatic now, shown instead of assembled). Later
 * iterations speed up. Evaluation lives in systems/loopSim.ts
 * (scene-independent; the Wave 3 boss reuses it).
 *
 * Keyboard (fully playable without a mouse):
 *   Arrows      move the cursor / switch between TRAY and RING
 *   Enter/Space tray card: seat it (stop cards replace; a seated check
 *               card is returned instead) · ring socket: unseat · gate:
 *               toggle
 *   X/Backspace unseat the focused socket
 *   R           RUN
 *   Esc         leave (where leaving is possible)
 * Tap/click: tap a tray card to seat it, a socket to unseat, the gate to
 * toggle, RUN to run.
 *
 * Reduced motion: every tween/particle/flash degrades to an instant cut.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TOTAL_MILES } from '../config';
import { coverBackdrop, queueArt } from '../systems/art';
import { sting } from '../systems/audio';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import {
  LOOP_CONTENT,
  checkInfo,
  stopInfo,
  evaluateLoop,
  recordLoopOutcome,
  type CheckId,
  type StopId,
  type RingNodeId,
  type LoopDefinition,
  type LoopOutcome,
  type TimelineEvent,
  type Tone,
} from '../systems/loopSim';

// ---------------------------------------------------------------------------
// Palette (docs/DECISIONS.md hues; shades/tints per ART-DIRECTION v3)
// ---------------------------------------------------------------------------

const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
  brass: '#c9822e',
  dim: '#6a6a6a',
} as const;

const HEX = {
  white: 0xffffff,
  green: 0x1bcb01,
  violet: 0xbb36ff,
  orange: 0xf55d08,
  blue: 0x0da1ff,
  brass: 0xc9822e,
  brassDark: 0x6e4517,
  panel: 0x101408,
  plate: 0x1c2412,
  ringIdle: 0x0d5e00,
  manila: 0xd8c7a0,
  carbon: 0x3a342b,
} as const;

// ---------------------------------------------------------------------------
// Layout (320x200 logical)
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

/** The ring. */
const RING = { x: 80, y: 72, r: 38 };

/** Station angles (deg, clockwise, -90 = top). */
const STATION_ANGLE: Record<Exclude<RingNodeId, 'gate'>, number> = {
  trigger: -90,
  agent: -30,
  check0: 30,
  check1: 90,
  check2: 150,
  stop: 210,
};

function stationPos(node: RingNodeId): Pt {
  if (node === 'gate') return { x: RING.x, y: RING.y };
  const a = Phaser.Math.DegToRad(STATION_ANGLE[node]);
  return { x: RING.x + RING.r * Math.cos(a), y: RING.y + RING.r * Math.sin(a) };
}

const PLATE_W = 50;
const PLATE_H = 11;

/** Log panel (right side terminal). */
const LOG_X = 162;
const LOG_Y = 16;
const LOG_W = 154;
const LOG_H = 132;

const CAPTION_Y = 153;
const HINT_Y = 168;
const TRAY_ROW_Y = [178, 191] as const;
const TRAY_COLS = [40, 116, 192, 268] as const;
const TRAY_W = 74;
const TRAY_H = 11;

/** Ridge bridge strip (inside the board, under the ring). */
const BRIDGE = { y: 138, gapX: 80, plankY: 136 };

/** Fork graph node positions. */
const GRAPH_POS: Record<'plan' | 'step_a' | 'step_b' | 'merge' | 'done', Pt> = {
  plan: { x: 30, y: 72 },
  step_a: { x: 82, y: 40 },
  step_b: { x: 82, y: 104 },
  merge: { x: 132, y: 72 },
  done: { x: 132, y: 94 },
};
const GRAPH_EDGES: readonly (readonly ['plan' | 'step_a' | 'step_b' | 'merge', 'step_a' | 'step_b' | 'merge'])[] = [
  ['plan', 'step_a'],
  ['plan', 'step_b'],
  ['step_a', 'merge'],
  ['step_b', 'merge'],
];

type Mode = 'tutorial' | 'fork' | 'ridge';
type Phase = 'build' | 'running' | 'verdict' | 'crossing' | 'dead';
/** Which board the fork is showing: the DAG first, then the ring. */
type Stage = 'graph' | 'ring';

type GraphCardId = 'plan' | 'step' | 'merge';
type GraphSlotId = 'plan' | 'step_a' | 'step_b' | 'merge';

const STOP_IDS: readonly StopId[] = ['cap', 'budget', 'both', 'none'];
const CHECK_IDS: readonly CheckId[] = ['run_build', 'run_lint', 'run_ui_tests', 'squint'];

/** Ring-mode board focus targets, in cursor order. */
type BoardFocus = 'check0' | 'check1' | 'check2' | 'stop' | 'gate';
const BOARD_FOCUS: readonly BoardFocus[] = ['check0', 'check1', 'check2', 'stop', 'gate'];

export class LoopBuilderScene extends Phaser.Scene {
  private mechanic = 'loop_builder_guided';
  private mode: Mode = 'fork';
  private reduced = false;

  // Ring state
  private placedChecks: CheckId[] = [];
  private stopCfg: StopId | null = null;
  private gateOn = false;

  // Fork graph state
  private stage: Stage = 'ring';
  private graphSlots: (GraphCardId | null)[] = [null, null, null, null];

  // Focus
  private zone: 'tray' | 'board' = 'tray';
  private cursor = 0;
  private phase: Phase = 'build';
  private lastOutcome: LoopOutcome | null = null;

  // Draw state
  private boardObjs: Phaser.GameObjects.GameObject[] = [];
  private runObjs: Phaser.GameObjects.GameObject[] = [];
  private logLines: { text: string; color: string }[] = [];
  private logTexts: Phaser.GameObjects.Text[] = [];
  private tokenText: Phaser.GameObjects.Text | null = null;
  private pulse: Phaser.GameObjects.Arc | null = null;
  private pulseAngle = STATION_ANGLE.trigger;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shower: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private invoicePanel: Phaser.GameObjects.Container | null = null;
  private invoiceCount = 0;
  private partyDots: Phaser.GameObjects.Rectangle[] = [];
  private graphNodeObjs = new Map<string, Phaser.GameObjects.Rectangle>();

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
          : 'fork';
    this.placedChecks = [];
    this.stopCfg = null;
    this.gateOn = false;
    this.stage = this.mode === 'fork' ? 'graph' : 'ring';
    this.graphSlots = [null, null, null, null];
    this.zone = 'tray';
    this.cursor = 0;
    this.phase = 'build';
    this.lastOutcome = null;
    this.boardObjs = [];
    this.runObjs = [];
    this.logLines = [];
    this.logTexts = [];
    this.tokenText = null;
    this.pulse = null;
    this.pulseAngle = STATION_ANGLE.trigger;
    this.invoicePanel = null;
    this.invoiceCount = 0;
    this.partyDots = [];
    this.graphNodeObjs = new Map();
    this.tutStep = 0;
    this.tutBar = 0;
    this.tutBusy = false;
  }

  preload(): void {
    // Lazy per-scene art: dim set dressing behind the interactive board.
    queueArt(this, { 'pegboard-art': 'loop-pegboard.png' });
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
    if (this.mode !== 'tutorial') {
      coverBackdrop(this, 'pegboard-art', GAME_WIDTH, GAME_HEIGHT, 0.13);
    }
    this.makePixelTexture();
    this.makeEmitters();

    if (this.mode === 'tutorial') {
      this.createTutorial();
    } else {
      this.createBoard();
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

  /** A Field Note modal owns the keyboard while open (wave advisory). */
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

  /** Terminal panel on the right (ring modes) / bottom strip (tutorial). */
  private renderLog(): void {
    this.logTexts.forEach((t) => t.destroy());
    this.logTexts = [];
    if (this.mode === 'tutorial') {
      const tail = this.logLines.slice(-5);
      tail.forEach((l, i) => {
        this.logTexts.push(this.txt(4, 124 + i * 8, l.text, l.color, 7).setDepth(4));
      });
      return;
    }
    let tail = this.logLines.slice(-11);
    // Wrapped lines vary in height; drop oldest until the panel fits.
    for (;;) {
      this.logTexts.forEach((t) => t.destroy());
      this.logTexts = [];
      let y = LOG_Y + 2;
      for (const l of tail) {
        const t = this.add
          .text(LOG_X + 3, y, l.text, {
            fontFamily: 'monospace',
            fontSize: '6px',
            color: l.color,
            wordWrap: { width: LOG_W - 8 },
            lineSpacing: 1,
          })
          .setOrigin(0, 0)
          .setDepth(4);
        this.logTexts.push(t);
        y += t.height + 2;
      }
      if (y <= LOG_Y + LOG_H || tail.length <= 1) break;
      tail = tail.slice(1);
    }
  }

  private setTokenMeter(n: number): void {
    this.tokenText?.setText(`TOKENS ${n}`);
  }

  private exitToTrail(): void {
    saveRun(getState());
    this.scene.start('Trail');
  }

  // =========================================================================
  // Board (fork + ridge)
  // =========================================================================

  private createBoard(): void {
    if (this.mode === 'fork') {
      for (const line of LOOP_CONTENT.fork.intro) this.appendLog(line, 'info');
      this.appendLog(LOOP_CONTENT.fork.graph.hint, 'warn');
    } else {
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
      kb.on('keydown-R', g(() => this.pressRun()));
      kb.on('keydown-ESC', g(() => this.escape()));
    }

    this.redraw();
  }

  private redraw(): void {
    this.boardObjs.forEach((o) => o.destroy());
    this.boardObjs = [];
    this.graphNodeObjs.clear();

    const keep = (o: Phaser.GameObjects.GameObject): void => {
      this.boardObjs.push(o);
    };

    // Header
    const title =
      this.mode === 'fork'
        ? `${LOOP_CONTENT.fork.title} — MILE 310`
        : 'VERIFIER RIDGE — MILE 480';
    keep(this.txt(4, 2, title, C.white, 9));
    this.tokenText = this.txt(
      GAME_WIDTH - 4,
      3,
      `TOKENS ${Math.round(getState().resources.tokens)}`,
      C.green,
      8,
      1,
    );
    keep(this.tokenText);

    // Board backdrop + log panel
    const board = this.add.rectangle(80, 84, 156, 140, HEX.panel, 0.9).setDepth(0);
    board.setStrokeStyle(1, HEX.brassDark);
    keep(board);
    const logBg = this.add
      .rectangle(LOG_X + LOG_W / 2 - 2, LOG_Y + LOG_H / 2, LOG_W, LOG_H + 4, 0x000000, 0.82)
      .setDepth(0);
    logBg.setStrokeStyle(1, 0x0d5e00);
    keep(logBg);

    if (this.stage === 'graph') {
      this.drawGraph(keep);
    } else {
      this.drawRing(keep);
      if (this.mode === 'ridge') this.drawBridge(keep);
    }

    this.drawTray(keep);

    // Cursor highlight
    if (this.phase === 'build') {
      const pos = this.cursorPos();
      const cur = this.add.rectangle(pos.x, pos.y, pos.w + 4, pos.h + 4).setDepth(6);
      cur.setStrokeStyle(1, HEX.white);
      keep(cur);
    }

    // Caption + RUN + controls hint
    const caption = this.add
      .text(4, CAPTION_Y, this.captionText(), {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: C.white,
        wordWrap: { width: 250 },
        maxLines: 2,
      })
      .setOrigin(0, 0)
      .setDepth(5);
    keep(caption);
    const run = this.txt(GAME_WIDTH - 4, CAPTION_Y, '[R] RUN ▶', C.white, 9, 1).setDepth(5);
    run.setInteractive({ useHandCursor: true });
    run.on('pointerdown', () => this.pressRun());
    keep(run);
    const hint =
      this.mode === 'fork'
        ? 'ARROWS move · ENTER seat/unseat · R run · ESC leave'
        : 'ARROWS move · ENTER seat/unseat · R run';
    keep(this.txt(4, HINT_Y, hint, C.dim, 6));

    this.renderLog();
  }

  // --- ring drawing ---------------------------------------------------------

  private drawRing(keep: (o: Phaser.GameObjects.GameObject) => void): void {
    // The pre-drawn circuit ring.
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(2, HEX.ringIdle, 1);
    g.strokeCircle(RING.x, RING.y, RING.r);
    keep(g);

    // Ambient current: faint dashes orbiting the ring (motion is a feature).
    if (!this.reduced && this.phase !== 'dead') {
      const dashes = this.add.container(RING.x, RING.y).setDepth(1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const d = this.add.rectangle(RING.r * Math.cos(a), RING.r * Math.sin(a), 3, 2, HEX.green, 0.35);
        dashes.add(d);
      }
      this.tweens.add({ targets: dashes, angle: 360, duration: 9000, repeat: -1 });
      keep(dashes);
    }

    // Flow arrows: clockwise chevrons between stations.
    const arrow = this.add
      .text(RING.x + RING.r + 6, RING.y - 4, '▼', { fontFamily: 'monospace', fontSize: '6px', color: C.dim })
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    keep(arrow);

    // Fixed stations: TRIGGER, AGENT, STOP.
    keep(this.drawStation('trigger', LOOP_CONTENT.nodes.trigger.label, C.white, true));
    keep(this.drawStation('agent', LOOP_CONTENT.nodes.agent.label, C.white, true));

    // Check sockets.
    for (let i = 0; i < 3; i++) {
      const node = `check${i}` as RingNodeId;
      const card = this.placedChecks[i];
      if (card) {
        const color = card === 'squint' ? C.violet : C.green;
        keep(this.drawStation(node, checkInfo(card).label, color, true, () => this.unseatCheck(i)));
      } else {
        keep(this.drawStation(node, 'CHECK —', C.dim, false, () => this.focusBoard(node)));
      }
    }

    // Stop socket. Short functional plate labels; the tray card carries
    // the full name and the caption carries the prose.
    if (this.stopCfg) {
      const short: Record<StopId, string> = {
        cap: 'STOP: CAP',
        budget: 'STOP: BUDGET',
        both: 'CAP + BUDGET',
        none: 'STOP: NONE',
      };
      const color = this.stopCfg === 'none' ? C.violet : C.orange;
      keep(this.drawStation('stop', short[this.stopCfg], color, true, () => this.unseatStop()));
    } else {
      keep(this.drawStation('stop', 'STOP —', C.dim, false, () => this.focusBoard('stop')));
    }

    // Human gate toggle, center of the ring.
    const gateColor = this.gateOn ? C.orange : C.dim;
    const gateRect = this.add.rectangle(RING.x, RING.y, 54, 12, this.gateOn ? HEX.plate : 0x121212);
    gateRect.setStrokeStyle(1, this.gateOn ? HEX.orange : 0x333333);
    gateRect.setDepth(2);
    gateRect.setInteractive({ useHandCursor: true });
    gateRect.on('pointerdown', () => this.toggleGate());
    keep(gateRect);
    keep(
      this.add
        .text(RING.x, RING.y, `GATE ${this.gateOn ? 'ON' : 'OFF'}`, {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: gateColor,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(3),
    );
  }

  private drawStation(
    node: RingNodeId,
    label: string,
    color: string,
    filled: boolean,
    onTap?: () => void,
  ): Phaser.GameObjects.Container {
    const pos = stationPos(node);
    const socket = this.add.circle(0, 0, 3, HEX.brass);
    socket.setStrokeStyle(1, HEX.brassDark);
    const rect = this.add.rectangle(0, 0, PLATE_W, PLATE_H, filled ? HEX.plate : 0x101010);
    rect.setStrokeStyle(1, filled ? HEX.brass : 0x3a3a3a);
    const text = this.add
      .text(0, 0, label, { fontFamily: 'monospace', fontSize: '5px', color })
      .setOrigin(0.5, 0.5);
    const cont = this.add.container(pos.x, pos.y, [socket, rect, text]).setDepth(2);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => {
      if (onTap) onTap();
    });
    return cont;
  }

  // --- graph drawing (fork, phase 'graph') ---------------------------------

  private drawGraph(keep: (o: Phaser.GameObjects.GameObject) => void): void {
    // Edges.
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(1, HEX.ringIdle, 1);
    for (const [a, b] of GRAPH_EDGES) {
      const pa = GRAPH_POS[a];
      const pb = GRAPH_POS[b];
      g.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
    // Merge → done.
    g.lineBetween(GRAPH_POS.merge.x, GRAPH_POS.merge.y, GRAPH_POS.done.x, GRAPH_POS.done.y);
    keep(g);

    const slots: readonly GraphSlotId[] = ['plan', 'step_a', 'step_b', 'merge'];
    slots.forEach((slot, i) => {
      const pos = GRAPH_POS[slot];
      const card = this.graphSlots[i];
      const info = LOOP_CONTENT.fork.graph.nodes[slot];
      const rect = this.add.rectangle(pos.x, pos.y, PLATE_W, PLATE_H, card ? HEX.plate : 0x101010);
      rect.setStrokeStyle(1, card ? HEX.brass : 0x3a3a3a);
      rect.setDepth(2);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.unseatGraph(i));
      keep(rect);
      this.graphNodeObjs.set(slot, rect);
      keep(
        this.add
          .text(pos.x, pos.y, card ? info.label : `${info.label} —`, {
            fontFamily: 'monospace',
            fontSize: '5px',
            color: card ? C.blue : C.dim,
          })
          .setOrigin(0.5, 0.5)
          .setDepth(3),
      );
    });

    // DONE flag (fixed).
    const done = this.add.rectangle(GRAPH_POS.done.x, GRAPH_POS.done.y, 30, 9, HEX.plate).setDepth(2);
    done.setStrokeStyle(1, HEX.brassDark);
    keep(done);
    this.graphNodeObjs.set('done', done);
    keep(
      this.add
        .text(GRAPH_POS.done.x, GRAPH_POS.done.y, LOOP_CONTENT.fork.graph.doneLabel, {
          fontFamily: 'monospace',
          fontSize: '5px',
          color: C.white,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(3),
    );
  }

  // --- ridge bridge ---------------------------------------------------------

  private drawBridge(keep: (o: Phaser.GameObjects.GameObject) => void): void {
    const chasm = this.add.rectangle(80, BRIDGE.y, 152, 24, 0x050a12).setDepth(1);
    keep(chasm);
    keep(this.add.rectangle(18, BRIDGE.y, 28, 24, HEX.carbon).setDepth(1));
    keep(this.add.rectangle(142, BRIDGE.y, 28, 24, HEX.carbon).setDepth(1));
    for (let x = 40; x <= 120; x += 10) {
      if (Math.abs(x - BRIDGE.gapX) < 5) continue; // the missing plank
      keep(this.add.rectangle(x, BRIDGE.plankY, 7, 12, HEX.brassDark).setDepth(2));
    }
    const gap = this.add.rectangle(BRIDGE.gapX, BRIDGE.plankY, 7, 12).setDepth(2);
    gap.setStrokeStyle(1, HEX.green);
    keep(gap);
    if (!this.reduced && this.phase === 'build') {
      this.tweens.add({ targets: gap, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
    }
    // The party, waiting on the near cliff.
    this.partyDots = [];
    const dotColors = [HEX.white, HEX.green, HEX.blue, HEX.orange];
    dotColors.forEach((color, i) => {
      const d = this.add
        .rectangle(12 + (i % 2) * 5, 132 + Math.floor(i / 2) * 6, 3, 3, color)
        .setDepth(3);
      this.partyDots.push(d);
      keep(d);
    });
    keep(
      this.add
        .text(80, BRIDGE.y + 8, LOOP_CONTENT.ridge.plate, {
          fontFamily: 'monospace',
          fontSize: '5px',
          color: C.brass,
        })
        .setOrigin(0.5, 0)
        .setDepth(3),
    );
  }

  // --- tray -----------------------------------------------------------------

  private trayEntries(): { label: string; color: string; seated: boolean }[] {
    if (this.stage === 'graph') {
      const cards: GraphCardId[] = ['plan', 'step', 'step', 'merge'];
      return cards.map((c, i) => ({
        label:
          c === 'plan'
            ? LOOP_CONTENT.fork.graph.nodes.plan.label
            : c === 'merge'
              ? LOOP_CONTENT.fork.graph.nodes.merge.label
              : LOOP_CONTENT.fork.graph.nodes.step_a.label,
        color: C.blue,
        seated: this.graphCardSeated(i),
      }));
    }
    const checks = CHECK_IDS.map((id) => ({
      label: checkInfo(id).label,
      color: id === 'squint' ? C.violet : C.green,
      seated: this.placedChecks.includes(id),
    }));
    const stops = STOP_IDS.map((id) => ({
      label: stopInfo(id).label,
      color: id === 'none' ? C.violet : C.orange,
      seated: this.stopCfg === id,
    }));
    return [...checks, ...stops];
  }

  private drawTray(keep: (o: Phaser.GameObjects.GameObject) => void): void {
    const entries = this.trayEntries();
    entries.forEach((e, i) => {
      const col = TRAY_COLS[i % TRAY_COLS.length];
      const rowY = TRAY_ROW_Y[Math.floor(i / TRAY_COLS.length)] ?? TRAY_ROW_Y[0];
      if (col === undefined) return;
      const rect = this.add.rectangle(col, rowY, TRAY_W, TRAY_H, e.seated ? 0x141414 : HEX.plate);
      rect.setStrokeStyle(1, e.seated ? 0x333333 : HEX.brass);
      rect.setDepth(3);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.clickTray(i));
      keep(rect);
      keep(
        this.add
          .text(col, rowY, e.label, {
            fontFamily: 'monospace',
            fontSize: '6px',
            color: e.seated ? C.dim : e.color,
          })
          .setOrigin(0.5, 0.5)
          .setDepth(4),
      );
    });
  }

  private graphCardSeated(trayIdx: number): boolean {
    // plan(0) → slot 0, step(1)/step(2) → slots 1..2, merge(3) → slot 3.
    if (trayIdx === 0) return this.graphSlots[0] !== null;
    if (trayIdx === 3) return this.graphSlots[3] !== null;
    const seatedSteps = (this.graphSlots[1] ? 1 : 0) + (this.graphSlots[2] ? 1 : 0);
    return trayIdx === 1 ? seatedSteps >= 1 : seatedSteps >= 2;
  }

  // --- focus / caption ------------------------------------------------------

  private boardFocusList(): { id: string; x: number; y: number; w: number; h: number }[] {
    if (this.stage === 'graph') {
      const slots: readonly GraphSlotId[] = ['plan', 'step_a', 'step_b', 'merge'];
      return slots.map((s) => ({ id: s, ...GRAPH_POS[s], w: PLATE_W, h: PLATE_H }));
    }
    return BOARD_FOCUS.map((f) => {
      if (f === 'gate') return { id: f, x: RING.x, y: RING.y, w: 54, h: 12 };
      const p = stationPos(f as RingNodeId);
      return { id: f, x: p.x, y: p.y, w: PLATE_W, h: PLATE_H };
    });
  }

  private cursorPos(): { x: number; y: number; w: number; h: number } {
    if (this.zone === 'board') {
      const list = this.boardFocusList();
      const item = list[this.cursor] ?? list[0];
      return item ?? { x: RING.x, y: RING.y, w: PLATE_W, h: PLATE_H };
    }
    const col = TRAY_COLS[this.cursor % TRAY_COLS.length] ?? TRAY_COLS[0];
    const rowY = TRAY_ROW_Y[Math.floor(this.cursor / TRAY_COLS.length)] ?? TRAY_ROW_Y[0];
    return { x: col, y: rowY, w: TRAY_W, h: TRAY_H };
  }

  private captionText(): string {
    if (this.stage === 'graph') {
      if (this.zone === 'tray') {
        const which =
          this.cursor === 0 ? 'plan' : this.cursor === 3 ? 'merge' : this.cursor === 1 ? 'step_a' : 'step_b';
        const info = LOOP_CONTENT.fork.graph.nodes[which];
        return `${info.label} — ${info.desc}`;
      }
      const slots: readonly GraphSlotId[] = ['plan', 'step_a', 'step_b', 'merge'];
      const slot = slots[this.cursor] ?? 'plan';
      const info = LOOP_CONTENT.fork.graph.nodes[slot];
      const seated = this.graphSlots[this.cursor] !== null;
      return seated ? `${info.label} — ${info.desc}` : `EMPTY NODE — seat ${info.label} here.`;
    }
    if (this.zone === 'tray') {
      if (this.cursor < 4) {
        const id = CHECK_IDS[this.cursor];
        if (!id) return '';
        const info = checkInfo(id);
        const seated = this.placedChecks.includes(id) ? ' (seated — ENTER returns it)' : '';
        return `${info.label} (${info.sub})${seated} — ${info.desc}`;
      }
      const id = STOP_IDS[this.cursor - 4];
      if (!id) return '';
      const info = stopInfo(id);
      const seated = this.stopCfg === id ? ' (seated)' : '';
      return `STOP CONFIG: ${info.label} (${info.sub})${seated} — ${info.desc}`;
    }
    const focus = BOARD_FOCUS[this.cursor];
    if (focus === 'gate') {
      const n = LOOP_CONTENT.nodes.gate;
      return `${n.label}: ${this.gateOn ? 'ON' : 'OFF'} (${n.sub}) — ${n.desc}`;
    }
    if (focus === 'stop') {
      if (this.stopCfg) {
        const info = stopInfo(this.stopCfg);
        return `STOP: ${info.label} — ${info.desc} (ENTER unseats)`;
      }
      return LOOP_CONTENT.nodes.stop.desc;
    }
    if (focus) {
      const idx = Number(focus.slice(5));
      const card = this.placedChecks[idx];
      if (card) {
        const info = checkInfo(card);
        return `${info.label} — ${info.desc} (ENTER unseats)`;
      }
      return 'EMPTY CHECK SOCKET — seat a check card from the tray.';
    }
    return '';
  }

  // --- build-phase interaction ----------------------------------------------

  private moveCursor(delta: number): void {
    if (this.phase !== 'build') return;
    const len = this.zone === 'board' ? this.boardFocusList().length : this.trayEntries().length;
    if (len === 0) return;
    this.cursor = (this.cursor + delta + len) % len;
    this.redraw();
  }

  private switchZone(): void {
    if (this.phase !== 'build') return;
    this.zone = this.zone === 'board' ? 'tray' : 'board';
    const len = this.zone === 'board' ? this.boardFocusList().length : this.trayEntries().length;
    this.cursor = Math.min(this.cursor, Math.max(0, len - 1));
    this.redraw();
  }

  private focusBoard(node: RingNodeId | BoardFocus): void {
    if (this.phase !== 'build') return;
    this.zone = 'board';
    const idx = BOARD_FOCUS.indexOf(node as BoardFocus);
    if (idx >= 0) this.cursor = idx;
    this.redraw();
  }

  private primary(): void {
    if (this.phase === 'verdict') {
      this.verdictEnter();
      return;
    }
    if (this.phase !== 'build') return;
    if (this.stage === 'graph') {
      if (this.zone === 'tray') this.seatGraphCard(this.cursor);
      else this.unseatGraph(this.cursor);
      return;
    }
    if (this.zone === 'tray') {
      this.clickTray(this.cursor);
      return;
    }
    const focus = BOARD_FOCUS[this.cursor];
    if (focus === 'gate') {
      this.toggleGate();
    } else if (focus === 'stop') {
      this.unseatStop();
    } else if (focus) {
      this.unseatCheck(Number(focus.slice(5)));
    }
  }

  private clickTray(idx: number): void {
    if (this.phase !== 'build') return;
    if (this.stage === 'graph') {
      this.zone = 'tray';
      this.cursor = idx;
      this.seatGraphCard(idx);
      return;
    }
    this.zone = 'tray';
    this.cursor = idx;
    if (idx < 4) {
      const id = CHECK_IDS[idx];
      if (!id) return;
      const seatedAt = this.placedChecks.indexOf(id);
      if (seatedAt >= 0) {
        this.placedChecks.splice(seatedAt, 1); // toggle back to tray
      } else if (this.placedChecks.length < 3) {
        this.placedChecks.push(id);
      } else {
        this.appendLog('All three CHECK sockets are full. Unseat one first.', 'warn');
      }
    } else {
      const id = STOP_IDS[idx - 4];
      if (!id) return;
      this.stopCfg = this.stopCfg === id ? null : id; // replace or toggle off
    }
    this.redraw();
  }

  private unseatCheck(idx: number): void {
    if (this.phase !== 'build') return;
    if (idx >= 0 && idx < this.placedChecks.length) {
      this.placedChecks.splice(idx, 1);
      this.redraw();
    }
  }

  private unseatStop(): void {
    if (this.phase !== 'build') return;
    if (this.stopCfg !== null) {
      this.stopCfg = null;
      this.redraw();
    }
  }

  private toggleGate(): void {
    if (this.phase !== 'build') return;
    this.gateOn = !this.gateOn;
    this.redraw();
  }

  private seatGraphCard(trayIdx: number): void {
    if (this.phase !== 'build' || this.stage !== 'graph') return;
    if (trayIdx === 0) {
      this.graphSlots[0] = this.graphSlots[0] ? null : 'plan';
    } else if (trayIdx === 3) {
      this.graphSlots[3] = this.graphSlots[3] ? null : 'merge';
    } else {
      // Steps fill the first empty step slot; toggling removes the last.
      if (this.graphSlots[1] === null) this.graphSlots[1] = 'step';
      else if (this.graphSlots[2] === null) this.graphSlots[2] = 'step';
      else this.graphSlots[2] = null;
    }
    this.redraw();
  }

  private unseatGraph(slotIdx: number): void {
    if (this.phase !== 'build' || this.stage !== 'graph') return;
    this.zone = 'board';
    this.cursor = slotIdx;
    if (this.graphSlots[slotIdx]) {
      this.graphSlots[slotIdx] = null;
    }
    this.redraw();
  }

  private removeAtCursor(): void {
    if (this.zone !== 'board' || this.phase !== 'build') return;
    if (this.stage === 'graph') {
      this.unseatGraph(this.cursor);
      return;
    }
    const focus = BOARD_FOCUS[this.cursor];
    if (focus === 'stop') this.unseatStop();
    else if (focus && focus !== 'gate') this.unseatCheck(Number(focus.slice(5)));
  }

  private escape(): void {
    if (this.phase === 'verdict') {
      this.verdictEscape();
      return;
    }
    if (this.phase !== 'build') return;
    if (this.mode === 'fork') {
      this.exitToTrail();
    } else {
      this.appendLog(LOOP_CONTENT.ridge.retreatDenied, 'warn');
    }
  }

  // =========================================================================
  // RUN — the graph demo (fork phase 'graph')
  // =========================================================================

  private pressRun(): void {
    if (this.phase !== 'build') return;
    if (this.stage === 'graph') {
      if (this.graphSlots.some((s) => s === null)) {
        this.appendLog('The graph is missing nodes. Seat all four cards.', 'warn');
        return;
      }
      void this.runGraph();
      return;
    }
    this.runLoop();
  }

  private async runGraph(): Promise<void> {
    this.phase = 'running';
    this.logLines = [];
    this.redraw();
    const G = LOOP_CONTENT.fork.graph;

    const playLines = async (lines: string[], failEnd: boolean): Promise<void> => {
      for (const [i, line] of lines.entries()) {
        const last = i === lines.length - 1;
        this.flashGraphNodes(line);
        const tone: Tone = failEnd && last ? 'fail' : last ? 'ok' : 'info';
        this.appendLog(line, tone);
        if (failEnd && last && !this.reduced) {
          const p = GRAPH_POS.done;
          this.sparks?.explode(20, p.x, p.y);
          this.cameras.main.shake(140, 0.006);
        }
        await this.wait(i === 0 ? 900 : 700);
      }
    };

    await playLines(G.runA, false);
    await this.wait(500);
    await playLines(G.runB, true);
    await this.wait(400);
    this.appendLog(G.verdict, 'warn');
    await this.wait(900);

    // Onward to the loop side of the fork.
    this.stage = 'ring';
    this.phase = 'build';
    this.zone = 'tray';
    this.cursor = 0;
    this.appendLog(LOOP_CONTENT.fork.loop.hint, 'warn');
    this.redraw();
  }

  private flashGraphNodes(line: string): void {
    const targets: string[] = [];
    if (line.includes('PLAN')) targets.push('plan');
    if (line.includes('STEP')) targets.push('step_a', 'step_b');
    if (line.includes('MERGE')) targets.push('merge');
    if (line.includes('DONE')) targets.push('done');
    for (const t of targets) {
      const rect = this.graphNodeObjs.get(t);
      if (!rect) continue;
      rect.setStrokeStyle(1, HEX.green);
      if (!this.reduced) {
        this.tweens.add({ targets: rect, alpha: 0.4, duration: 120, yoyo: true, repeat: 1 });
      }
    }
  }

  // =========================================================================
  // RUN — the ring
  // =========================================================================

  private currentDef(): LoopDefinition {
    return { checks: [...this.placedChecks], stop: this.stopCfg, humanGate: this.gateOn };
  }

  private runLoop(): void {
    if (this.phase !== 'build') return;
    const def = this.currentDef();
    const outcome = evaluateLoop(def, {
      startTokens: Math.round(getState().resources.tokens),
      rand: () => actions.rand(),
    });

    if (outcome.verdict === 'incomplete') {
      // Pre-flight refusal: log the cold socket, stay in build.
      this.appendLog(outcome.banner, 'warn');
      outcome.timeline.forEach((ev) => {
        if (ev.line) this.appendLog(ev.line, ev.tone);
      });
      return;
    }

    this.phase = 'running';
    this.logLines = [];
    this.redraw();

    if (this.mode === 'fork' && outcome.verdict === 'success') {
      // The fork's success run IS the two jobs — the loop-vs-graph payoff.
      void this.playForkJobs(def, outcome);
    } else {
      void this.playRun(def, outcome);
    }
  }

  private async playRun(def: LoopDefinition, outcome: LoopOutcome): Promise<void> {
    this.lastOutcome = outcome;
    await this.playTimeline(outcome.timeline);
    await this.resolveOutcome(def, outcome);
  }

  private async playTimeline(timeline: TimelineEvent[]): Promise<void> {
    for (const ev of timeline) {
      const delay =
        ev.speed === 'slow' ? 950 : ev.speed === 'frantic' ? 55 : ev.speed === 'fast' ? 170 : 400;
      if (ev.node) await this.movePulseTo(ev.node);
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

  /** Current travels the ring: glide the glow pulse clockwise to the station. */
  private async movePulseTo(node: RingNodeId): Promise<void> {
    const pos = stationPos(node);
    if (!this.pulse) {
      this.pulse = this.add.circle(pos.x, pos.y, 2, HEX.green).setDepth(7);
      this.glow(this.pulse, HEX.green, 4);
      this.runObjs.push(this.pulse);
      if (node !== 'gate') this.pulseAngle = STATION_ANGLE[node];
      return;
    }
    const pulse = this.pulse;
    if (this.reduced) {
      pulse.setPosition(pos.x, pos.y);
      if (node !== 'gate') this.pulseAngle = STATION_ANGLE[node];
      return;
    }
    if (node === 'gate') {
      // The gate sits off the ring: dart straight to the center and back later.
      await new Promise<void>((resolve) => {
        this.tweens.add({ targets: pulse, x: pos.x, y: pos.y, duration: 160, onComplete: () => resolve() });
      });
      return;
    }
    const target = STATION_ANGLE[node];
    let sweep = target - this.pulseAngle;
    while (sweep <= 0) sweep += 360; // clockwise only — it is a loop
    if (sweep >= 359.5) sweep = 0; // already there
    const from = this.pulseAngle;
    const duration = Math.max(90, sweep * 1.4);
    await new Promise<void>((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: sweep,
        duration,
        onUpdate: (tw) => {
          const a = Phaser.Math.DegToRad(from + (tw.getValue() ?? 0));
          pulse.setPosition(RING.x + RING.r * Math.cos(a), RING.y + RING.r * Math.sin(a));
        },
        onComplete: () => resolve(),
      });
    });
    this.pulseAngle = target;
  }

  private runFx(fx: NonNullable<TimelineEvent['fx']>, ev: TimelineEvent): void {
    switch (fx) {
      case 'pass':
        this.checkGlyph(ev.node, '✓', C.green);
        this.maybeBrowser(ev.node, true);
        break;
      case 'fail':
        this.checkGlyph(ev.node, '✗', C.orange);
        this.maybeBrowser(ev.node, false);
        if (!this.reduced) this.cameras.main.shake(90, 0.004);
        break;
      case 'feedback':
        this.feedbackChip();
        break;
      case 'spark':
        this.sparkAtPulse();
        break;
      case 'flash':
        sting('verifier'); // audio is opt-in (muted by default), not motion
        if (!this.reduced) {
          this.cameras.main.flash(280, 27, 203, 1);
          this.shower?.explode(36, RING.x, RING.y - 10);
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

  /** ✓ / ✗ pops at the station (glyphs, not color alone). */
  private checkGlyph(node: RingNodeId | undefined, glyph: string, color: string): void {
    const pos = node ? stationPos(node) : { x: RING.x, y: RING.y };
    const t = this.txt(pos.x + 4, pos.y - 14, glyph, color, 10);
    t.setDepth(8);
    this.runObjs.push(t);
    if (this.reduced) {
      this.time.delayedCall(600, () => t.destroy());
      return;
    }
    this.tweens.add({ targets: t, y: pos.y - 24, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  /** The tiny browser window sprite for RUN UI TESTS. */
  private maybeBrowser(node: RingNodeId | undefined, pass: boolean): void {
    if (!node || node === 'gate') return;
    const idx = Number(node.slice(5));
    if (Number.isNaN(idx) || this.placedChecks[idx] !== 'run_ui_tests') return;
    const pos = stationPos(node);
    const x = Phaser.Math.Clamp(pos.x + 26, 30, 130);
    const y = Phaser.Math.Clamp(pos.y - 8, 26, 120);
    const frame = this.add.rectangle(0, 0, 34, 24, 0x0a0a14);
    frame.setStrokeStyle(1, HEX.blue);
    const bar = this.add.rectangle(0, -9, 34, 6, HEX.blue, 0.7);
    const dot = this.add.circle(-13, -9, 1.5, HEX.white);
    const btn = this.add.rectangle(0, 3, 16, 7, pass ? HEX.green : HEX.violet);
    const glyph = this.add
      .text(11, 2, pass ? '✓' : '✗', { fontFamily: 'monospace', fontSize: '7px', color: pass ? C.green : C.orange })
      .setOrigin(0.5, 0.5);
    const win = this.add.container(x, y, [frame, bar, dot, btn, glyph]).setDepth(9);
    this.runObjs.push(win);
    if (this.reduced) {
      this.time.delayedCall(700, () => win.destroy());
      return;
    }
    win.setScale(0.3);
    this.tweens.add({ targets: win, scale: 1, duration: 150, ease: 'Back.Out' });
    this.tweens.add({
      targets: win,
      alpha: 0,
      delay: 750,
      duration: 250,
      onComplete: () => win.destroy(),
    });
  }

  /** The observe lesson, shown: failure output flies back into the AGENT. */
  private feedbackChip(): void {
    const from = this.pulse ? { x: this.pulse.x, y: this.pulse.y } : stationPos('check0');
    const to = stationPos('agent');
    const chip = this.txt(from.x, from.y, '✗ output ▸', C.orange, 6);
    chip.setDepth(9);
    this.runObjs.push(chip);
    if (this.reduced) {
      chip.setPosition(to.x - 12, to.y - 10);
      this.time.delayedCall(500, () => chip.destroy());
      return;
    }
    this.tweens.add({
      targets: chip,
      x: to.x - 12,
      y: to.y - 10,
      duration: 550,
      ease: 'Sine.InOut',
      onComplete: () => {
        this.tweens.add({ targets: chip, alpha: 0, duration: 250, onComplete: () => chip.destroy() });
      },
    });
  }

  /** The failing beat sparks; the ring current dies violet. */
  private sparkAtPulse(): void {
    const pos = this.pulse ? { x: this.pulse.x, y: this.pulse.y } : { x: RING.x, y: RING.y };
    if (!this.reduced) {
      this.sparks?.explode(26, pos.x, pos.y);
      this.cameras.main.shake(200, 0.01);
    }
    if (this.pulse) this.pulse.setFillStyle(HEX.violet);
  }

  private spawnChecks(): void {
    if (this.reduced) return;
    for (let i = 0; i < 3; i++) {
      const x = 20 + Math.random() * 120;
      const y = 30 + Math.random() * 80;
      const t = this.txt(x, y, '✓', C.green, 9);
      t.setDepth(8);
      this.runObjs.push(t);
      this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }
  }

  private invoiceLine(line: string): void {
    if (!this.invoicePanel) {
      const paper = this.add.rectangle(0, 0, 150, 62, HEX.manila);
      paper.setStrokeStyle(1, HEX.carbon);
      this.invoicePanel = this.add.container(80, this.reduced ? 72 : 230, [paper]).setDepth(11);
      this.runObjs.push(this.invoicePanel);
      this.invoiceCount = 0;
      if (!this.reduced) {
        this.tweens.add({ targets: this.invoicePanel, y: 72, duration: 420, ease: 'Back.Out' });
      }
    }
    const t = this.add
      .text(-70, -26 + this.invoiceCount * 9, line, {
        fontFamily: 'monospace',
        fontSize: '5px',
        color: '#3a342b',
      })
      .setOrigin(0, 0);
    this.invoicePanel.add(t);
    this.invoiceCount++;
  }

  // =========================================================================
  // The fork's success run: same ring, two jobs, then the verdict
  // =========================================================================

  private forkNodeFor(line: string): { node?: RingNodeId; fx?: TimelineEvent['fx'] } {
    const checkNode = (id: CheckId): RingNodeId | undefined => {
      const i = this.placedChecks.indexOf(id);
      return i >= 0 ? (`check${i}` as RingNodeId) : undefined;
    };
    const firstCheck = (): RingNodeId | undefined => {
      const i = this.placedChecks.findIndex((c) => c !== 'squint');
      return i >= 0 ? (`check${i}` as RingNodeId) : undefined;
    };
    if (line.includes('flows back')) return { node: 'agent', fx: 'feedback' };
    const check = line.includes('BUILD')
      ? (checkNode('run_build') ?? firstCheck())
      : line.includes('LINT')
        ? (checkNode('run_lint') ?? firstCheck())
        : line.includes('UI TEST')
          ? (checkNode('run_ui_tests') ?? firstCheck())
          : undefined;
    if (check) {
      const result: { node?: RingNodeId; fx?: TimelineEvent['fx'] } = { node: check };
      if (line.includes('✗')) result.fx = 'fail';
      else if (line.includes('✓')) result.fx = 'pass';
      return result;
    }
    if (line.startsWith('STOP') || line.includes('DONE')) return { node: 'stop' };
    return { node: 'agent' };
  }

  private async playForkJobs(def: LoopDefinition, outcome: LoopOutcome): Promise<void> {
    this.lastOutcome = outcome;
    const F = LOOP_CONTENT.fork;

    const toTimeline = (lines: string[], slowFirst: boolean): TimelineEvent[] =>
      lines.map((line, i) => {
        const { node, fx } = this.forkNodeFor(line);
        const last = i === lines.length - 1;
        const ev: TimelineEvent = {
          line,
          tone: last ? 'ok' : line.includes('✗') ? 'warn' : 'info',
          speed: slowFirst && i < 2 ? 'slow' : 'normal',
        };
        if (node) ev.node = node;
        if (fx) ev.fx = fx;
        return ev;
      });

    this.appendLog(LOOP_CONTENT.run.start, 'ok');
    await this.playTimeline(toTimeline(F.loop.runA, true));
    await this.wait(450);
    await this.playTimeline(toTimeline(F.loop.runB, false));
    await this.wait(450);
    this.appendLog(F.loop.verdict, 'warn');
    await this.wait(700);
    for (const line of F.tally) this.appendLog(line, 'info');
    await this.wait(600);

    await this.resolveOutcome(def, outcome);
  }

  // =========================================================================
  // Outcome
  // =========================================================================

  private async resolveOutcome(def: LoopDefinition, outcome: LoopOutcome): Promise<void> {
    const state = getState();
    const bankedFlag = `lbBanked_${this.mechanic}`;
    let tokensDelta = outcome.tokensDelta;

    // The fork cannot fail permanently: losses never drop tokens below 6.
    if (this.mode === 'fork' && tokensDelta < 0) {
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

    // The ridge is played for keeps: a drained party dies of the verdict.
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
    if (
      this.mode === 'ridge' &&
      (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')
    ) {
      // The bridge moment plays out in the clear, before the banner lands.
      await this.playCrossing(outcome.verdict === 'human_gate_everywhere');
    }

    const bannerText =
      this.mode === 'fork' && outcome.verdict === 'success' ? LOOP_CONTENT.fork.banner : outcome.banner;
    this.showBanner(
      bannerText,
      outcome.verdict === 'success' ? 'ok' : outcome.verdict === 'human_gate_everywhere' ? 'warn' : 'fail',
    );
    if (this.mode === 'fork' && outcome.verdict === 'success') {
      this.appendLog(LOOP_CONTENT.fork.moral, 'ok');
    }
    if (this.mode === 'ridge' && outcome.verdict === 'subjective_verifier') {
      this.appendLog(LOOP_CONTENT.ridge.squintDenied, 'warn');
    }
    await this.maybeShowCards(outcome);

    if (this.mode === 'fork' && outcome.verdict === 'success') {
      actions.setFlag('loopBuilderGuidedCleared');
      saveRun(getState());
    }

    this.phase = 'verdict';
    this.showVerdictHint(outcome);
  }

  private async maybeShowCards(outcome: LoopOutcome): Promise<void> {
    const flags = getState().flags;
    // The agentic loop: the fork's loop-vs-graph verdict has just landed.
    if (this.mode === 'fork' && outcome.verdict === 'success' && !flags['lbCardAgentic']) {
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
    const realIdx = this.placedChecks.findIndex((c) => c !== 'squint');
    const spot = realIdx >= 0 ? stationPos(`check${realIdx}` as RingNodeId) : stationPos('check0');

    const plank = this.add.rectangle(spot.x, spot.y, 7, 12, HEX.brass).setDepth(9);
    this.runObjs.push(plank);
    if (this.reduced) {
      plank.setPosition(BRIDGE.gapX, BRIDGE.plankY);
    } else {
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: plank,
          x: BRIDGE.gapX,
          y: BRIDGE.plankY,
          angle: 360,
          duration: 750,
          ease: 'Cubic.Out',
          onComplete: () => resolve(),
        });
      });
      this.cameras.main.flash(240, 27, 203, 1);
      this.shower?.explode(30, BRIDGE.gapX, BRIDGE.plankY - 8);
    }

    // The party crosses.
    for (const [i, dot] of this.partyDots.entries()) {
      const targetX = 138 + (i % 2) * 5;
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
    if (
      this.mode === 'ridge' &&
      (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')
    ) {
      hint = 'ENTER - CONTINUE THE MARCH';
    } else if (outcome.verdict === 'success') {
      hint = 'ENTER - CONTINUE THE MARCH · ESC - KEEP TINKERING';
    } else if (this.mode === 'fork') {
      hint = 'ENTER - REWIRE THE RING · ESC - LEAVE';
    } else {
      hint = 'ENTER - REWIRE THE RING';
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
    if (
      this.mode === 'ridge' &&
      (outcome.verdict === 'success' || outcome.verdict === 'human_gate_everywhere')
    ) {
      this.exitToTrail();
      return;
    }
    if (outcome.verdict === 'success') {
      this.rewire();
      return;
    }
    if (this.mode === 'fork') this.exitToTrail();
  }

  private rewire(): void {
    this.runObjs.forEach((o) => o.destroy());
    this.runObjs = [];
    this.pulse = null;
    this.pulseAngle = STATION_ANGLE.trigger;
    this.invoicePanel = null;
    this.invoiceCount = 0;
    this.phase = 'build';
    this.zone = 'tray';
    this.cursor = 0;
    this.redraw();
  }

  // =========================================================================
  // Tutorial (Fort Prompt, mile 140) — one-shot vs loop, on a mini ring
  // =========================================================================

  private createTutorial(): void {
    this.txt(4, 2, 'FORT PROMPT — MILE 140', C.white, 9);
    this.tokenText = this.txt(
      GAME_WIDTH - 4,
      3,
      `TOKENS ${Math.round(getState().resources.tokens)}`,
      C.green,
      8,
      1,
    );

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
        this.revealMiniRing();
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
      await this.runMiniRing();
      this.tutBusy = false;
      return;
    }

    if (this.tutStep === 5) {
      this.exitToTrail();
      return;
    }
    this.tutBusy = false;
  }

  /** The tiny two-station ring: AGENT and RUN UI TESTS, wired in a circle. */
  private miniRing = { x: 160, y: 104, r: 26 };

  private miniStationPos(which: 'agent' | 'check'): Pt {
    const a = which === 'agent' ? Math.PI : 0; // left / right
    return { x: this.miniRing.x + this.miniRing.r * Math.cos(a), y: this.miniRing.y + this.miniRing.r * Math.sin(a) };
  }

  private revealMiniRing(): void {
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(2, HEX.ringIdle, 1);
    g.strokeCircle(this.miniRing.x, this.miniRing.y, this.miniRing.r);

    const agent = this.miniStationPos('agent');
    const check = this.miniStationPos('check');
    const plates: [Pt, string, string][] = [
      [agent, LOOP_CONTENT.nodes.agent.label, C.white],
      [check, checkInfo('run_ui_tests').label, C.green],
    ];
    for (const [pos, label, color] of plates) {
      const sock = this.add.circle(pos.x, pos.y, 3, HEX.brass).setDepth(2);
      sock.setStrokeStyle(1, HEX.brassDark);
      const rect = this.add.rectangle(pos.x, pos.y, 48, 11, HEX.plate).setDepth(2);
      rect.setStrokeStyle(1, HEX.brass);
      this.add
        .text(pos.x, pos.y, label, { fontFamily: 'monospace', fontSize: '5px', color })
        .setOrigin(0.5, 0.5)
        .setDepth(3);
    }
  }

  private async runMiniRing(): Promise<void> {
    const T = LOOP_CONTENT.tutorial;
    const targets = [74, 83, 91, 97, 100];
    const start = this.miniStationPos('agent');
    const pulse = this.add.circle(start.x, start.y, 2, HEX.green).setDepth(7);
    this.glow(pulse, HEX.green, 4);

    const orbitHalf = (fromAngle: number): Promise<void> => {
      if (this.reduced) return Promise.resolve();
      return new Promise((resolve) => {
        this.tweens.addCounter({
          from: 0,
          to: Math.PI,
          duration: 260,
          onUpdate: (tw) => {
            const a = fromAngle + (tw.getValue() ?? 0);
            pulse.setPosition(
              this.miniRing.x + this.miniRing.r * Math.cos(a),
              this.miniRing.y + this.miniRing.r * Math.sin(a),
            );
          },
          onComplete: () => resolve(),
        });
      });
    };

    for (const [i, line] of T.loopLines.entries()) {
      const last = i === T.loopLines.length - 1;
      await orbitHalf(Math.PI); // agent → check (over the top)
      // The check verdict pops at the check station.
      const check = this.miniStationPos('check');
      const glyphT = this.txt(check.x + 4, check.y - 14, last ? '✓' : '✗', last ? C.green : C.orange, 9);
      glyphT.setDepth(8);
      if (!this.reduced) {
        this.tweens.add({ targets: glyphT, y: check.y - 22, alpha: 0, duration: 700, onComplete: () => glyphT.destroy() });
      } else {
        this.time.delayedCall(500, () => glyphT.destroy());
      }
      if (!last) {
        // The failure output flows back into the agent's context.
        const agent = this.miniStationPos('agent');
        const chip = this.txt(check.x, check.y + 8, '✗ output ▸', C.orange, 5);
        chip.setDepth(9);
        if (this.reduced) {
          chip.destroy();
        } else {
          this.tweens.add({
            targets: chip,
            x: agent.x - 8,
            y: agent.y + 8,
            duration: 380,
            onComplete: () => chip.destroy(),
          });
        }
      }
      await orbitHalf(0); // check → agent (under the bottom)
      this.appendLog(line, last ? 'ok' : 'info');
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
    this.showBanner(LOOP_CONTENT.tutorial.banner, 'ok');
    this.appendLog(T.moral, 'ok');
    const hint = this.txt(GAME_WIDTH / 2, 90, 'ENTER - CONTINUE THE MARCH', C.white, 7, 0.5).setDepth(10);
    this.runObjs.push(hint);
    this.tutStep = 5;
  }
}
