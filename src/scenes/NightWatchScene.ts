/**
 * NightWatchScene — Fort Actions, mile 1180 (§7.6).
 *
 * The player authors a workflow card (markdown with YAML frontmatter,
 * because that is exactly what the real thing looks like), then the party
 * sleeps: THE orchestrated motion moment of the game (§13) — the screen
 * washes to blue, the card glows through the wagon canvas, miles tick.
 * Morning is one of five outcomes resolved by systems/nightWatchSim.ts.
 *
 * Keyboard: Up/Down select a card field, Left/Right cycle its value,
 * Enter posts the card and sleeps, any key skips the night sequence.
 * Reduced motion: straight cut to morning.
 *
 * Curriculum: agentic_workflows_ci (first success),
 * least_privilege_safe_outputs (raid), recursive_triggers (recursion) —
 * each shown after the morning report has landed, once per journal.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TOTAL_MILES } from '../config';
import { coverBackdrop, queueArt } from '../systems/art';
import { setBed } from '../systems/audio';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import {
  BUDGET_LABELS,
  BUDGET_OPTIONS,
  OUTPUT_OPTIONS,
  PERMISSION_OPTIONS,
  TRIGGER_OPTIONS,
  engineLabel,
  hasBudgetCap,
  loadNightWatchRecord,
  resolveNight,
  saveNightWatchRecord,
  type NightResolution,
  type WorkflowCard,
} from '../systems/nightWatchSim';
import { journalEntries, showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import nightContent from '../content/night-watch.json';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

interface OutcomeBase {
  title: string;
  nightLog: string[];
}
interface NightContent {
  intro: string;
  sentryLine: string;
  bodyOptions: { id: string; label: string; body: string }[];
  outcomes: {
    success: OutcomeBase & {
      reports: Record<'comment' | 'open-pr' | 'push-to-main', string>;
      cautionEverything: string;
      unlockLine: string;
    };
    nothing: OutcomeBase & { report: string };
    raid: OutcomeBase & { report: string };
    recursion: OutcomeBase & { reportUncapped: string; reportCapped: string };
    bill: OutcomeBase & { report: string };
  };
}

const CONTENT = nightContent as NightContent;

const PANEL_ID = 'nightwatch';
const STYLE_ID = 'nw-styles';

const PANEL_CSS = `
#panel-${PANEL_ID} {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: auto; z-index: 20;
}
.nw-box {
  width: min(46rem, 94vw); max-height: 92vh; overflow-y: auto;
  background: rgba(0, 0, 0, 0.92); border: 2px solid var(--green);
  padding: 1rem 1.25rem; color: var(--green); font-family: var(--font-mono);
}
.nw-box h1 { font-size: 1rem; margin: 0 0 0.25rem; color: var(--white); }
.nw-intro { font-size: 0.85rem; margin: 0.25rem 0 0.75rem; }
.nw-sentry { font-size: 0.8rem; color: var(--blue); margin: 0 0 0.75rem; }
.nw-file {
  border: 1px solid var(--blue); padding: 0.6rem 0.8rem; font-size: 0.9rem;
  background: rgba(13, 161, 255, 0.06);
}
.nw-filename { color: var(--blue); font-size: 0.75rem; margin-bottom: 0.4rem; }
.nw-fence { color: var(--white); }
.nw-row { display: flex; gap: 0.5rem; align-items: baseline; padding: 1px 0; }
.nw-row .nw-key { min-width: 9.5rem; color: var(--white); }
.nw-row.nw-selected .nw-key { color: var(--orange); }
.nw-row.nw-selected .nw-key::before { content: '> '; }
.nw-val {
  background: none; border: 1px dashed var(--green); color: var(--green);
  font: inherit; padding: 0 0.4rem; cursor: pointer; text-transform: none;
  letter-spacing: normal;
}
.nw-val:hover { background: var(--green); color: var(--black); }
.nw-static { color: var(--green); opacity: 0.9; }
.nw-heading { color: var(--white); margin-top: 0.4rem; }
.nw-body-prose { color: var(--green); opacity: 0.85; font-size: 0.85rem; margin: 0.2rem 0 0; }
.nw-hint { font-size: 0.72rem; color: var(--blue); margin: 0.6rem 0 0.4rem; }
.nw-actions { display: flex; gap: 0.75rem; margin-top: 0.6rem; flex-wrap: wrap; }
.nw-report-title { color: var(--white); letter-spacing: 0.1em; }
.nw-report { font-size: 0.92rem; margin: 0.6rem 0; }
.nw-caution { font-size: 0.85rem; color: var(--orange); margin: 0.6rem 0; }
.nw-unlock { font-size: 0.9rem; color: var(--white); border: 1px solid var(--green);
  padding: 0.5rem 0.6rem; margin: 0.6rem 0; }
.nw-stats { font-size: 0.85rem; color: var(--blue); margin: 0.6rem 0; }
.nw-glyph-ok { color: var(--green); }
.nw-glyph-warn { color: var(--orange); }
.nw-glyph-fail { color: var(--violet); }
`;

type FieldKey = 'trigger' | 'permissions' | 'safeOutput' | 'budget' | 'body';
const FIELD_ORDER: readonly FieldKey[] = ['trigger', 'permissions', 'safeOutput', 'budget', 'body'];

export class NightWatchScene extends Phaser.Scene {
  private card!: WorkflowCard;
  private fieldIndex = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private nightTimers: Phaser.Time.TimerEvent[] = [];
  private resolution: NightResolution | null = null;
  private phase: 'author' | 'night' | 'morning' = 'author';
  private nightsSlept = 0;

  constructor() {
    super('NightWatch');
  }

  preload(): void {
    // Lazy per-scene art: the overnight hero piece (§13's one big moment).
    queueArt(this, { 'night-watch-art': 'night-watch.png' });
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    setBed(null);
    this.ensureStyles();
    this.card = {
      trigger: 'schedule',
      permissions: 'read-only',
      engine: engineLabel(),
      safeOutput: 'comment',
      budget: 'both',
      bodyId: CONTENT.bodyOptions[0]?.id ?? 'review_prs',
    };
    this.fieldIndex = 0;
    this.phase = 'author';
    this.resolution = null;
    this.nightsSlept = 0;

    this.drawFortBackdrop();
    this.showAuthorPanel();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    bus.emit('scene:ready', { scene: 'NightWatch' });
  }

  private cleanup(): void {
    unmountPanel(PANEL_ID);
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.nightTimers.forEach((t) => t.remove(false));
    this.nightTimers = [];
  }

  private ensureStyles(): void {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }

  private reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // -------------------------------------------------------------------------
  // Backdrop (Phaser primitives; sprites arrive in Wave 4)
  // -------------------------------------------------------------------------

  private drawFortBackdrop(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#000000');
    // Ground
    this.add.rectangle(GAME_WIDTH / 2, 184, GAME_WIDTH, 32, 0x0a2a08);
    // Fort wall: chunky posts
    for (let x = 12; x < GAME_WIDTH; x += 16) {
      this.add.rectangle(x, 150, 10, 44, 0x123310);
      this.add.rectangle(x, 126, 10, 8, 0x1bcb01, 0.25);
    }
    // Gate
    this.add.rectangle(GAME_WIDTH / 2, 150, 34, 48, 0x000000);
    this.add.rectangle(GAME_WIDTH / 2, 150, 34, 48).setStrokeStyle(1, 0x1bcb01);
    this.add
      .text(GAME_WIDTH / 2, 8, 'FORT ACTIONS', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);
    this.add
      .text(GAME_WIDTH / 2, 22, 'MILE 1180 — THE WAGONS MOVE AT NIGHT', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#0da1ff',
      })
      .setOrigin(0.5, 0);
  }

  // -------------------------------------------------------------------------
  // Authoring panel — the workflow card as a markdown file
  // -------------------------------------------------------------------------

  private fieldValueLabel(key: FieldKey): string {
    switch (key) {
      case 'trigger':
        return this.card.trigger;
      case 'permissions':
        return this.card.permissions;
      case 'safeOutput':
        return this.card.safeOutput;
      case 'budget':
        return BUDGET_LABELS[this.card.budget];
      case 'body':
        return this.bodyOption().label;
    }
  }

  private bodyOption(): { id: string; label: string; body: string } {
    return (
      CONTENT.bodyOptions.find((b) => b.id === this.card.bodyId) ??
      CONTENT.bodyOptions[0] ?? { id: 'x', label: '(nothing)', body: '' }
    );
  }

  private cycleField(key: FieldKey, dir: 1 | -1): void {
    const cycle = <T>(options: readonly T[], value: T): T => {
      const i = options.indexOf(value);
      return options[(i + dir + options.length) % options.length] as T;
    };
    switch (key) {
      case 'trigger':
        this.card.trigger = cycle(TRIGGER_OPTIONS, this.card.trigger);
        break;
      case 'permissions':
        this.card.permissions = cycle(PERMISSION_OPTIONS, this.card.permissions);
        break;
      case 'safeOutput':
        this.card.safeOutput = cycle(OUTPUT_OPTIONS, this.card.safeOutput);
        break;
      case 'budget':
        this.card.budget = cycle(BUDGET_OPTIONS, this.card.budget);
        break;
      case 'body': {
        const ids = CONTENT.bodyOptions.map((b) => b.id);
        this.card.bodyId = cycle(ids, this.card.bodyId);
        break;
      }
    }
    this.renderAuthorPanel();
  }

  private showAuthorPanel(): void {
    this.phase = 'author';
    this.renderAuthorPanel();
    if (!this.keyHandler) {
      this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
      window.addEventListener('keydown', this.keyHandler);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (document.querySelector('.field-note-backdrop')) return; // curriculum modal owns keys
    if (this.phase === 'night') {
      this.skipNight();
      return;
    }
    if (this.phase !== 'author') return;
    switch (e.key) {
      case 'ArrowUp':
        this.fieldIndex = (this.fieldIndex - 1 + FIELD_ORDER.length) % FIELD_ORDER.length;
        this.renderAuthorPanel();
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.fieldIndex = (this.fieldIndex + 1) % FIELD_ORDER.length;
        this.renderAuthorPanel();
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.cycleField(FIELD_ORDER[this.fieldIndex] as FieldKey, -1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.cycleField(FIELD_ORDER[this.fieldIndex] as FieldKey, 1);
        e.preventDefault();
        break;
      case 'Enter':
        this.postAndSleep();
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  private renderAuthorPanel(): void {
    const panel = mountPanel(PANEL_ID);
    const esc = escapeHtml;
    const row = (key: FieldKey, label: string): string => {
      const selected = FIELD_ORDER[this.fieldIndex] === key;
      return `<div class="nw-row${selected ? ' nw-selected' : ''}" data-field="${key}">
        <span class="nw-key">${esc(label)}</span>
        <button type="button" class="nw-val" data-cycle="${key}">[ ${esc(this.fieldValueLabel(key))} ]</button>
      </div>`;
    };
    const budgetWarn = hasBudgetCap(this.card)
      ? ''
      : ` <span class="nw-glyph-warn">! no cap</span>`;
    panel.innerHTML = `
      <div class="nw-box" role="dialog" aria-label="Night Watch workflow card">
        <h1>NIGHT WATCH</h1>
        <p class="nw-intro">${esc(CONTENT.intro)}</p>
        <p class="nw-sentry">${esc(CONTENT.sentryLine)}</p>
        <div class="nw-file">
          <div class="nw-filename">.github/workflows/night-watch.md</div>
          <div class="nw-fence">---</div>
          ${row('trigger', 'on:')}
          ${row('permissions', 'permissions:')}
          <div class="nw-row"><span class="nw-key">engine:</span>
            <span class="nw-static">${esc(this.card.engine)}</span></div>
          ${row('safeOutput', 'safe-outputs:')}
          ${row('budget', 'budget:').replace('</div>', `${budgetWarn}</div>`)}
          <div class="nw-fence">---</div>
          <div class="nw-heading"># What the agent should do overnight</div>
          ${row('body', 'task:')}
          <p class="nw-body-prose">${esc(this.bodyOption().body)}</p>
        </div>
        <p class="nw-hint">&#8593;&#8595; field · &#8592;&#8594; value · ENTER posts the card</p>
        <div class="nw-actions">
          <button type="button" class="btn" data-action="sleep">POST THE CARD &amp; SLEEP</button>
        </div>
      </div>`;

    panel.querySelectorAll<HTMLButtonElement>('[data-cycle]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        const key = btn.dataset['cycle'] as FieldKey;
        this.fieldIndex = FIELD_ORDER.indexOf(key);
        this.cycleField(key, ev.shiftKey ? -1 : 1);
      });
    });
    panel
      .querySelector<HTMLButtonElement>('[data-action="sleep"]')
      ?.addEventListener('click', () => this.postAndSleep());
  }

  // -------------------------------------------------------------------------
  // The night — the orchestrated motion moment (§13)
  // -------------------------------------------------------------------------

  private postAndSleep(): void {
    if (this.phase !== 'author') return;
    this.resolution = resolveNight(this.card, getState().resources.tokens);
    this.phase = 'night';
    unmountPanel(PANEL_ID);
    this.nightsSlept += 1;

    if (this.reducedMotion()) {
      this.applyAndShowMorning();
      return;
    }
    this.runNightSequence();
  }

  private nightLogLines(): string[] {
    const res = this.resolution;
    if (!res) return [];
    return CONTENT.outcomes[res.kind].nightLog;
  }

  private runNightSequence(): void {
    this.children.removeAll();
    const cam = this.cameras.main;
    cam.setBackgroundColor('#000000');
    setBed('night');

    // The wash to --blue: the night-watch key art (campfire, sleeping
    // party, constellation wagon) under a ledger-blue veil; the existing
    // effects play on top of it.
    if (!coverBackdrop(this, 'night-watch-art', GAME_WIDTH, GAME_HEIGHT, 0.9)) {
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x03101f);
    }
    const veil = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0da1ff, 0)
      .setDepth(1);
    this.tweens.add({ targets: veil, fillAlpha: 0.14, duration: 1800, ease: 'Sine.easeInOut' });

    const hasArt = this.textures.exists('night-watch-art');

    // Stars: white pixels, gentle twinkle (over the art's sky too).
    for (let i = 0; i < 42; i++) {
      const star = this.add
        .rectangle(6 + Math.random() * (GAME_WIDTH - 12), 4 + Math.random() * 60, 1, 1, 0xffffff)
        .setDepth(2);
      this.tweens.add({
        targets: star,
        alpha: 0.2 + Math.random() * 0.5,
        duration: 700 + Math.random() * 1400,
        yoyo: true,
        repeat: -1,
      });
    }

    // Ground + sleeping party — primitives only when the art is absent
    // (the key art brings its own bedrolls and campfire).
    if (!hasArt) {
      this.add.rectangle(GAME_WIDTH / 2, 186, GAME_WIDTH, 28, 0x041426).setDepth(2);
      for (let i = 0; i < 4; i++) {
        this.add.rectangle(38 + i * 22, 172, 16, 6, 0x0a2440).setDepth(3);
      }
    }
    const zzz = this.add
      .text(hasArt ? 46 : 66, hasArt ? 160 : 152, 'z Z z', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#0da1ff',
      })
      .setDepth(3)
      .setAlpha(0);
    this.tweens.add({ targets: zzz, alpha: 1, y: '-=6', duration: 1600, yoyo: true, repeat: -1 });

    // The wagon, rolling slowly right, the workflow card glowing through
    // the canvas.
    const wagon = this.add.container(210, 160).setDepth(4);
    const bed = this.add.rectangle(0, 8, 56, 14, 0x0a1c30).setStrokeStyle(1, 0x0da1ff);
    const canvasTop = this.add.rectangle(0, -6, 50, 18, 0x11304f).setStrokeStyle(1, 0x0da1ff);
    const wheelA = this.add.rectangle(-18, 18, 8, 8, 0x03101f).setStrokeStyle(1, 0x0da1ff);
    const wheelB = this.add.rectangle(18, 18, 8, 8, 0x03101f).setStrokeStyle(1, 0x0da1ff);
    const glowCard = this.add.rectangle(0, -6, 14, 10, 0x1bcb01, 0.9);
    wagon.add([bed, canvasTop, wheelA, wheelB, glowCard]);
    try {
      glowCard.postFX?.addGlow(0x1bcb01, 4, 0, false, 0.1, 12);
    } catch {
      /* Canvas renderer: the alpha pulse below still reads as glow. */
    }
    this.tweens.add({ targets: glowCard, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: wagon, x: 268, duration: 7000, ease: 'Sine.easeInOut' });
    this.tweens.add({
      targets: [wheelA, wheelB],
      angle: 360,
      duration: 2400,
      repeat: -1,
      ease: 'Linear',
    });

    // Miles ticking. Cosmetic — the real delta is applied at morning. The
    // counter shows distance covered, not direction; morning handles the
    // direction, which is the joke for the raid.
    const res = this.resolution;
    const distance = Math.abs(res?.miles ?? 0);
    const milesText = this.add
      .text(GAME_WIDTH / 2, 30, 'THE PARTY SLEEPS', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    if (distance > 0) {
      const counter = { n: 0 };
      this.tweens.add({
        targets: counter,
        n: distance,
        duration: 6200,
        delay: 800,
        ease: 'Sine.easeIn',
        onUpdate: () => milesText.setText(`THE PARTY SLEEPS — ${Math.floor(counter.n)} MILES`),
      });
    }

    // The workflow log, writing itself.
    const lines = this.nightLogLines();
    lines.forEach((line, i) => {
      this.nightTimers.push(
        this.time.delayedCall(900 + i * 850, () => {
          this.add
            .text(6, 44 + i * 10, line, {
              fontFamily: 'monospace',
              fontSize: '7px',
              color: '#1bcb01',
              backgroundColor: 'rgba(0,0,0,0.55)',
            })
            .setDepth(5)
            .setAlpha(0.95);
        }),
      );
    });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 8, 'ANY KEY: SKIP TO MORNING', {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: '#0da1ff',
      })
      .setOrigin(0.5, 1)
      .setDepth(5);

    this.input.once('pointerdown', () => this.skipNight());

    // Dawn.
    this.nightTimers.push(
      this.time.delayedCall(900 + lines.length * 850 + 1600, () => this.dawn()),
    );
  }

  private skipNight(): void {
    if (this.phase !== 'night') return;
    this.nightTimers.forEach((t) => t.remove(false));
    this.nightTimers = [];
    this.tweens.killAll();
    this.applyAndShowMorning();
  }

  private dawn(): void {
    if (this.phase !== 'night') return;
    this.cameras.main.flash(500, 255, 255, 255);
    this.nightTimers.push(this.time.delayedCall(500, () => this.applyAndShowMorning()));
  }

  // -------------------------------------------------------------------------
  // Morning — apply the resolution, report, curriculum
  // -------------------------------------------------------------------------

  private applyAndShowMorning(): void {
    const res = this.resolution;
    if (!res || this.phase === 'morning') return;
    this.phase = 'morning';
    setBed(null);
    this.nightTimers.forEach((t) => t.remove(false));
    this.nightTimers = [];
    this.tweens.killAll();

    // One night passes, whatever else happened.
    actions.advanceDay(1);
    if (res.miles !== 0) actions.travelMiles(res.miles, TOTAL_MILES);
    actions.applyResourceDelta({ ...res.delta });
    if (res.unlocksOvernight) actions.setFlag('overnightTravel');
    if (res.kind === 'bill') actions.setFlag('nightwatch_uncapped_bill');
    if (res.kind === 'raid') actions.setFlag('nightwatch_raided');
    if (res.kind === 'recursion') actions.setFlag('nightwatch_recursed');

    const prior = loadNightWatchRecord();
    saveNightWatchRecord({
      v: 1,
      unlocked: res.unlocksOvernight || Boolean(prior?.unlocked && getState().flags['overnightTravel']),
      budget: this.card.budget,
      lastOutcome: res.kind,
      uncappedSpend: (prior?.uncappedSpend ?? 0) + (hasBudgetCap(this.card) ? 0 : res.spend),
      card: { ...this.card },
    });
    saveRun(getState());

    this.drawMorningBackdrop(res);
    this.renderMorningPanel(res);
    void this.fireCurriculum(res);
  }

  private drawMorningBackdrop(res: NightResolution): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor(res.kind === 'raid' ? '#160a1c' : '#0a1206');
    this.add.rectangle(GAME_WIDTH / 2, 186, GAME_WIDTH, 28, 0x0a2a08);
    this.add
      .text(GAME_WIDTH / 2, 8, 'DAWN AT FORT ACTIONS', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);
  }

  private renderMorningPanel(res: NightResolution): void {
    const out = CONTENT.outcomes;
    let report: string;
    let glyph: string;
    let glyphClass: string;
    switch (res.kind) {
      case 'success':
        report = out.success.reports[res.reportVariant];
        glyph = '✓';
        glyphClass = 'nw-glyph-ok';
        break;
      case 'nothing':
        report = out.nothing.report;
        glyph = '!';
        glyphClass = 'nw-glyph-warn';
        break;
      case 'bill':
        report = out.bill.report;
        glyph = '!';
        glyphClass = 'nw-glyph-warn';
        break;
      case 'raid':
        report = out.raid.report;
        glyph = '×';
        glyphClass = 'nw-glyph-fail';
        break;
      case 'recursion':
        report = res.capped ? out.recursion.reportCapped : out.recursion.reportUncapped;
        glyph = res.capped ? '!' : '×';
        glyphClass = res.capped ? 'nw-glyph-warn' : 'nw-glyph-fail';
        break;
    }

    const s = getState();
    const fmt = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
    const statBits: string[] = [];
    if (res.miles !== 0) statBits.push(`MILES ${fmt(res.miles)}`);
    statBits.push(`TOKENS ${fmt(res.delta.tokens)}`);
    if (res.delta.credibility !== 0) statBits.push(`CREDIBILITY ${fmt(res.delta.credibility)}`);
    if (res.delta.morale !== 0) statBits.push(`MORALE ${fmt(res.delta.morale)}`);
    if (res.delta.trust !== 0) statBits.push(`TRUST ${fmt(res.delta.trust)}`);
    if (res.delta.greenBuilds !== 0) statBits.push(`GREEN BUILDS ${fmt(res.delta.greenBuilds)}`);
    statBits.push(`DAY ${s.day} · MILE ${Math.floor(s.mile)}`);

    const esc = escapeHtml;
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = `
      <div class="nw-box" role="dialog" aria-label="Morning report">
        <h1 class="nw-report-title"><span class="${glyphClass}">${glyph}</span> ${esc(
          CONTENT.outcomes[res.kind].title,
        )}</h1>
        <p class="nw-report">${esc(report)}</p>
        ${res.cautionEverything ? `<p class="nw-caution">! ${esc(out.success.cautionEverything)}</p>` : ''}
        ${res.unlocksOvernight ? `<div class="nw-unlock">✓ ${esc(out.success.unlockLine)}</div>` : ''}
        <p class="nw-stats">${esc(statBits.join(' · '))}</p>
        <div class="nw-actions">
          <button type="button" class="btn" data-action="revise">REVISE THE CARD — SLEEP AGAIN</button>
          <button type="button" class="btn" data-action="leave">BREAK CAMP — REJOIN THE TRAIL</button>
        </div>
      </div>`;

    panel
      .querySelector<HTMLButtonElement>('[data-action="revise"]')
      ?.addEventListener('click', () => {
        this.drawFortBackdrop();
        this.showAuthorPanel();
      });
    const leaveBtn = panel.querySelector<HTMLButtonElement>('[data-action="leave"]');
    leaveBtn?.addEventListener('click', () => {
      this.scene.start('Trail');
    });
    leaveBtn?.focus();
  }

  private async fireCurriculum(res: NightResolution): Promise<void> {
    const seen = journalEntries();
    if (res.kind === 'success' && !seen.includes('agentic_workflows_ci')) {
      await showCurriculumCard('agentic_workflows_ci');
    } else if (res.kind === 'raid' && !seen.includes('least_privilege_safe_outputs')) {
      await showCurriculumCard('least_privilege_safe_outputs');
    } else if (res.kind === 'recursion' && !seen.includes('recursive_triggers')) {
      await showCurriculumCard('recursive_triggers');
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
