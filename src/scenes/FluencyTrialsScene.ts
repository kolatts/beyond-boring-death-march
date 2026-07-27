/**
 * FluencyTrialsScene — The Fluency Trials, mile 1600.
 *
 * Four quick stations, one per D of AI fluency (Delegation, Description,
 * Discernment, Diligence — Anthropic's 4-Ds framework; the curriculum
 * card carries the link). ~30 seconds each, keyboard/tap choice lists:
 *
 *  I   DELEGATION  — three trail tasks, each HAND IT OVER / KEEP IT /
 *                    SPLIT IT. One is perfect agent work, one needs a
 *                    human's stakeholder call, one is best split.
 *  II  DESCRIPTION — pick the brief for the ford survey (the 4,000-word
 *                    persona-with-threat, the one-liner, or intent +
 *                    context + constraints + done). The chosen brief's
 *                    agent behavior plays out in three log lines.
 *  III DISCERNMENT — three finished outputs: one sound, one confidently
 *                    wrong (contradicts the posted constraint), one
 *                    right-but-rotten (correct answer, 217-step process).
 *                    Label all three; the confident one is the trap.
 *  IV  DILIGENCE   — before the day's work ships: checks + disclosure +
 *                    diff review (right), ship it (fast; flag
 *                    `fluency_shipped_unchecked` for later), or Boring's
 *                    triple re-verification (safe, costs a day).
 *
 * Station scores post as a 0-3 rubric with small resource effects, and
 * persist to localStorage `bbdm:fluency` {v, delegation, description,
 * discernment, diligence} for the endgame's 4-Ds report card. The
 * curriculum card `four_ds_fluency` fires after the rubric posts.
 *
 * All prose lives in src/content/fluency-trials.json. Keyboard: 1/2/3
 * choose, Enter activates the focused button. Reduced motion: ambient
 * tent animation and flourishes are skipped.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import { failPuff, prefersReducedMotion, winBurst } from '../ui/transitions';
import rawContent from '../content/fluency-trials.json';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

interface Effects {
  tokens?: number;
  context?: number;
  trust?: number;
  greenBuilds?: number;
  morale?: number;
  credibility?: number;
}

type HandKeepSplit = 'hand' | 'keep' | 'split';
type TruthId = 'sound' | 'wrong' | 'rotten';

interface Remarks {
  strong: string;
  developing: string;
  weak: string;
}

interface DelegationTask {
  id: string;
  name: string;
  body: string;
  correct: HandKeepSplit;
  options: { id: HandKeepSplit; label: string; outcome: string; effects: Effects }[];
}

interface Brief {
  id: string;
  label: string;
  preview: string;
  score: number;
  logLines: string[];
  outcome: string;
  effects: Effects;
}

interface Exhibit {
  id: string;
  name: string;
  body: string;
  truth: TruthId;
  reveal: { matched: string; missed: string };
}

interface DiligenceOption {
  id: string;
  label: string;
  score: number;
  outcome: string;
  effects: Effects;
  setFlag?: string;
  days?: number;
}

interface TrialsContent {
  intro: { title: string; sub: string; body: string; note: string; beginLabel: string };
  stations: {
    delegation: { title: string; examiner: string; tasks: DelegationTask[]; result: { remarks: Remarks } };
    description: {
      title: string;
      examiner: string;
      task: string;
      chooseLabel: string;
      logIntro: string;
      briefs: Brief[];
      result: { remarks: Remarks };
    };
    discernment: {
      title: string;
      examiner: string;
      constraint: string;
      labels: { id: TruthId; glyph: string; label: string }[];
      exhibits: Exhibit[];
      result: { remarks: Remarks };
    };
    diligence: { title: string; examiner: string; options: DiligenceOption[]; result: { remarks: Remarks } };
  };
  rubric: { title: string; intro: string; rows: Record<StationId, string>; totals: Remarks; closeLabel: string };
}

const CONTENT = rawContent as unknown as TrialsContent;

// ---------------------------------------------------------------------------
// The bbdm:fluency store (read by the endgame 4-Ds report card)
// ---------------------------------------------------------------------------

export type StationId = 'delegation' | 'description' | 'discernment' | 'diligence';

export interface FluencyStore {
  v: 1;
  delegation: number;
  description: number;
  discernment: number;
  diligence: number;
}

const FLUENCY_KEY = 'bbdm:fluency';

export function loadFluencyStore(): FluencyStore | null {
  try {
    const raw = window.localStorage.getItem(FLUENCY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<FluencyStore>;
    if (data?.v !== 1) return null;
    const num = (x: unknown): number =>
      typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(3, x)) : 0;
    return {
      v: 1,
      delegation: num(data.delegation),
      description: num(data.description),
      discernment: num(data.discernment),
      diligence: num(data.diligence),
    };
  } catch {
    return null;
  }
}

function saveFluencyStore(store: FluencyStore): void {
  try {
    window.localStorage.setItem(FLUENCY_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked: the rubric still displayed, which is the lesson */
  }
}

// ---------------------------------------------------------------------------
// Panel styling
// ---------------------------------------------------------------------------

const PANEL_ID = 'fluencytrials';
const STYLE_ID = 'ft-styles';

const PANEL_CSS = `
#panel-${PANEL_ID} {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: auto; z-index: 20;
}
.ft-box {
  width: min(46rem, 94vw); max-height: 92vh; overflow-y: auto;
  background: rgba(0, 0, 0, 0.92); border: 2px solid var(--green);
  padding: 1rem 1.25rem; color: var(--green); font-family: var(--font-mono);
}
.ft-box h1 { font-size: 0.95rem; margin: 0 0 0.2rem; color: var(--white); letter-spacing: 0.08em; }
.ft-progress { font-size: 0.75rem; color: var(--blue); margin: 0 0 0.6rem; }
.ft-examiner { font-size: 0.85rem; color: var(--blue); margin: 0.4rem 0 0.8rem; }
.ft-body { font-size: 0.9rem; margin: 0.4rem 0 0.8rem; }
.ft-constraint { font-size: 0.85rem; color: var(--orange); border: 1px dashed var(--orange);
  padding: 0.4rem 0.6rem; margin: 0.4rem 0 0.8rem; }
.ft-choices { display: flex; flex-direction: column; gap: 0.5rem; }
.ft-choices .btn { text-align: left; }
.ft-preview { font-size: 0.8rem; color: var(--blue); margin: 0.15rem 0 0.5rem 0.25rem; }
.ft-outcome { font-size: 0.9rem; margin: 0.5rem 0; }
.ft-outcome.ft-miss { color: var(--orange); }
.ft-log { font-size: 0.85rem; color: var(--green); background: rgba(13,161,255,0.08);
  border-left: 3px solid var(--blue); padding: 0.4rem 0.6rem; margin: 0.5rem 0;
  white-space: pre-wrap; }
.ft-effects { font-size: 0.8rem; color: var(--blue); margin: 0.4rem 0 0.8rem; }
.ft-rubric-row { font-size: 0.9rem; margin: 0.25rem 0; }
.ft-rubric-row .ft-glyph-ok { color: var(--green); }
.ft-rubric-row .ft-glyph-warn { color: var(--orange); }
.ft-rubric-row .ft-glyph-fail { color: var(--violet); }
.ft-remark { font-size: 0.85rem; color: var(--blue); margin: 0.5rem 0 0.8rem; }
.ft-actions { display: flex; justify-content: flex-end; margin-top: 0.6rem; }
`;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const STATION_ORDER: readonly StationId[] = ['delegation', 'description', 'discernment', 'diligence'];

export class FluencyTrialsScene extends Phaser.Scene {
  private scores: Record<StationId, number> = {
    delegation: 0,
    description: 0,
    discernment: 0,
    diligence: 0,
  };

  /** Delegation progress. */
  private taskIndex = 0;
  /** Discernment progress. */
  private exhibitIndex = 0;
  private exhibitLabels: Partial<Record<string, TruthId>> = {};

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private reduced = false;

  constructor() {
    super('FluencyTrials');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.reduced = prefersReducedMotion();
    this.scores = { delegation: 0, description: 0, discernment: 0, diligence: 0 };
    this.taskIndex = 0;
    this.exhibitIndex = 0;
    this.exhibitLabels = {};

    this.ensureStyles();
    this.drawBackdrop();
    this.renderIntro();

    // 1/2/3 press the nth visible choice button (touch taps them directly).
    this.keyHandler = (e: KeyboardEvent) => {
      if (document.querySelector('.field-note-backdrop')) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          `#panel-${PANEL_ID} [data-choice]`,
        );
        buttons[Number(e.key) - 1]?.click();
      }
    };
    window.addEventListener('keydown', this.keyHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unmountPanel(PANEL_ID);
      if (this.keyHandler) {
        window.removeEventListener('keydown', this.keyHandler);
        this.keyHandler = null;
      }
    });
    bus.emit('scene:ready', { scene: 'FluencyTrials' });
  }

  private ensureStyles(): void {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }

  // -------------------------------------------------------------------------
  // Backdrop — the examination tent (ambient motion, reduced-motion aware)
  // -------------------------------------------------------------------------

  private drawBackdrop(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#000000');

    // Tent silhouette: canvas roofline + poles.
    const cx = GAME_WIDTH / 2;
    this.add.triangle(cx, 96, 0, 60, 130, 0, 260, 60, 0x0d1a08).setOrigin(0.5, 0.5);
    this.add.rectangle(cx, 140, 236, 76, 0x081204);
    this.add.rectangle(cx - 118, 140, 4, 76, 0x123310);
    this.add.rectangle(cx + 118, 140, 4, 76, 0x123310);

    // Four examiners' tables, one per D.
    const letters = ['D1', 'D2', 'D3', 'D4'];
    for (let i = 0; i < 4; i++) {
      const x = cx - 90 + i * 60;
      this.add.rectangle(x, 158, 44, 16, 0x123310).setStrokeStyle(1, 0x1bcb01, 0.5);
      this.add
        .text(x, 152, letters[i] ?? '', { fontFamily: 'monospace', fontSize: '7px', color: '#1bcb01' })
        .setOrigin(0.5, 0);
      // A polite candle per table; flame flickers unless reduced motion.
      const flame = this.add.rectangle(x + 16, 146, 3, 5, 0xf55d08, 0.9);
      if (!this.reduced) {
        this.tweens.add({
          targets: flame,
          alpha: { from: 0.9, to: 0.45 },
          scaleY: { from: 1, to: 0.7 },
          duration: 320 + i * 90,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // The ironed banner. Sways gently unless reduced motion.
    const banner = this.add.container(cx, 34);
    const cloth = this.add.rectangle(0, 0, 190, 24, 0x081204).setStrokeStyle(1, 0xf55d08, 0.8);
    const title = this.add
      .text(0, 0, 'THE FLUENCY TRIALS', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    banner.add([cloth, title]);
    if (!this.reduced) {
      this.tweens.add({
        targets: banner,
        angle: { from: -1.2, to: 1.2 },
        duration: 2600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.add
      .text(cx, 50, 'MILE 1600 — FOUR EXAMINERS, NO WAITING', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#0da1ff',
      })
      .setOrigin(0.5, 0);

    this.add
      .text(cx, GAME_HEIGHT - 10, '1/2/3 CHOOSE · ENTER CONFIRMS', {
        fontFamily: 'monospace',
        fontSize: '6px',
        color: '#0da1ff',
      })
      .setOrigin(0.5, 0);
  }

  // -------------------------------------------------------------------------
  // Shared panel helpers
  // -------------------------------------------------------------------------

  private panelHtml(html: string): HTMLElement {
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = html;
    return panel;
  }

  private progressLine(station: StationId, extra = ''): string {
    const n = STATION_ORDER.indexOf(station) + 1;
    return `TRIAL ${n} OF 4${extra ? ` — ${escapeHtml(extra)}` : ''}`;
  }

  private applyEffects(effects: Effects): void {
    actions.applyResourceDelta({ ...effects });
    saveRun(getState());
  }

  // -------------------------------------------------------------------------
  // Intro
  // -------------------------------------------------------------------------

  private renderIntro(): void {
    const c = CONTENT.intro;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${escapeHtml(c.title)}">
        <h1>${escapeHtml(c.title)}</h1>
        <p class="ft-progress">${escapeHtml(c.sub)}</p>
        <p class="ft-body">${escapeHtml(c.body)}</p>
        <p class="ft-examiner">${escapeHtml(c.note)}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="begin">${escapeHtml(c.beginLabel)}</button>
        </div>
      </div>`);
    const begin = panel.querySelector<HTMLButtonElement>('[data-action="begin"]');
    begin?.addEventListener('click', () => this.renderDelegationTask());
    begin?.focus();
  }

  // -------------------------------------------------------------------------
  // Trial I — Delegation
  // -------------------------------------------------------------------------

  private renderDelegationTask(): void {
    const st = CONTENT.stations.delegation;
    const task = st.tasks[this.taskIndex];
    if (!task) {
      this.renderStationResult('delegation', () => this.renderDescription());
      return;
    }
    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${esc(st.title)}">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('delegation', `TASK ${this.taskIndex + 1} OF ${st.tasks.length}`)}</p>
        ${this.taskIndex === 0 ? `<p class="ft-examiner">${esc(st.examiner)}</p>` : ''}
        <p class="ft-body"><strong>${esc(task.name)}.</strong> ${esc(task.body)}</p>
        <div class="ft-choices">
          ${task.options
            .map((o, i) => `<button type="button" class="btn" data-choice="${esc(o.id)}">${i + 1}. ${esc(o.label)}</button>`)
            .join('')}
        </div>
      </div>`);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[data-choice]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const option = task.options.find((o) => o.id === btn.dataset['choice']);
        if (option) this.chooseDelegation(task, option.id);
      });
    });
    buttons[0]?.focus();
  }

  private chooseDelegation(task: DelegationTask, id: HandKeepSplit): void {
    const st = CONTENT.stations.delegation;
    const option = task.options.find((o) => o.id === id);
    if (!option) return;
    const correct = id === task.correct;
    if (correct) this.scores.delegation += 1;
    this.applyEffects(option.effects);
    if (!correct && !this.reduced) failPuff(this, GAME_WIDTH / 2, 60);

    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="Rubric note">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('delegation', `${esc(task.name)} — ${esc(option.label)}`)}</p>
        <p class="ft-outcome${correct ? '' : ' ft-miss'}">${correct ? '✓' : '!'} ${esc(option.outcome)}</p>
        <p class="ft-effects">${esc(formatEffects(option.effects))}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="next">${
            this.taskIndex + 1 < st.tasks.length ? 'NEXT TASK' : 'HEAR THE SCORE'
          }</button>
        </div>
      </div>`);
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    next?.addEventListener('click', () => {
      this.taskIndex += 1;
      this.renderDelegationTask();
    });
    next?.focus();
  }

  // -------------------------------------------------------------------------
  // Trial II — Description
  // -------------------------------------------------------------------------

  private renderDescription(): void {
    const st = CONTENT.stations.description;
    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${esc(st.title)}">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('description')}</p>
        <p class="ft-examiner">${esc(st.examiner)}</p>
        <p class="ft-body">${esc(st.task)}</p>
        <div class="ft-choices">
          ${st.briefs
            .map(
              (b, i) => `
            <div>
              <button type="button" class="btn" data-choice="${esc(b.id)}">${i + 1}. ${esc(b.label)}</button>
              <p class="ft-preview">${esc(b.preview)}</p>
            </div>`,
            )
            .join('')}
        </div>
      </div>`);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[data-choice]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const brief = st.briefs.find((b) => b.id === btn.dataset['choice']);
        if (brief) this.chooseBrief(brief);
      });
    });
    buttons[0]?.focus();
  }

  private chooseBrief(brief: Brief): void {
    const st = CONTENT.stations.description;
    this.scores.description = brief.score;
    this.applyEffects(brief.effects);
    if (brief.score >= 3) winBurst(this, GAME_WIDTH / 2, 60, 18);
    else failPuff(this, GAME_WIDTH / 2, 60);

    const esc = escapeHtml;
    const good = brief.score >= 3;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="Agent run">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('description', brief.label)}</p>
        <p class="ft-examiner">${esc(st.logIntro)}</p>
        <div class="ft-log" data-log aria-live="polite"></div>
        <p class="ft-outcome${good ? '' : ' ft-miss'}" data-verdict hidden>${good ? '✓' : '!'} ${esc(brief.outcome)}</p>
        <p class="ft-effects" data-verdict hidden>${esc(formatEffects(brief.effects))}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="next" hidden>HEAR THE SCORE</button>
        </div>
      </div>`);

    const log = panel.querySelector<HTMLElement>('[data-log]');
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    const reveal = (): void => {
      panel.querySelectorAll<HTMLElement>('[data-verdict]').forEach((el) => (el.hidden = false));
      if (next) {
        next.hidden = false;
        next.focus();
      }
    };
    next?.addEventListener('click', () =>
      this.renderStationResult('description', () => this.renderExhibit()),
    );

    // The three log lines type themselves out (instant under reduced motion).
    if (this.reduced || !log) {
      if (log) log.textContent = brief.logLines.join('\n');
      reveal();
    } else {
      brief.logLines.forEach((_line, i) => {
        this.time.delayedCall(400 + i * 650, () => {
          log.textContent = brief.logLines.slice(0, i + 1).join('\n');
          if (i === brief.logLines.length - 1) reveal();
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Trial III — Discernment
  // -------------------------------------------------------------------------

  private renderExhibit(): void {
    const st = CONTENT.stations.discernment;
    const exhibit = st.exhibits[this.exhibitIndex];
    if (!exhibit) {
      this.renderDiscernmentReveal();
      return;
    }
    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${esc(st.title)}">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('discernment', `EXHIBIT ${this.exhibitIndex + 1} OF ${st.exhibits.length}`)}</p>
        ${this.exhibitIndex === 0 ? `<p class="ft-examiner">${esc(st.examiner)}</p>` : ''}
        <p class="ft-constraint">${esc(st.constraint)}</p>
        <p class="ft-body"><strong>${esc(exhibit.name)}.</strong> ${esc(exhibit.body)}</p>
        <div class="ft-choices">
          ${st.labels
            .map(
              (l, i) =>
                `<button type="button" class="btn" data-choice="${esc(l.id)}">${i + 1}. ${esc(l.glyph)} ${esc(l.label)}</button>`,
            )
            .join('')}
        </div>
      </div>`);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[data-choice]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['choice'] as TruthId | undefined;
        if (!id) return;
        this.exhibitLabels[exhibit.id] = id;
        this.exhibitIndex += 1;
        this.renderExhibit();
      });
    });
    buttons[0]?.focus();
  }

  private renderDiscernmentReveal(): void {
    const st = CONTENT.stations.discernment;
    let matched = 0;
    const rows = st.exhibits.map((ex) => {
      const chosen = this.exhibitLabels[ex.id];
      const hit = chosen === ex.truth;
      if (hit) matched += 1;
      const chosenLabel = st.labels.find((l) => l.id === chosen)?.label ?? '—';
      return { ex, hit, chosenLabel };
    });
    this.scores.discernment = matched;
    // The trap costs extra when it lands: shipping the confidently-wrong one.
    const trap = st.exhibits.find((e) => e.truth === 'wrong');
    const trapMissed = trap ? this.exhibitLabels[trap.id] !== 'wrong' : false;
    this.applyEffects(
      trapMissed ? { credibility: -4, tokens: -3 } : { credibility: matched >= 3 ? 3 : 1 },
    );
    if (matched >= 3) winBurst(this, GAME_WIDTH / 2, 60, 18);
    else if (matched === 0) failPuff(this, GAME_WIDTH / 2, 60);

    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="Exhibits revealed">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('discernment', `${matched} OF ${st.exhibits.length} LABELED TRUE`)}</p>
        ${rows
          .map(
            (r) => `
          <p class="ft-outcome${r.hit ? '' : ' ft-miss'}"><strong>${r.hit ? '✓' : '×'} ${esc(r.ex.name)}</strong> — you said ${esc(r.chosenLabel)}.<br>${esc(
            r.hit ? r.ex.reveal.matched : r.ex.reveal.missed,
          )}</p>`,
          )
          .join('')}
        <p class="ft-effects">${esc(formatEffects(trapMissed ? { credibility: -4, tokens: -3 } : { credibility: matched >= 3 ? 3 : 1 }))}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="next">HEAR THE SCORE</button>
        </div>
      </div>`);
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    next?.addEventListener('click', () =>
      this.renderStationResult('discernment', () => this.renderDiligence()),
    );
    next?.focus();
  }

  // -------------------------------------------------------------------------
  // Trial IV — Diligence
  // -------------------------------------------------------------------------

  private renderDiligence(): void {
    const st = CONTENT.stations.diligence;
    const esc = escapeHtml;
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${esc(st.title)}">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('diligence')}</p>
        <p class="ft-examiner">${esc(st.examiner)}</p>
        <div class="ft-choices">
          ${st.options
            .map((o, i) => `<button type="button" class="btn" data-choice="${esc(o.id)}">${i + 1}. ${esc(o.label)}</button>`)
            .join('')}
        </div>
      </div>`);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[data-choice]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const option = st.options.find((o) => o.id === btn.dataset['choice']);
        if (option) this.chooseDiligence(option);
      });
    });
    buttons[0]?.focus();
  }

  private chooseDiligence(option: DiligenceOption): void {
    const st = CONTENT.stations.diligence;
    this.scores.diligence = option.score;
    if (option.days && option.days > 0) actions.advanceDay(option.days);
    if (option.setFlag) actions.setFlag(option.setFlag);
    this.applyEffects(option.effects);
    if (option.score >= 3) winBurst(this, GAME_WIDTH / 2, 60, 18);
    else if (option.score === 0) failPuff(this, GAME_WIDTH / 2, 60);

    const esc = escapeHtml;
    const glyph = option.score >= 3 ? '✓' : option.score > 0 ? '!' : '×';
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="Consequence">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">${this.progressLine('diligence', option.label)}</p>
        <p class="ft-outcome${option.score >= 3 ? '' : ' ft-miss'}">${glyph} ${esc(option.outcome)}</p>
        <p class="ft-effects">${esc(formatEffects(option.effects))}${
          option.days ? esc(` · ${option.days} DAY${option.days === 1 ? '' : 'S'} GONE`) : ''
        }</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="next">HEAR THE SCORE</button>
        </div>
      </div>`);
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    next?.addEventListener('click', () => this.renderStationResult('diligence', () => void this.renderRubric()));
    next?.focus();
  }

  // -------------------------------------------------------------------------
  // Station result interstitial + the final rubric
  // -------------------------------------------------------------------------

  private remarkFor(remarks: Remarks, score: number, max: number, strongAt = 0.99): string {
    const frac = score / max;
    if (frac >= strongAt) return remarks.strong;
    if (frac >= 0.34) return remarks.developing;
    return remarks.weak;
  }

  private renderStationResult(station: StationId, onNext: () => void): void {
    const st = CONTENT.stations[station];
    const score = this.scores[station];
    const remark = this.remarkFor(st.result.remarks, score, 3);
    if (score >= 3) winBurst(this, GAME_WIDTH / 2, 50);

    const esc = escapeHtml;
    const glyph = score >= 3 ? '✓' : score > 0 ? '!' : '×';
    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="Rubric posted">
        <h1>${esc(st.title)}</h1>
        <p class="ft-progress">RUBRIC POSTED — ${esc(station.toUpperCase())}: ${score} OF 3 ${esc(glyph)}</p>
        <p class="ft-remark">${esc(remark)}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="next">${
            station === 'diligence' ? 'FACE THE FULL RUBRIC' : 'NEXT TRIAL'
          }</button>
        </div>
      </div>`);
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    next?.addEventListener('click', onNext);
    next?.focus();
  }

  private async renderRubric(): Promise<void> {
    const r = CONTENT.rubric;
    const total = STATION_ORDER.reduce((sum, id) => sum + this.scores[id], 0);

    // Persist for the endgame's 4-Ds report card.
    saveFluencyStore({ v: 1, ...this.scores });
    actions.setFlag('fluencyTrialsTaken');
    saveRun(getState());

    if (total >= 10) winBurst(this, GAME_WIDTH / 2, 40);

    const esc = escapeHtml;
    const rowHtml = STATION_ORDER.map((id) => {
      const score = this.scores[id];
      const glyph = score >= 3 ? '✓' : score > 0 ? '!' : '×';
      const cls = score >= 3 ? 'ft-glyph-ok' : score > 0 ? 'ft-glyph-warn' : 'ft-glyph-fail';
      return `<p class="ft-rubric-row"><span class="${cls}">${glyph}</span> ${esc(r.rows[id])} ${'■'.repeat(score)}${'□'.repeat(3 - score)} ${score}/3</p>`;
    }).join('');
    // A 10/12 march is a fluent march; only the stations demand perfection.
    const totalRemark = this.remarkFor(r.totals, total, 12, 0.8);

    const panel = this.panelHtml(`
      <div class="ft-box" role="dialog" aria-label="${esc(r.title)}">
        <h1>${esc(r.title)} — ${total}/12</h1>
        <p class="ft-body">${esc(r.intro)}</p>
        ${rowHtml}
        <p class="ft-remark">${esc(totalRemark)}</p>
        <div class="ft-actions">
          <button type="button" class="btn" data-action="leave">${esc(r.closeLabel)}</button>
        </div>
      </div>`);
    const leave = panel.querySelector<HTMLButtonElement>('[data-action="leave"]');
    leave?.addEventListener('click', () => this.scene.start('Trail'));

    // The lesson lands after the rubric posts, never before. Unknown-id
    // no-op until the four_ds_fluency card merges from the content wave.
    await showCurriculumCard('four_ds_fluency');
    leave?.focus();
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatEffects(effects: Effects): string {
  const bits: string[] = [];
  const label: Record<keyof Effects, string> = {
    tokens: 'TOKENS',
    context: 'CONTEXT',
    trust: 'TRUST',
    greenBuilds: 'GREEN BUILDS',
    morale: 'MORALE',
    credibility: 'CREDIBILITY',
  };
  for (const key of Object.keys(label) as (keyof Effects)[]) {
    const v = effects[key];
    if (typeof v === 'number' && v !== 0) bits.push(`${label[key]} ${v > 0 ? `+${v}` : v}`);
  }
  return bits.length > 0 ? bits.join(' · ') : 'NO RESOURCE CHANGE';
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
