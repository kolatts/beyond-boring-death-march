/**
 * BossScene — THE GREAT MIGRATION (spec §7.2 mile-1,700 boss; §6 row 11).
 * Mechanic key: `boss_loops` (Migration Plateau).
 *
 * Three loops run CONCURRENTLY against one shared repository under one
 * combined token budget. The player commits the budget, then assigns a
 * preset loop card to each of three workstreams; the cards' flaws mirror
 * the §7.2 failure-mode table. MERGE CONFLICT is a first-class hazard:
 * two broad-scope loops touching the shared core collide unless one is
 * serialized behind a human gate (or confined to its own module).
 *
 * Simulation: reuses evaluateLoop() from systems/loopSim.ts per its
 * REUSE CONTRACT — one call per lane with the shared remaining budget as
 * startTokens, gains ignored, spends subtracted between calls. The three
 * returned timelines are interleaved into three side-by-side terminal
 * columns.
 *
 * Win: all three converge under budget -> banked reward. Lose: spends are
 * lost (the whole committed budget when it was exhausted); tokens at zero
 * is death. Curriculum card `orchestration_parallel` fires after the
 * first resolution. All prose lives in src/content/boss.json.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { actions, getState } from '../systems/state';
import { saveRun } from '../systems/save';
import {
  evaluateLoop,
  type BlockId,
  type LoopOutcome,
  type TimelineEvent,
} from '../systems/loopSim';
import { showCurriculumCard, isFieldNoteOpen } from '../ui/curriculumCard';
import { bus } from '../ui/overlay';
import rawBoss from '../content/boss.json';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

interface BossBudget {
  id: string;
  label: string;
  tokens: number;
  blurb: string;
}

interface BossLane {
  id: string;
  label: string;
  sub: string;
}

interface BossCard {
  id: string;
  name: string;
  blurb: string;
  scope: 'narrow' | 'broad';
  serialized: boolean;
  yield: number;
  blocks: BlockId[];
}

interface BossContent {
  title: string;
  intro: string[];
  budgetPrompt: string;
  budgets: BossBudget[];
  lanes: BossLane[];
  pickPrompt: string;
  cards: BossCard[];
  run: { start: string; laneDone: string; laneFailed: string };
  conflict: { banner: string; lines: string[]; laneLine: string; notice: string };
  win: { banner: string; lines: string[]; rewardLine: string };
  lose: { banner: string; lines: string[]; budgetExhausted: string; lossLine: string };
  deathCause: string;
  retry: string;
}

const CONTENT = rawBoss as unknown as BossContent;

// ---------------------------------------------------------------------------
// Persistence — bbdm:boss (Production endgame reads this)
// ---------------------------------------------------------------------------

export const BOSS_KEY = 'bbdm:boss';

export interface BossRecord {
  v: 1;
  attempts: number;
  won: boolean;
  bestReward: number;
}

export function loadBossRecord(): BossRecord {
  try {
    const raw = window.localStorage.getItem(BOSS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as BossRecord;
      if (data?.v === 1) return data;
    }
  } catch {
    /* fall through */
  }
  return { v: 1, attempts: 0, won: false, bestReward: 0 };
}

function saveBossRecord(record: BossRecord): void {
  try {
    window.localStorage.setItem(BOSS_KEY, JSON.stringify(record));
  } catch {
    /* storage blocked: the run flags still carry the win */
  }
}

// ---------------------------------------------------------------------------
// Lane simulation result
// ---------------------------------------------------------------------------

interface LaneResult {
  card: BossCard;
  outcome: LoopOutcome;
  conflicted: boolean;
  converged: boolean;
  spend: number;
  timeline: TimelineEvent[];
}

interface BossResolution {
  lanes: LaneResult[];
  committed: number;
  totalSpend: number;
  budgetExhausted: boolean;
  won: boolean;
  reward: number;
  lost: number;
  days: number;
}

/** Rework charged to a lane that hit the merge conflict. */
const CONFLICT_REWORK = 12;
/** One-time budget charge for the shared-core collision itself. */
const CONFLICT_PENALTY = 15;
/** Flat win bonus on top of doubled banked yields. */
const WIN_BONUS = 40;

/** Pure resolution of a configured crossing. Rendering happens elsewhere. */
function resolveBoss(cards: BossCard[], committed: number, rand: () => number): BossResolution {
  // Merge-conflict hazard: >=2 broad, unserialized loops share the core.
  const colliders = cards.filter((c) => c.scope === 'broad' && !c.serialized);
  const conflictHit = colliders.length >= 2;

  let pool = committed;
  const lanes: LaneResult[] = cards.map((card) => {
    const conflicted = conflictHit && card.scope === 'broad' && !card.serialized;
    const outcome = evaluateLoop({ blocks: card.blocks }, { startTokens: Math.max(0, pool), rand });
    // Reuse contract: subtract spends, ignore gains, between calls.
    let spend = Math.max(0, -outcome.tokensDelta);
    if (conflicted) spend += CONFLICT_REWORK;
    pool -= spend;
    const converged = outcome.verdict === 'success' && !conflicted;
    const timeline = [...outcome.timeline];
    if (conflicted) {
      timeline.push({ tone: 'fail', line: CONTENT.conflict.laneLine, fx: 'spark', speed: 'fast' });
    }
    return { card, outcome, conflicted, converged, spend, timeline };
  });

  if (conflictHit) pool -= CONFLICT_PENALTY;

  const totalSpend = committed - pool;
  const budgetExhausted = pool <= 0;
  const won = lanes.every((l) => l.converged) && !budgetExhausted;

  const bankedYield = lanes.reduce(
    (sum, l) => sum + (l.converged ? l.outcome.score.tokensBanked * l.card.yield : 0),
    0,
  );
  const reward = won ? Math.round(bankedYield * 2) + WIN_BONUS : 0;
  const lost = won ? Math.min(totalSpend, committed) : budgetExhausted ? committed : Math.min(totalSpend + 10, committed);
  // Concurrent loops: the crossing takes as long as its slowest lane.
  const days = Math.max(1, ...lanes.map((l) => l.outcome.daysDelta), won ? 1 : 2);

  return { lanes, committed, totalSpend, budgetExhausted, won, reward, lost, days };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

type Step = 'brief' | 'budget' | 'pick' | 'running' | 'result';

const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const VIOLET = '#bb36ff';
const ORANGE = '#f55d08';
const BLUE = '#0da1ff';

const TONE_COLOR: Record<string, string> = {
  info: GREEN,
  ok: GREEN,
  warn: ORANGE,
  fail: VIOLET,
};
const TONE_GLYPH: Record<string, string> = { ok: '✓ ', warn: '! ', fail: '× ' };

const COL_X = [4, 111, 218] as const;
const COL_W = 100;
const COL_LINES = 8;

export class BossScene extends Phaser.Scene {
  private step: Step = 'brief';
  private cursor = 0;
  private lane = 0;
  private budgetIdx = 1;
  private picks: (BossCard | null)[] = [null, null, null];
  private drawn: Phaser.GameObjects.GameObject[] = [];
  private resolution: BossResolution | null = null;
  private cardFired = false;
  private reducedMotion = false;
  private columnLines: { text: string; color: string }[][] = [[], [], []];
  private columnTexts: (Phaser.GameObjects.Text | null)[] = [null, null, null];
  private meterText: Phaser.GameObjects.Text | null = null;
  private playTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('Boss');
  }

  init(): void {
    this.step = 'brief';
    this.cursor = 0;
    this.lane = 0;
    this.budgetIdx = 1;
    this.picks = [null, null, null];
    this.resolution = null;
    this.cardFired = false;
    this.columnLines = [[], [], []];
    this.columnTexts = [null, null, null];
    this.meterText = null;
    this.playTimer = null;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.move(-1));
      kb.on('keydown-DOWN', () => this.move(1));
      kb.on('keydown-ENTER', () => this.select());
      kb.on('keydown-SPACE', () => this.select());
      kb.on('keydown-ESC', () => this.back());
    }

    this.redraw();
    bus.emit('scene:ready', { scene: 'Boss' });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private optionCount(): number {
    switch (this.step) {
      case 'brief':
        return 1;
      case 'budget':
        return CONTENT.budgets.length;
      case 'pick':
        return CONTENT.cards.length;
      case 'result':
        return this.resultOptions().length;
      default:
        return 0;
    }
  }

  private move(delta: number): void {
    if (isFieldNoteOpen() || this.step === 'running') return;
    const count = this.optionCount();
    if (count <= 1) return;
    this.cursor = (this.cursor + delta + count) % count;
    this.redraw();
  }

  private select(): void {
    if (isFieldNoteOpen()) return;
    switch (this.step) {
      case 'brief':
        this.step = 'budget';
        this.cursor = this.budgetIdx;
        this.redraw();
        break;
      case 'budget': {
        this.budgetIdx = this.cursor;
        this.step = 'pick';
        this.lane = 0;
        this.cursor = 0;
        this.redraw();
        break;
      }
      case 'pick': {
        const card = CONTENT.cards[this.cursor];
        if (!card) return;
        this.picks[this.lane] = card;
        if (this.lane < 2) {
          this.lane += 1;
          this.cursor = 0;
          this.redraw();
        } else {
          this.runCrossing();
        }
        break;
      }
      case 'result':
        this.chooseResultOption();
        break;
      default:
        break;
    }
  }

  private back(): void {
    if (isFieldNoteOpen() || this.step === 'running' || this.step === 'result') return;
    if (this.step === 'pick') {
      if (this.lane > 0) {
        this.lane -= 1;
      } else {
        this.step = 'budget';
        this.cursor = this.budgetIdx;
      }
      this.redraw();
    } else if (this.step === 'budget') {
      this.step = 'brief';
      this.cursor = 0;
      this.redraw();
    }
  }

  // -------------------------------------------------------------------------
  // Drawing helpers
  // -------------------------------------------------------------------------

  private clearDrawn(): void {
    this.drawn.forEach((o) => o.destroy());
    this.drawn = [];
  }

  private text(
    x: number,
    y: number,
    str: string,
    color: string,
    size = 8,
    wrap = 0,
  ): Phaser.GameObjects.Text {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color,
      lineSpacing: 2,
    };
    if (wrap > 0) style.wordWrap = { width: wrap };
    const t = this.add.text(x, y, str, style).setOrigin(0, 0);
    this.drawn.push(t);
    return t;
  }

  private redraw(): void {
    this.clearDrawn();
    switch (this.step) {
      case 'brief':
        this.drawBrief();
        break;
      case 'budget':
        this.drawBudget();
        break;
      case 'pick':
        this.drawPick();
        break;
      case 'result':
        this.drawResult();
        break;
      default:
        break;
    }
  }

  private drawBrief(): void {
    const title = this.text(GAME_WIDTH / 2, 10, CONTENT.title, WHITE, 14);
    title.setOrigin(0.5, 0);
    this.text(8, 34, CONTENT.intro.join('\n\n'), GREEN, 7, GAME_WIDTH - 16);
    const prompt = this.text(GAME_WIDTH / 2, 184, '> CONFIGURE THE CROSSING', WHITE, 9);
    prompt.setOrigin(0.5, 0);
    prompt.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.select());
    if (!this.reducedMotion) {
      this.tweens.add({ targets: prompt, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
    }
  }

  private drawBudget(): void {
    this.text(8, 6, 'THE COMBINED BUDGET', WHITE, 10);
    this.text(8, 20, CONTENT.budgetPrompt, BLUE, 7, GAME_WIDTH - 16);
    const tokens = Math.floor(getState().resources.tokens);
    this.text(8, 52, `PARTY TOKENS: ${tokens}`, ORANGE, 8);

    CONTENT.budgets.forEach((b, i) => {
      const committed = Math.min(b.tokens, tokens);
      const selected = i === this.cursor;
      const row = this.text(
        12,
        68 + i * 26,
        `${selected ? '>' : ' '} ${b.label} — ${committed} TOKENS`,
        selected ? WHITE : GREEN,
        9,
      );
      row.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.cursor = i;
        this.select();
      });
      this.text(22, 79 + i * 26, b.blurb, selected ? ORANGE : BLUE, 7, GAME_WIDTH - 30);
    });
    this.text(8, 190, 'ARROWS + ENTER · ESC BACK', BLUE, 7);
  }

  private drawPick(): void {
    const lane = CONTENT.lanes[this.lane];
    if (!lane) return;
    this.text(8, 4, `WORKSTREAM ${this.lane + 1}/3 — ${lane.label}`, WHITE, 9);
    this.text(8, 15, lane.sub, BLUE, 6, GAME_WIDTH - 16);

    CONTENT.cards.forEach((card, i) => {
      const selected = i === this.cursor;
      const scopeGlyph = card.scope === 'broad' ? (card.serialized ? '[CORE·GATED]' : '[CORE]') : '[LOCAL]';
      const row = this.text(
        8,
        34 + i * 11,
        `${selected ? '>' : ' '} ${card.name} ${scopeGlyph}`,
        selected ? WHITE : GREEN,
        7,
      );
      row.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.cursor = i;
        this.select();
      });
    });

    const detail = CONTENT.cards[this.cursor];
    if (detail) {
      this.text(178, 34, detail.name, WHITE, 7, 136);
      this.text(178, 46, detail.blurb, ORANGE, 6, 136);
      const scopeLine =
        detail.scope === 'broad'
          ? detail.serialized
            ? 'BROAD SCOPE, SERIALIZED: a human gate walks it through the shared core.'
            : 'BROAD SCOPE: touches the shared core, unescorted.'
          : 'NARROW SCOPE: its own module only.';
      this.text(178, 96, scopeLine, BLUE, 6, 136);
    }

    const summary = this.picks
      .map((p, i) => `${CONTENT.lanes[i]?.label ?? ''}: ${i === this.lane ? '…' : p ? p.name : '—'}`)
      .join('   ');
    this.text(8, 168, summary, BLUE, 6, GAME_WIDTH - 16);
    this.text(8, 190, CONTENT.pickPrompt, ORANGE, 5, GAME_WIDTH - 16);
  }

  // -------------------------------------------------------------------------
  // The run — three concurrent terminal columns
  // -------------------------------------------------------------------------

  private runCrossing(): void {
    const cards = this.picks.filter((p): p is BossCard => p !== null);
    if (cards.length !== 3) return;

    // Clamp against the EXACT balance: when the whole purse is committed
    // and lost, the party genuinely hits zero (death), not a rounding crumb.
    const budget = CONTENT.budgets[this.budgetIdx];
    const available = getState().resources.tokens;
    const committed = Math.min(budget?.tokens ?? 60, available);
    this.resolution = resolveBoss(cards, committed, () => actions.rand());

    this.step = 'running';
    this.clearDrawn();
    this.columnLines = [[], [], []];

    // Static frame: lane headers + column bodies + budget meter.
    this.resolution.lanes.forEach((laneResult, i) => {
      const lane = CONTENT.lanes[i];
      const x = COL_X[i] ?? 4;
      this.text(x, 2, lane?.label ?? '', WHITE, 6);
      this.text(x, 10, laneResult.card.name, BLUE, 6);
      const body = this.text(x, 20, '', GREEN, 6);
      body.setWordWrapWidth(COL_W);
      this.columnTexts[i] = body;
      // Column separators.
      if (i > 0) {
        const g = this.add.rectangle(x - 4, 0, 1, GAME_HEIGHT - 14, 0x1bcb01, 0.35).setOrigin(0, 0);
        this.drawn.push(g);
      }
    });
    this.meterText = this.text(4, GAME_HEIGHT - 9, '', ORANGE, 7);
    this.updateMeter(committed);

    if (this.reducedMotion) {
      // Instant cut: final lines of each column, then the verdict.
      this.resolution.lanes.forEach((laneResult, i) => {
        for (const ev of laneResult.timeline) this.pushLine(i, ev, false);
      });
      this.updateMeter(Math.max(0, committed - this.resolution.totalSpend));
      this.finishRun();
      return;
    }

    // Interleave: one shared ticker advances the three timelines round-robin.
    const cursors = [0, 0, 0];
    let spentSoFar = 0;
    this.playTimer = this.time.addEvent({
      delay: 80,
      loop: true,
      callback: () => {
        const res = this.resolution;
        if (!res) return;
        let advanced = false;
        for (let i = 0; i < 3; i++) {
          const laneResult = res.lanes[i];
          const cursor = cursors[i] ?? 0;
          if (!laneResult || cursor >= laneResult.timeline.length) continue;
          const ev = laneResult.timeline[cursor];
          cursors[i] = cursor + 1;
          if (ev) {
            this.pushLine(i, ev, true);
            spentSoFar += laneResult.spend / Math.max(1, laneResult.timeline.length);
            this.updateMeter(Math.max(0, res.committed - Math.min(spentSoFar, res.totalSpend)));
          }
          advanced = true;
        }
        if (!advanced) {
          this.playTimer?.remove();
          this.playTimer = null;
          this.updateMeter(Math.max(0, res.committed - res.totalSpend));
          this.finishRun();
        }
      },
    });
  }

  private pushLine(col: number, ev: TimelineEvent, animate: boolean): void {
    if (!ev.line) return;
    const glyph = TONE_GLYPH[ev.tone] ?? '';
    const lines = this.columnLines[col];
    if (!lines) return;
    lines.push({ text: `${glyph}${ev.line}`, color: TONE_COLOR[ev.tone] ?? GREEN });
    if (lines.length > COL_LINES) lines.shift();
    const body = this.columnTexts[col];
    if (body) {
      body.setText(lines.map((l) => l.text).join('\n'));
      body.setColor(lines[lines.length - 1]?.color ?? GREEN);
    }
    if (animate && ev.fx === 'spark') this.cameras.main.shake(120, 0.004);
  }

  private updateMeter(remaining: number): void {
    const res = this.resolution;
    if (!this.meterText || !res) return;
    const width = 14;
    const filled = res.committed > 0 ? Math.round((remaining / res.committed) * width) : 0;
    const bar = '█'.repeat(Math.max(0, filled)).padEnd(width, '·');
    this.meterText.setText(`BUDGET [${bar}] ${Math.round(remaining)}/${res.committed}`);
    this.meterText.setColor(remaining <= res.committed * 0.25 ? VIOLET : ORANGE);
  }

  private finishRun(): void {
    const res = this.resolution;
    if (!res) return;

    // Apply consequences to the run BEFORE the card, so death interrupts.
    const record = loadBossRecord();
    record.attempts += 1;
    if (res.won) {
      record.won = true;
      record.bestReward = Math.max(record.bestReward, res.reward);
    }
    saveBossRecord(record);

    if (res.won) {
      actions.setFlag('bossLoopsWon');
      actions.applyResourceDelta(
        { tokens: -res.lost + res.reward, morale: 8, credibility: 6 },
        'The Great Migration is across. All three loops converged under budget.',
      );
    } else {
      actions.applyResourceDelta(
        { tokens: -res.lost, morale: -8 },
        res.budgetExhausted
          ? 'The migration budget is exhausted. The plateau keeps it.'
          : 'The migration failed. The spend is gone; the systems are half-moved.',
      );
    }
    actions.advanceDay(res.days);
    saveRun(getState());

    const dead = getState().resources.tokens <= 0;

    if (!this.reducedMotion) {
      if (res.won) this.cameras.main.flash(300, 27, 203, 1);
      else this.cameras.main.shake(250, 0.008);
    }

    const proceed = (): void => {
      if (dead) {
        actions.markDead(CONTENT.deathCause);
        saveRun(getState());
        this.scene.start('Death', { cause: CONTENT.deathCause });
        return;
      }
      this.step = 'result';
      this.cursor = 0;
      this.redraw();
    };

    // §10: the orchestration card fires after the first resolution,
    // after the joke (the banner) has landed.
    this.time.delayedCall(this.reducedMotion ? 0 : 500, () => {
      this.drawBanner(res);
      this.time.delayedCall(this.reducedMotion ? 0 : 900, () => {
        if (!this.cardFired) {
          this.cardFired = true;
          void showCurriculumCard('orchestration_parallel').then(proceed);
        } else {
          proceed();
        }
      });
    });
  }

  private drawBanner(res: BossResolution): void {
    const banner = res.won ? CONTENT.win.banner : CONTENT.lose.banner;
    const t = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, banner, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: res.won ? GREEN : VIOLET,
        backgroundColor: '#000000',
        padding: { x: 6, y: 4 },
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 40 },
      })
      .setOrigin(0.5, 0.5);
    this.drawn.push(t);
    if (!this.reducedMotion) {
      t.setScale(0.2);
      this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.Out' });
    }
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  private resultOptions(): string[] {
    const res = this.resolution;
    if (res?.won) return ['CONTINUE THE MARCH'];
    return ['RUN THE CROSSING AGAIN', 'WITHDRAW TO THE TRAIL'];
  }

  private drawResult(): void {
    const res = this.resolution;
    if (!res) return;
    const c = res.won ? CONTENT.win : CONTENT.lose;
    this.text(GAME_WIDTH / 2, 6, res.won ? CONTENT.win.banner : CONTENT.lose.banner, res.won ? GREEN : VIOLET, 10).setOrigin(0.5, 0);

    let y = 24;
    if (!res.won && res.budgetExhausted) {
      this.text(8, y, CONTENT.lose.budgetExhausted, ORANGE, 7, GAME_WIDTH - 16);
      y += 16;
    }
    this.text(8, y, c.lines.join('\n'), res.won ? GREEN : ORANGE, 7, GAME_WIDTH - 16);
    y += c.lines.length * 16 + 4;

    // Per-lane verdicts, glyphs not color alone.
    res.lanes.forEach((laneResult, i) => {
      const lane = CONTENT.lanes[i];
      const glyph = laneResult.converged ? '✓' : '×';
      const why = laneResult.converged
        ? CONTENT.run.laneDone
        : laneResult.conflicted
          ? CONTENT.conflict.banner
          : laneResult.outcome.banner;
      this.text(
        8,
        y + i * 10,
        `${glyph} ${lane?.label ?? ''} (${laneResult.card.name}): ${why}`,
        laneResult.converged ? GREEN : VIOLET,
        6,
        GAME_WIDTH - 16,
      );
    });
    y += 34;

    const moneyLine = res.won
      ? CONTENT.win.rewardLine.replaceAll('{reward}', String(res.reward - res.lost))
      : CONTENT.lose.lossLine.replaceAll('{lost}', String(res.lost));
    this.text(8, y, moneyLine, res.won ? WHITE : ORANGE, 8, GAME_WIDTH - 16);

    if (!res.won) this.text(8, y + 12, CONTENT.retry, BLUE, 6, GAME_WIDTH - 16);

    this.resultOptions().forEach((label, i) => {
      const selected = i === this.cursor;
      const row = this.text(12, 168 + i * 12, `${selected ? '>' : ' '} ${label}`, selected ? WHITE : GREEN, 8);
      row.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.cursor = i;
        this.select();
      });
    });
  }

  private chooseResultOption(): void {
    const label = this.resultOptions()[this.cursor];
    if (label === 'RUN THE CROSSING AGAIN') {
      this.step = 'budget';
      this.cursor = this.budgetIdx;
      this.picks = [null, null, null];
      this.resolution = null;
      this.redraw();
      return;
    }
    this.scene.start('Trail');
  }
}
