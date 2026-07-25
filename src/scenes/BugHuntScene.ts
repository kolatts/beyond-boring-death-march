/**
 * BugHuntScene — the hunting minigame (§7.4). Mechanic key: `bug_hunt`.
 *
 * Top-down repo terrain on a 20x10 tile grid (grid-based movement is the
 * approved simplification — DECISIONS.md). Directories are terrain
 * regions, files are drawn primitives, the odd TODO grazes peacefully.
 * Repeatable from the Trail (Wave 3 wires the HUNT action); works with no
 * landmarkId. Dev deep link: ?minigame=bug_hunt
 *
 * Keyboard map (fully playable without a mouse):
 *   Arrows / WASD   step one tile (hold two for diagonals — 8 directions)
 *   SPACE           fire a tool call along the facing direction
 *   Q               quarantine the Flaky Test (within 2 tiles; costs a day)
 *   P or ESC        pack out (carry-out screen) / leave if the bag is empty
 *
 * All flavor prose lives in src/content/bug-hunt.json. Simulation logic
 * lives in systems/bugHuntSim.ts. Curriculum cards: root_cause_vs_symptom
 * (third symptom respawn), summarise_findings (carry-out) — each fires
 * once per browser, after the joke lands.
 */

import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import rawContent from '../content/bug-hunt.json';
import {
  CARRY_CAPACITY_LBS,
  GRID_COLS,
  GRID_ROWS,
  TERRAIN_REGIONS,
  TILE,
  computePayout,
  createHuntState,
  fireToolCall,
  hasSeenCard,
  loadPersistedToolCalls,
  markCardSeen,
  returnFlaky,
  savePersistedToolCalls,
  scoreSummary,
  stepPlayer,
  tryQuarantine,
  wanderTick,
  type CarryChoice,
  type Cell,
  type Creature,
  type Finding,
  type HuntEvent,
  type HuntState,
} from '../systems/bugHuntSim';

// ---------------------------------------------------------------------------
// Content typing
// ---------------------------------------------------------------------------

interface CreatureCopyBase {
  name: string;
  glyph: string;
  description: string;
}

interface BugHuntContent {
  creatures: {
    symptom: CreatureCopyBase & {
      killMessage: string;
      respawnMessage: string;
      thirdRespawnMessage: string;
    };
    rootCause: CreatureCopyBase & {
      killMessage: string;
      relocateMessage: string;
      settledMessage: string;
    };
    flakyTest: CreatureCopyBase & {
      shootMessage: string;
      returnMessage: string;
      quarantineMessage: string;
    };
    tradeRoute: CreatureCopyBase & {
      warningMessage: string;
      envReadMessage: string;
      envReadHalvedMessage: string;
      shootMessage: string;
    };
    todo: CreatureCopyBase & { killMessage: string };
  };
  terrain: Record<'src' | 'tests' | 'docs' | 'legacy' | 'node_modules' | 'scripts', string>;
  carryOut: {
    headline: string;
    capacityLine: string;
    rotLine: string;
    summaryPrompt: string;
    leftBehindLine: string;
    emptyBag: string;
    payoutNotice: string;
    nothingCarried: string;
  };
  messages: {
    enter: string;
    outOfToolCalls: string;
    miss: string;
    quarantineTooFar: string;
    quarantineNone: string;
    compromisedNotice: string;
  };
}

const content = rawContent as BugHuntContent;

// ---------------------------------------------------------------------------
// Palette (docs/DECISIONS.md — six hues; shades/glow allowed per ART v2)
// ---------------------------------------------------------------------------

const C = {
  white: '#ffffff',
  green: '#1bcb01',
  violet: '#bb36ff',
  orange: '#f55d08',
  blue: '#0da1ff',
};

const HEX = {
  white: 0xffffff,
  green: 0x1bcb01,
  violet: 0xbb36ff,
  orange: 0xf55d08,
  blue: 0x0da1ff,
};

/** Dark shades of the six hues for terrain regions (ART-DIRECTION v2). */
const REGION_FILL: Record<string, number> = {
  src: 0x052501,
  tests: 0x03141f,
  docs: 0x121212,
  legacy: 0x16031f,
  node_modules: 0x1d0b01,
  scripts: 0x0a0a14,
};

const FILE_GRAY = 0x9a9a9a; // shade of white: the ordinary-file sprite

/** Grid pixel origin (rows 0..23 are HUD). */
const GRID_Y = 24;
const MSG_Y = 186;

const STEP_COOLDOWN_MS = 150;
const FLAKY_RETURN_MS = 4000;

function tileCX(col: number): number {
  return col * TILE + TILE / 2;
}
function tileCY(row: number): number {
  return GRID_Y + row * TILE + TILE / 2;
}

function findingName(f: Finding): string {
  switch (f.kind) {
    case 'symptom':
      return content.creatures.symptom.name;
    case 'rootCause':
      return content.creatures.rootCause.name;
    case 'todo':
      return content.creatures.todo.name;
    case 'quarantine':
      return `QUARANTINED ${content.creatures.flakyTest.name}`;
    default:
      return 'FINDING';
  }
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

type KeyMap = Record<
  'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'W' | 'A' | 'S' | 'D' | 'SPACE' | 'Q' | 'P' | 'ESC',
  Phaser.Input.Keyboard.Key
>;

export class BugHuntScene extends Phaser.Scene {
  private hunt!: HuntState;
  private keys: KeyMap | null = null;
  private sprites = new Map<number, Phaser.GameObjects.Container>();
  private playerSprite!: Phaser.GameObjects.Container;
  private facingCaret!: Phaser.GameObjects.Triangle;
  private hudLine1!: Phaser.GameObjects.Text;
  private msgLine1!: Phaser.GameObjects.Text;
  private msgLine2!: Phaser.GameObjects.Text;
  private nextStepAt = 0;
  private panelOpen = false;
  private reducedMotion = false;
  private flakyReturnTimer: Phaser.Time.TimerEvent | null = null;
  private cardShowing = false;
  private msgPriority = 0;

  constructor() {
    super('BugHunt');
  }

  init(_data: { landmarkId?: string; mechanic?: string }): void {
    // bug_hunt is repeatable from the Trail; landmarkId is optional and unused.
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.cameras.main.setBackgroundColor('#000000');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.sprites.clear();
    this.panelOpen = false;
    this.cardShowing = false;
    this.nextStepAt = 0;
    this.flakyReturnTimer = null;

    // 2x2 white pixel texture for particle effects (no assets yet — Wave 4).
    if (!this.textures.exists('bh-px')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('bh-px', 2, 2);
      g.destroy();
    }

    const s = getState();
    const juniorAlive = s.party.some((m) => m.alive && m.specialization === 'junior');
    const championAlive = s.party.some((m) => m.alive && m.specialization === 'security');
    this.hunt = createHuntState(() => actions.rand(), {
      juniorAlive,
      championAlive,
      toolCalls: loadPersistedToolCalls(Date.now()),
    });

    this.drawTerrain();
    this.drawDecorativeFiles();
    for (const c of this.hunt.creatures) this.makeCreatureSprite(c);
    this.makePlayerSprite();
    this.makeHud();
    this.setMessage(content.messages.enter, C.green);

    const kb = this.input.keyboard;
    if (kb) {
      kb.enabled = true;
      this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,Q,P,ESC') as KeyMap;
    }
    this.makeTouchControls();

    // Ambient wander: symptoms + TODOs graze.
    this.time.addEvent({
      delay: 800,
      loop: true,
      callback: () => {
        if (this.panelOpen || this.cardShowing) return;
        const moved = wanderTick(this.hunt, () => actions.rand());
        for (const id of moved) {
          const c = this.hunt.creatures.find((x) => x.id === id);
          const sprite = this.sprites.get(id);
          if (!c || !sprite) continue;
          if (this.reducedMotion) sprite.setPosition(tileCX(c.col), tileCY(c.row));
          else {
            this.tweens.add({
              targets: sprite,
              x: tileCX(c.col),
              y: tileCY(c.row),
              duration: 200,
              ease: 'Linear',
            });
          }
        }
      },
    });

    // Root-cause camouflage shimmer: a periodic tell for the observant.
    if (!this.reducedMotion) {
      this.time.addEvent({
        delay: 2800,
        loop: true,
        callback: () => {
          if (this.panelOpen) return;
          for (const c of this.hunt.creatures) {
            if (!c.alive || c.kind !== 'rootCause') continue;
            const sprite = this.sprites.get(c.id);
            if (!sprite) continue;
            this.tweens.add({
              targets: sprite,
              alpha: 0.45,
              yoyo: true,
              duration: 160,
              repeat: 1,
            });
            this.shimmerAt(c.col, c.row, HEX.violet, 4);
          }
        },
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unmountPanel('bughunt-carryout');
      if (this.input.keyboard) this.input.keyboard.enabled = true;
    });

    // Dev-only hook so playtest tooling can inspect hunt state (dev builds only).
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>)['__bughunt'] = this.hunt;
    }

    bus.emit('scene:ready', { scene: 'BugHunt' });
  }

  /**
   * On-screen controls for coarse pointers (spec §15 mobile bar): D-pad,
   * FIRE, QUARANTINE, PACK OUT. Desktop never sees them.
   */
  private touchDx = 0;
  private touchDy = 0;

  private makeTouchControls(): void {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    this.input.addPointer(2); // D-pad + action simultaneously
    const mk = (
      x: number,
      y: number,
      label: string,
      onDown: () => void,
      onUp?: () => void,
    ): void => {
      const t = this.add
        .text(x, y, label, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: { x: 5, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(60)
        .setAlpha(0.85)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', onDown);
      if (onUp) {
        t.on('pointerup', onUp);
        t.on('pointerout', onUp);
      }
    };
    const dir = (dx: number, dy: number) => () => {
      this.touchDx = dx;
      this.touchDy = dy;
    };
    const stop = (): void => {
      this.touchDx = 0;
      this.touchDy = 0;
    };
    mk(24, 154, '▲', dir(0, -1), stop);
    mk(24, 186, '▼', dir(0, 1), stop);
    mk(8, 170, '◀', dir(-1, 0), stop);
    mk(40, 170, '▶', dir(1, 0), stop);
    mk(238, 186, 'FIRE', () => this.fire());
    mk(276, 186, 'QUAR', () => this.quarantine());
    mk(308, 186, 'OUT', () => this.packOut());
  }

  override update(time: number): void {
    if (!this.keys || this.panelOpen || this.cardShowing || !this.hunt) return;
    // A Field Note modal (possibly opened by shared UI) owns the keyboard.
    if (document.querySelector('.field-note-backdrop')) return;
    const k = this.keys;

    if (Phaser.Input.Keyboard.JustDown(k.SPACE)) this.fire();
    if (Phaser.Input.Keyboard.JustDown(k.Q)) this.quarantine();
    if (Phaser.Input.Keyboard.JustDown(k.P) || Phaser.Input.Keyboard.JustDown(k.ESC)) {
      this.packOut();
      return;
    }

    const dx = Math.max(
      -1,
      Math.min(
        1,
        (k.LEFT.isDown || k.A.isDown ? -1 : 0) +
          (k.RIGHT.isDown || k.D.isDown ? 1 : 0) +
          this.touchDx,
      ),
    );
    const dy = Math.max(
      -1,
      Math.min(
        1,
        (k.UP.isDown || k.W.isDown ? -1 : 0) + (k.DOWN.isDown || k.S.isDown ? 1 : 0) + this.touchDy,
      ),
    );
    if (dx === 0 && dy === 0) {
      this.nextStepAt = 0;
      return;
    }
    if (time < this.nextStepAt) return;
    this.nextStepAt = time + STEP_COOLDOWN_MS;

    const events = stepPlayer(this.hunt, dx, dy, () => actions.rand());
    this.syncPlayerSprite();
    this.processEvents(events);
    this.updateHud();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private fire(): void {
    if (this.hunt.toolCalls <= 0) {
      this.setMessage(content.messages.outOfToolCalls, C.orange);
      return;
    }
    const result = fireToolCall(this.hunt, () => actions.rand());
    savePersistedToolCalls(this.hunt.toolCalls, Date.now());
    this.muzzleFlash(result.impact);
    this.processEvents(result.events);
    this.updateHud();
  }

  private quarantine(): void {
    const attempt = tryQuarantine(this.hunt);
    if (attempt.result === 'none') {
      this.setMessage(content.messages.quarantineNone, C.blue);
      return;
    }
    if (attempt.result === 'tooFar') {
      this.setMessage(content.messages.quarantineTooFar, C.blue);
      return;
    }
    // THE FULL DAY. Quarantine is the only way; the calendar pays for it.
    actions.advanceDay(1);
    saveRun(getState());
    this.flakyReturnTimer?.remove();
    this.flakyReturnTimer = null;
    const flaky = this.hunt.creatures.find((c) => c.kind === 'flakyTest');
    if (flaky) this.destroyCreatureSprite(flaky.id);
    this.setMessage(content.creatures.flakyTest.quarantineMessage, C.blue);
    this.updateHud();
  }

  private packOut(): void {
    savePersistedToolCalls(this.hunt.toolCalls, Date.now());
    if (this.hunt.findings.length === 0) {
      actions.log(content.carryOut.emptyBag);
      saveRun(getState());
      this.scene.start('Trail');
      return;
    }
    this.openCarryOut();
  }

  // -------------------------------------------------------------------------
  // Event processing (sim events -> messages, fx, state mutations)
  // -------------------------------------------------------------------------

  private processEvents(events: readonly HuntEvent[]): void {
    // Within one batch, high-priority messages (the .env raid) must not be
    // overwritten by incidental ones (a root cause relocating on the same step).
    this.msgPriority = 0;
    for (const ev of events) {
      switch (ev.type) {
        case 'symptomFixed': {
          this.destroyCreatureSprite(this.creatureIdAt(ev.at, 'symptom'));
          this.burstAt(ev.at.col, ev.at.row, HEX.orange, 10);
          this.setMessage(content.creatures.symptom.killMessage, C.green);
          break;
        }
        case 'symptomRespawn': {
          // The joke, made visible: each spawn pops in with a burst.
          for (const cell of ev.spawned) {
            const c = this.hunt.creatures.find(
              (x) => x.alive && x.kind === 'symptom' && x.col === cell.col && x.row === cell.row && !this.sprites.has(x.id),
            );
            if (c) this.makeCreatureSprite(c, true);
            this.burstAt(cell.col, cell.row, HEX.orange, 6);
          }
          const line =
            ev.respawnCount >= 3
              ? content.creatures.symptom.thirdRespawnMessage
              : content.creatures.symptom.respawnMessage;
          this.setMessage(content.creatures.symptom.killMessage, C.green, line, C.orange);
          if (ev.respawnCount === 3 && !hasSeenCard('root_cause_vs_symptom')) {
            markCardSeen('root_cause_vs_symptom', Date.now());
            this.cardShowing = true;
            // Let the respawn pop land first; the card explains after.
            this.time.delayedCall(this.reducedMotion ? 0 : 900, () => {
              void showCurriculumCard('root_cause_vs_symptom').then(() => {
                // Swallow keys pressed while the note was open (incl. its Enter).
                this.input.keyboard?.resetKeys();
                this.cardShowing = false;
              });
            });
          }
          break;
        }
        case 'rootCauseKilled': {
          this.destroyCreatureSprite(this.creatureIdAt(ev.at, 'rootCause'));
          this.burstAt(ev.at.col, ev.at.row, HEX.green, 24);
          if (!this.reducedMotion) this.cameras.main.flash(160, 27, 203, 1);
          this.setMessage(content.creatures.rootCause.killMessage, C.white);
          break;
        }
        case 'rootCauseRelocated': {
          const sprite = this.sprites.get(ev.id);
          if (sprite) sprite.setPosition(tileCX(ev.to.col), tileCY(ev.to.row));
          this.shimmerAt(ev.from.col, ev.from.row, HEX.violet, 8);
          this.shimmerAt(ev.to.col, ev.to.row, HEX.violet, 4);
          const c = this.hunt.creatures.find((x) => x.id === ev.id);
          const settled = c && c.relocatesLeft <= 0;
          this.setMessage(
            content.creatures.rootCause.relocateMessage,
            C.violet,
            settled ? content.creatures.rootCause.settledMessage : undefined,
            C.violet,
          );
          break;
        }
        case 'todoBagged': {
          this.destroyCreatureSprite(this.creatureIdAt(ev.at, 'todo'));
          this.burstAt(ev.at.col, ev.at.row, HEX.green, 6);
          this.setMessage(content.creatures.todo.killMessage, C.green);
          break;
        }
        case 'flakyShot': {
          const sprite = this.sprites.get(ev.id);
          if (sprite) sprite.setVisible(false);
          this.setMessage(content.creatures.flakyTest.shootMessage, C.blue);
          this.flakyReturnTimer?.remove();
          this.flakyReturnTimer = this.time.delayedCall(FLAKY_RETURN_MS, () => {
            const cell = returnFlaky(this.hunt, () => actions.rand());
            if (!cell) return;
            const flakySprite = this.sprites.get(ev.id);
            if (flakySprite) {
              flakySprite.setPosition(tileCX(cell.col), tileCY(cell.row));
              flakySprite.setVisible(true);
            }
            this.setMessage(content.creatures.flakyTest.returnMessage, C.blue);
          });
          break;
        }
        case 'tradeRouteWarning': {
          const name = this.championName();
          this.setMessage(fill(content.creatures.tradeRoute.warningMessage, { name }), C.orange);
          this.revealTradeRoute(ev.id);
          if (!this.reducedMotion) this.cameras.main.shake(120, 0.002);
          break;
        }
        case 'envRead': {
          // The alert flash. Palette has no red; violet is the failure hue.
          if (!this.reducedMotion) {
            this.cameras.main.flash(260, 187, 54, 255);
            this.cameras.main.shake(200, 0.006);
          }
          this.destroyCreatureSprite(ev.id);
          const line = ev.halved
            ? fill(content.creatures.tradeRoute.envReadHalvedMessage, { name: this.championName() })
            : content.creatures.tradeRoute.envReadMessage;
          actions.setFlag('compromised');
          actions.applyResourceDelta({ tokens: -ev.tokensLost }, line);
          saveRun(getState());
          this.setMessage(line, C.violet, content.messages.compromisedNotice, C.violet, 2);
          if (getState().resources.tokens <= 0) {
            actions.markDead('TOKEN EXHAUSTION');
            saveRun(getState());
            this.scene.start('Death', { cause: 'TOKEN EXHAUSTION' });
            return;
          }
          break;
        }
        case 'tradeRouteShot': {
          this.destroyCreatureSprite(ev.id);
          this.burstAt(ev.at.col, ev.at.row, HEX.violet, 12);
          this.setMessage(content.creatures.tradeRoute.shootMessage, C.green);
          break;
        }
        case 'miss': {
          this.setMessage(content.messages.miss, C.white);
          break;
        }
      }
    }
  }

  private championName(): string {
    return getState().party.find((m) => m.specialization === 'security')?.name ?? 'The Security Champion';
  }

  private creatureIdAt(cell: Cell, kind: Creature['kind']): number {
    // The creature is already dead in the sim; find its sprite by last position.
    const dead = this.hunt.creatures.find(
      (c) => !c.alive && c.kind === kind && c.col === cell.col && c.row === cell.row && this.sprites.has(c.id),
    );
    return dead?.id ?? -1;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private drawTerrain(): void {
    for (const r of TERRAIN_REGIONS) {
      const x = r.col * TILE;
      const y = GRID_Y + r.row * TILE;
      const w = r.cols * TILE;
      const h = r.rows * TILE;
      this.add.rectangle(x + w / 2, y + h / 2, w, h, REGION_FILL[r.id] ?? 0x0a0a0a).setDepth(0);
      this.add
        .rectangle(x + w / 2, y + h / 2, w, h)
        .setStrokeStyle(1, 0x000000, 1)
        .setDepth(1);
      this.add
        .text(x + 3, y + 2, content.terrain[r.id], {
          fontFamily: 'monospace',
          fontSize: '6px',
          color: C.white,
        })
        .setAlpha(0.45)
        .setDepth(1);
    }
  }

  /** Ordinary files: gray sprites scattered as scenery (drawn primitives —
   * Wave 4 swaps in art). Root causes camouflage as these. */
  private drawDecorativeFiles(): void {
    for (let i = 0; i < 14; i++) {
      const col = Math.floor(actions.rand() * GRID_COLS);
      const row = Math.floor(actions.rand() * GRID_ROWS);
      if (this.hunt.creatures.some((c) => c.alive && c.col === col && c.row === row)) continue;
      if (this.hunt.player.col === col && this.hunt.player.row === row) continue;
      this.fileShape(tileCX(col), tileCY(row)).setDepth(2);
    }
  }

  private fileShape(x: number, y: number): Phaser.GameObjects.Container {
    const body = this.add.rectangle(0, 0, 8, 10, FILE_GRAY, 0.8);
    const fold = this.add.rectangle(3, -4, 2, 2, 0xffffff, 0.9);
    return this.add.container(x, y, [body, fold]);
  }

  private makeCreatureSprite(c: Creature, pop = false): void {
    let container: Phaser.GameObjects.Container;
    const x = tileCX(c.col);
    const y = tileCY(c.row);

    switch (c.kind) {
      case 'symptom': {
        const body = this.add.circle(0, 0, 4, HEX.orange);
        const legL = this.add.rectangle(-4, 3, 2, 1, HEX.orange);
        const legR = this.add.rectangle(4, 3, 2, 1, HEX.orange);
        const glyph = this.add
          .text(0, 0, content.creatures.symptom.glyph, {
            fontFamily: 'monospace',
            fontSize: '6px',
            color: '#000000',
          })
          .setOrigin(0.5);
        container = this.add.container(x, y, [body, legL, legR, glyph]);
        break;
      }
      case 'rootCause': {
        // Camouflaged: looks exactly like an ordinary file. The shimmer
        // (or, reduced-motion, a faint violet edge) is the only tell.
        container = this.fileShape(x, y);
        if (this.reducedMotion) {
          const edge = this.add.rectangle(0, 0, 10, 12).setStrokeStyle(1, HEX.violet, 0.5);
          container.add(edge);
        }
        break;
      }
      case 'flakyTest': {
        const ring = this.add.circle(0, 0, 6).setStrokeStyle(1, HEX.blue, 1);
        const glyph = this.add
          .text(0, 0, content.creatures.flakyTest.glyph, {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: C.blue,
          })
          .setOrigin(0.5);
        container = this.add.container(x, y, [ring, glyph]);
        if (this.reducedMotion) container.setAlpha(0.7);
        else {
          this.tweens.add({
            targets: container,
            alpha: 0.3,
            yoyo: true,
            repeat: -1,
            duration: 600,
            ease: 'Sine.easeInOut',
          });
        }
        break;
      }
      case 'tradeRoute': {
        const stall = this.add.rectangle(0, 0, 12, 12).setStrokeStyle(1, HEX.green, 1);
        const face = this.add
          .text(0, 0, content.creatures.tradeRoute.glyph, {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: C.green,
          })
          .setOrigin(0.5);
        const flag = this.add
          .text(0, -10, '~', { fontFamily: 'monospace', fontSize: '7px', color: C.green })
          .setOrigin(0.5);
        container = this.add.container(x, y, [stall, face, flag]);
        if (!this.reducedMotion) {
          // It waves. Of course it waves.
          this.tweens.add({ targets: flag, angle: 25, yoyo: true, repeat: -1, duration: 420 });
        }
        break;
      }
      case 'todo': {
        const label = this.add
          .text(0, 0, content.creatures.todo.glyph, {
            fontFamily: 'monospace',
            fontSize: '6px',
            color: C.green,
          })
          .setOrigin(0.5)
          .setAlpha(0.7);
        container = this.add.container(x, y, [label]);
        break;
      }
    }

    container.setDepth(3);
    this.sprites.set(c.id, container);
    if (pop && !this.reducedMotion) {
      container.setScale(0);
      this.tweens.add({ targets: container, scale: 1, duration: 220, ease: 'Back.easeOut' });
    }
  }

  private revealTradeRoute(id: number): void {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    sprite.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Text) child.setColor(C.violet);
      if (child instanceof Phaser.GameObjects.Rectangle) child.setStrokeStyle(1, HEX.violet, 1);
    });
    const bang = this.add
      .text(0, -16, '!', { fontFamily: 'monospace', fontSize: '8px', color: C.violet })
      .setOrigin(0.5);
    sprite.add(bang);
  }

  private destroyCreatureSprite(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  private makePlayerSprite(): void {
    const body = this.add.rectangle(0, 0, 10, 10, HEX.white);
    const eye = this.add.rectangle(2, -2, 2, 2, 0x000000);
    this.facingCaret = this.add.triangle(0, 0, 0, -3, 6, 0, 0, 3, HEX.white);
    this.playerSprite = this.add.container(
      tileCX(this.hunt.player.col),
      tileCY(this.hunt.player.row),
      [body, eye, this.facingCaret],
    );
    this.playerSprite.setDepth(5);
    this.syncPlayerSprite();
  }

  private syncPlayerSprite(): void {
    const px = tileCX(this.hunt.player.col);
    const py = tileCY(this.hunt.player.row);
    if (this.reducedMotion) this.playerSprite.setPosition(px, py);
    else {
      this.tweens.add({ targets: this.playerSprite, x: px, y: py, duration: 90, ease: 'Linear' });
    }
    const f = this.hunt.facing;
    this.facingCaret.setPosition(f.dx * 8, f.dy * 8);
    this.facingCaret.setRotation(Math.atan2(f.dy, f.dx));
  }

  // -------------------------------------------------------------------------
  // HUD + messages
  // -------------------------------------------------------------------------

  private makeHud(): void {
    this.hudLine1 = this.add
      .text(4, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: C.white })
      .setDepth(10);
    this.add
      .text(4, 13, 'ARROWS MOVE   SPACE FIRE   Q QUARANTINE   P PACK OUT', {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: C.blue,
      })
      .setDepth(10);
    this.msgLine1 = this.add
      .text(4, MSG_Y, '', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: C.green,
        wordWrap: { width: GAME_WIDTH - 8 },
        maxLines: 1,
      })
      .setDepth(10);
    this.msgLine2 = this.add
      .text(4, MSG_Y + 8, '', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: C.green,
        wordWrap: { width: GAME_WIDTH - 8 },
        maxLines: 1,
      })
      .setDepth(10);
    this.updateHud();
  }

  private updateHud(): void {
    const t = this.hunt.toolCalls;
    const cap = this.hunt.toolCallsCap;
    const glyph = t <= 0 ? '×' : t <= Math.ceil(cap * 0.25) ? '!' : '✓';
    const color = t <= 0 ? C.violet : t <= Math.ceil(cap * 0.25) ? C.orange : C.green;
    this.hudLine1.setText(
      `TOOL CALLS ${t}/${cap} ${glyph}   BAG ${this.hunt.shotWeightLbs} LBS   DAY ${getState().day}`,
    );
    this.hudLine1.setColor(color);
  }

  private setMessage(
    line1: string,
    color1: string,
    line2?: string,
    color2?: string,
    priority = 1,
  ): void {
    if (priority < this.msgPriority) return;
    this.msgPriority = priority;
    this.msgLine1.setText(line1).setColor(color1);
    this.msgLine2.setText(line2 ?? '').setColor(color2 ?? C.green);
  }

  // -------------------------------------------------------------------------
  // Juice (every effect degrades under prefers-reduced-motion)
  // -------------------------------------------------------------------------

  private muzzleFlash(impact: Cell): void {
    if (this.reducedMotion) return;
    const px = tileCX(this.hunt.player.col);
    const py = tileCY(this.hunt.player.row);
    const ix = tileCX(impact.col);
    const iy = tileCY(impact.row);

    const tracer = this.add.line(0, 0, px, py, ix, iy, HEX.white, 0.9).setOrigin(0).setDepth(8);
    const flash = this.add
      .circle(px + this.hunt.facing.dx * 7, py + this.hunt.facing.dy * 7, 3, HEX.orange)
      .setDepth(8);
    this.tweens.add({
      targets: [tracer, flash],
      alpha: 0,
      duration: 140,
      onComplete: () => {
        tracer.destroy();
        flash.destroy();
      },
    });
    this.cameras.main.shake(60, 0.0015);
  }

  private burstAt(col: number, row: number, tint: number, quantity: number): void {
    if (this.reducedMotion) return;
    const emitter = this.add.particles(tileCX(col), tileCY(row), 'bh-px', {
      speed: { min: 20, max: 60 },
      lifespan: 320,
      quantity,
      tint,
      scale: { start: 1, end: 0 },
      emitting: false,
    });
    emitter.setDepth(9);
    emitter.explode(quantity);
    this.time.delayedCall(500, () => emitter.destroy());
  }

  private shimmerAt(col: number, row: number, tint: number, quantity: number): void {
    if (this.reducedMotion) return;
    const emitter = this.add.particles(tileCX(col), tileCY(row), 'bh-px', {
      speed: { min: 4, max: 14 },
      lifespan: 420,
      quantity,
      tint,
      alpha: { start: 0.8, end: 0 },
      emitting: false,
    });
    emitter.setDepth(9);
    emitter.explode(quantity);
    this.time.delayedCall(600, () => emitter.destroy());
  }

  // -------------------------------------------------------------------------
  // Carry-out screen (DOM panel — the punchline)
  // -------------------------------------------------------------------------

  private openCarryOut(): void {
    this.panelOpen = true;
    if (this.input.keyboard) this.input.keyboard.enabled = false;

    const findings = [...this.hunt.findings];
    const co = content.carryOut;
    const panel = mountPanel('bughunt-carryout');
    panel.innerHTML = `
      <style>
        #panel-bughunt-carryout .bh-backdrop {
          position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; background: rgba(0,0,0,0.82); z-index: 30;
        }
        #panel-bughunt-carryout .bh-panel {
          width: min(38rem, 94vw); max-height: 90vh; overflow-y: auto;
          background: var(--black); border: 2px solid var(--green);
          padding: 1rem 1.25rem; color: var(--green);
          font-family: var(--font-mono); font-size: 0.85rem;
        }
        #panel-bughunt-carryout h2 { margin: 0 0 0.4rem; font-size: 1.05rem; }
        #panel-bughunt-carryout p { margin: 0.15rem 0; }
        #panel-bughunt-carryout .bh-dim { color: var(--green); opacity: 0.75; }
        #panel-bughunt-carryout .bh-rows { margin: 0.75rem 0; display: grid; gap: 0.5rem; }
        #panel-bughunt-carryout .bh-row {
          border: 1px solid var(--green); padding: 0.4rem 0.5rem;
          display: grid; gap: 0.3rem;
        }
        #panel-bughunt-carryout .bh-row label { display: flex; gap: 0.5em; align-items: baseline; cursor: pointer; }
        #panel-bughunt-carryout .bh-row input[type="text"] {
          width: 100%; background: var(--black); color: var(--white);
          border: 1px solid var(--green); font-family: var(--font-mono);
          font-size: 0.85rem; padding: 0.25em 0.4em;
        }
        #panel-bughunt-carryout .bh-row input[type="text"]:disabled { opacity: 0.35; }
        #panel-bughunt-carryout .bh-mult { font-size: 0.75rem; opacity: 0.8; }
        #panel-bughunt-carryout .bh-meter { margin: 0.5rem 0; font-weight: bold; }
        #panel-bughunt-carryout .bh-meter.bh-over { color: var(--violet); }
        #panel-bughunt-carryout .bh-actions { display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap; }
        #panel-bughunt-carryout button:disabled { opacity: 0.4; cursor: not-allowed; }
      </style>
      <div class="bh-backdrop">
        <div class="bh-panel" role="dialog" aria-modal="true" aria-labelledby="bh-title">
          <h2 id="bh-title">${esc(fill(co.headline, { shot: this.hunt.shotWeightLbs }))}</h2>
          <p>${esc(fill(co.capacityLine, { cap: CARRY_CAPACITY_LBS }))}</p>
          <p class="bh-dim">${esc(co.rotLine)}</p>
          <p class="bh-dim">${esc(co.summaryPrompt)}</p>
          <div class="bh-rows"></div>
          <div class="bh-meter" aria-live="polite"></div>
          <p class="bh-dim bh-left"></p>
          <div class="bh-actions">
            <button type="button" class="bh-confirm">CARRY OUT &amp; RETURN TO TRAIL</button>
            <button type="button" class="bh-back">KEEP HUNTING</button>
          </div>
        </div>
      </div>`;

    const rowsEl = panel.querySelector<HTMLElement>('.bh-rows');
    const meterEl = panel.querySelector<HTMLElement>('.bh-meter');
    const leftEl = panel.querySelector<HTMLElement>('.bh-left');
    const confirmBtn = panel.querySelector<HTMLButtonElement>('.bh-confirm');
    const backBtn = panel.querySelector<HTMLButtonElement>('.bh-back');
    if (!rowsEl || !meterEl || !leftEl || !confirmBtn || !backBtn) return;

    interface Row {
      finding: Finding;
      check: HTMLInputElement;
      input: HTMLInputElement;
      mult: HTMLElement;
    }
    const rows: Row[] = [];

    for (const f of findings) {
      const row = document.createElement('div');
      row.className = 'bh-row';
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      const desc = document.createElement('span');
      desc.textContent = `${findingName(f)} — ${f.weightLbs} LBS — base ${f.baseTokens} tokens`;
      label.append(check, desc);
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 140;
      input.disabled = true;
      input.placeholder = 'One line: what breaks, where, under what condition.';
      input.setAttribute('aria-label', `Summary for ${findingName(f)}`);
      const mult = document.createElement('span');
      mult.className = 'bh-mult';
      mult.textContent = 'summary multiplier ×0.25';
      row.append(label, input, mult);
      rowsEl.appendChild(row);
      rows.push({ finding: f, check, input, mult });

      check.addEventListener('change', () => {
        input.disabled = !check.checked;
        if (check.checked) input.focus();
        refresh();
      });
      input.addEventListener('input', () => {
        const m = scoreSummary(input.value);
        mult.textContent = `summary multiplier ×${m.toFixed(2)}`;
      });
    }

    const refresh = (): void => {
      const weight = rows
        .filter((r) => r.check.checked)
        .reduce((sum, r) => sum + r.finding.weightLbs, 0);
      const over = weight > CARRY_CAPACITY_LBS;
      meterEl.textContent = `CARRYING ${weight} / ${CARRY_CAPACITY_LBS} LBS ${over ? '×' : '✓'}`;
      meterEl.classList.toggle('bh-over', over);
      confirmBtn.disabled = over;
      const leftCount = rows.filter((r) => !r.check.checked).length;
      const leftWeight = rows
        .filter((r) => !r.check.checked)
        .reduce((sum, r) => sum + r.finding.weightLbs, 0);
      leftEl.textContent = fill(co.leftBehindLine, { count: leftCount, weight: leftWeight });
    };
    refresh();

    backBtn.addEventListener('click', () => {
      unmountPanel('bughunt-carryout');
      this.panelOpen = false;
      if (this.input.keyboard) this.input.keyboard.enabled = true;
    });

    confirmBtn.addEventListener('click', () => {
      const choices: CarryChoice[] = rows
        .filter((r) => r.check.checked)
        .map((r) => ({ finding: r.finding, summary: r.input.value }));
      this.finishCarryOut(choices);
    });

    const firstCheck = rows[0]?.check;
    (firstCheck ?? confirmBtn).focus();
  }

  private finishCarryOut(choices: readonly CarryChoice[]): void {
    const co = content.carryOut;
    if (choices.length === 0) {
      actions.log(co.nothingCarried);
    } else {
      const payout = computePayout(choices);
      actions.applyResourceDelta(
        { tokens: payout.totalTokens },
        fill(co.payoutNotice, {
          count: choices.length,
          weight: payout.totalWeightLbs,
          tokens: payout.totalTokens,
        }),
      );
    }
    saveRun(getState());
    savePersistedToolCalls(this.hunt.toolCalls, Date.now());
    unmountPanel('bughunt-carryout');

    const leave = (): void => {
      this.panelOpen = false;
      if (this.input.keyboard) this.input.keyboard.enabled = true;
      this.scene.start('Trail');
    };
    if (!hasSeenCard('summarise_findings')) {
      markCardSeen('summarise_findings', Date.now());
      void showCurriculumCard('summarise_findings').then(leave);
    } else {
      leave();
    }
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
