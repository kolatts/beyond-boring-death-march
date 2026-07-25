/**
 * OutfittingScene — spec §7.1. One scene class, two mechanics:
 *
 *  - `outfitting` (Legacy Junction, mile 0): draft ONE model card and ONE
 *    harness card, watch a simulated 20-mile shakedown as a self-typing
 *    terminal log, see the effective combined stat line, then Field Note
 *    `model_vs_harness`.
 *  - `harness_swap` (Harness Hollow, mile 1010): keep the model, swap only
 *    the harness, see the before/after delta on your own loadout, then
 *    Field Note `harness_variance`. (Deep-linked with no saved loadout it
 *    falls back to the full draft.)
 *
 * Role rules (§5.2): the Contractor cannot purchase — only free cards are
 * selectable (scavenge). The VP pays a markup but can buy anything. Staff
 * pays list price.
 *
 * UI is a DOM overlay panel (like the Curriculum Card): the card blurbs
 * are long-form prose and need real text layout + native keyboard focus.
 * All flavor prose lives in src/content/outfitting.json; only functional
 * labels live here. Juice (hover/select glow, phosphor typing cursor,
 * particle burst on the stat reveal) degrades to instant/static under
 * prefers-reduced-motion.
 */

import Phaser from 'phaser';
import type { RoleId } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import {
  HARNESSES,
  MODELS,
  OUTFIT,
  canonicalLedger,
  deriveStats,
  fill,
  harnessById,
  modelById,
  priceFor,
  runShakedown,
  saveLoadout,
  loadLoadout,
  type DerivedStats,
  type HarnessCard,
  type LogLine,
  type ModelCard,
} from '../systems/outfittingSim';

const PANEL_ID = 'outfitting';
const STYLE_ID = 'outfitting-styles';

interface CardView {
  id: string;
  name: string;
  blurb: string;
  statsLine: string;
  meters: { label: string; value: number }[];
  extra: string;
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function modelView(m: ModelCard): CardView {
  return {
    id: m.id,
    name: m.name,
    blurb: m.blurb,
    statsLine: `REAS ${m.reasoning} · SPD ${m.speed} · ADH ${m.adherence} · ${m.costPerMile} TK/MI`,
    meters: [
      { label: 'REASONING', value: m.reasoning },
      { label: 'SPEED', value: m.speed },
      { label: 'ADHERENCE', value: m.adherence },
    ],
    extra: `COST/MILE: ${m.costPerMile} TK`,
  };
}

function harnessView(h: HarnessCard): CardView {
  return {
    id: h.id,
    name: h.name,
    blurb: h.blurb,
    statsLine: `TOOL ${h.toolBreadth} · CTX ${h.contextMgmt} · REC ${h.recovery} · GRD ${h.guardrails} · DET ${h.determinism}`,
    meters: [
      { label: 'TOOL BREADTH', value: h.toolBreadth },
      { label: 'CONTEXT MGMT', value: h.contextMgmt },
      { label: 'RECOVERY', value: h.recovery },
      { label: 'GUARDRAILS', value: h.guardrails },
      { label: 'DETERMINISM', value: h.determinism },
    ],
    extra: '',
  };
}

interface PickOptions<T> {
  kind: 'model' | 'harness';
  cards: readonly T[];
  title: string;
  intro: string;
  stepLabel: string;
  view: (card: T) => CardView;
  /** Shown as a chip when the model is already chosen (step 2 / swap). */
  keptModel: ModelCard | null;
  /** Harness Hollow: id of the currently fitted harness (not re-buyable). */
  currentId: string | null;
  /** Harness Hollow: offer a "keep current" exit that resolves null. */
  allowKeep: boolean;
}

export class OutfittingScene extends Phaser.Scene {
  private mechanic = 'outfitting';
  private panel: HTMLElement | null = null;
  private reduced = false;
  private typingTimer: number | null = null;

  constructor() {
    super('Outfitting');
  }

  init(data: { landmarkId?: string; mechanic?: string }): void {
    this.mechanic = data.mechanic ?? 'outfitting';
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    injectStyles();
    this.panel = mountPanel(PANEL_ID);
    this.panel.className = 'outfit-root';

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.typingTimer !== null) window.clearInterval(this.typingTimer);
      this.typingTimer = null;
      unmountPanel(PANEL_ID);
      this.panel = null;
    });

    const lo = loadLoadout();
    const keptModel = lo ? modelById(lo.modelId) : undefined;
    const currentHarness = lo ? harnessById(lo.harnessId) : undefined;
    if (this.mechanic === 'harness_swap' && lo && keptModel && currentHarness) {
      void this.runSwap(keptModel, currentHarness);
    } else {
      void this.runDraft();
    }

    bus.emit('scene:ready', { scene: 'Outfitting' });
  }

  // -------------------------------------------------------------------------
  // Flows
  // -------------------------------------------------------------------------

  private async runDraft(): Promise<void> {
    const model = await this.pickCard<ModelCard>({
      kind: 'model',
      cards: MODELS,
      title: 'THE OUTFITTING STORE',
      intro: OUTFIT.intro.outfitting,
      stepLabel: 'STEP 1/2 — CHOOSE A MODEL',
      view: modelView,
      keptModel: null,
      currentId: null,
      allowKeep: false,
    });
    if (!model) return; // unreachable in draft (no keep option); type safety
    const harness = await this.pickCard<HarnessCard>({
      kind: 'harness',
      cards: HARNESSES,
      title: 'THE OUTFITTING STORE',
      intro: OUTFIT.intro.outfitting,
      stepLabel: 'STEP 2/2 — CHOOSE A HARNESS',
      view: harnessView,
      keptModel: model,
      currentId: null,
      allowKeep: false,
    });
    if (!harness) return;
    await this.shakedownReveal(model, harness);
    this.scene.start('Trail');
  }

  private async runSwap(model: ModelCard, current: HarnessCard): Promise<void> {
    const next = await this.pickCard<HarnessCard>({
      kind: 'harness',
      cards: HARNESSES,
      title: 'HARNESS HOLLOW',
      intro: OUTFIT.intro.harness_swap,
      stepLabel: 'SWAP THE HARNESS — THE MODEL STAYS',
      view: harnessView,
      keptModel: model,
      currentId: current.id,
      allowKeep: true,
    });
    if (!next) {
      this.scene.start('Trail');
      return;
    }
    await this.swapReveal(model, current, next);
    this.scene.start('Trail');
  }

  // -------------------------------------------------------------------------
  // Card draft stage
  // -------------------------------------------------------------------------

  private pickCard<T extends ModelCard | HarnessCard>(opts: PickOptions<T>): Promise<T | null> {
    return new Promise((resolve) => {
      const panel = this.panel;
      if (!panel) return;
      const state = getState();
      const role: RoleId = state.role;

      panel.innerHTML = `
        <div class="oc-frame" role="region" aria-label="${esc(opts.title)}">
          <h1 class="oc-title">${esc(opts.title)}</h1>
          <p class="oc-flavor">${esc(opts.intro)}</p>
          <p class="oc-role">${esc(OUTFIT.roleFlavor[role])}</p>
          <div class="oc-step">
            <span>${esc(opts.stepLabel)}</span>
            <span>TOKENS: ${Math.round(state.resources.tokens)}</span>
          </div>
          ${
            opts.keptModel
              ? `<span class="oc-chip">✓ ENGINE: ${esc(opts.keptModel.name.toUpperCase())}</span>`
              : ''
          }
          <div class="oc-grid" role="listbox" aria-label="${esc(opts.stepLabel)}"></div>
          <div class="oc-detail" aria-live="polite">Select a card to inspect it.</div>
          <div class="oc-actions"></div>
        </div>`;

      const grid = panel.querySelector<HTMLElement>('.oc-grid');
      const detail = panel.querySelector<HTMLElement>('.oc-detail');
      const actionsEl = panel.querySelector<HTMLElement>('.oc-actions');
      if (!grid || !detail || !actionsEl) return;

      let selected: T | null = null;

      const renderDetail = (): void => {
        actionsEl.innerHTML = '';
        if (!selected) {
          detail.textContent = 'Select a card to inspect it.';
          if (opts.allowKeep) addKeepButton();
          return;
        }
        const card = selected;
        const v = opts.view(card);
        const { price, selectable } = priceFor(opts.kind, card.id, role);
        const tokens = Math.round(getState().resources.tokens);
        const isCurrent = opts.currentId === card.id;
        const affordable = tokens >= price;

        detail.innerHTML = `
          <div class="oc-dname">${esc(v.name.toUpperCase())}
            <span class="oc-dprice">${price > 0 ? `${price} TK` : 'FREE'}</span></div>
          ${v.meters
            .map(
              (mt) => `<div class="oc-mrow"><span class="oc-mlabel">${esc(mt.label)}</span>
                <span class="oc-meter"><span class="oc-meter-fill" style="width:${mt.value * 10}%"></span></span>
                <span>${mt.value}/10</span></div>`,
            )
            .join('')}
          ${v.extra ? `<div class="oc-mrow"><span class="oc-mlabel">${esc(v.extra)}</span></div>` : ''}
          <p class="oc-blurb">${esc(v.blurb)}</p>`;

        const btn = document.createElement('button');
        btn.className = 'oc-confirm';
        if (isCurrent) {
          btn.textContent = 'ALREADY FITTED';
          btn.disabled = true;
        } else if (!selectable) {
          btn.textContent = `× ${OUTFIT.lockedReason}`;
          btn.disabled = true;
        } else if (!affordable) {
          btn.textContent = `× INSUFFICIENT TOKENS (${tokens}/${price})`;
          btn.disabled = true;
        } else if (opts.allowKeep) {
          btn.textContent =
            price > 0
              ? `SWAP TO ${v.name.toUpperCase()} — ${price} TK`
              : `SWAP TO ${v.name.toUpperCase()} — FREE`;
        } else if (price > 0) {
          btn.textContent = `PURCHASE ${v.name.toUpperCase()} — ${price} TK`;
        } else {
          btn.textContent =
            role === 'contractor'
              ? `SCAVENGE ${v.name.toUpperCase()}`
              : `TAKE ${v.name.toUpperCase()} — FREE`;
        }
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          if (price > 0) {
            actions.applyResourceDelta(
              { tokens: -price },
              fill(OUTFIT.notices.purchase, { name: v.name, price }),
            );
          } else {
            actions.log(fill(OUTFIT.notices.scavenge, { name: v.name }));
          }
          saveRun(getState());
          resolve(card);
        });
        actionsEl.appendChild(btn);
        if (opts.allowKeep) addKeepButton();
      };

      const addKeepButton = (): void => {
        const keep = document.createElement('button');
        keep.className = 'oc-keep';
        keep.textContent = 'KEEP CURRENT HARNESS';
        keep.addEventListener('click', () => {
          actions.log(OUTFIT.swap.keep);
          saveRun(getState());
          resolve(null);
        });
        actionsEl.appendChild(keep);
      };

      const buttons: HTMLButtonElement[] = [];
      for (const card of opts.cards) {
        const v = opts.view(card);
        const { price, selectable } = priceFor(opts.kind, card.id, role);
        const isCurrent = opts.currentId === card.id;
        const btn = document.createElement('button');
        btn.className = `oc-card${selectable ? '' : ' locked'}`;
        btn.setAttribute('role', 'option');
        btn.innerHTML = `
          <span class="oc-name">${esc(v.name.toUpperCase())}</span>
          <span class="oc-cstats">${esc(v.statsLine)}</span>
          <span class="oc-cprice">${
            isCurrent
              ? '✓ CURRENT'
              : selectable
                ? price > 0
                  ? `${price} TK`
                  : 'FREE'
                : `× ${price} TK`
          }</span>`;
        btn.addEventListener('click', () => {
          selected = card;
          buttons.forEach((b) => b.classList.remove('sel'));
          btn.classList.add('sel');
          renderDetail();
        });
        grid.appendChild(btn);
        buttons.push(btn);
      }

      // Arrow-key navigation across the card grid (3 columns).
      grid.addEventListener('keydown', (e: KeyboardEvent) => {
        const idx = buttons.findIndex((b) => b === document.activeElement);
        if (idx < 0) return;
        const cols = 3;
        let next = -1;
        if (e.key === 'ArrowRight') next = idx + 1;
        else if (e.key === 'ArrowLeft') next = idx - 1;
        else if (e.key === 'ArrowDown') next = idx + cols;
        else if (e.key === 'ArrowUp') next = idx - cols;
        if (next >= 0 && next < buttons.length) {
          e.preventDefault();
          buttons[next]?.focus();
        }
      });

      renderDetail();
      buttons[0]?.focus();
    });
  }

  // -------------------------------------------------------------------------
  // Shakedown reveal (draft)
  // -------------------------------------------------------------------------

  private async shakedownReveal(model: ModelCard, harness: HarnessCard): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    panel.innerHTML = `
      <div class="oc-frame">
        <h1 class="oc-title">SHAKEDOWN RUN</h1>
        <div class="oc-log" aria-live="polite"></div>
        <div class="oc-after"></div>
      </div>`;
    const log = panel.querySelector<HTMLElement>('.oc-log');
    const after = panel.querySelector<HTMLElement>('.oc-after');
    if (!log || !after) return;

    const result = runShakedown(model, harness, () => actions.rand());
    await this.typeLines(log, result.lines);

    // Persist the loadout before anything can interrupt.
    const derived = deriveStats(model, harness);
    saveLoadout({ modelId: model.id, harnessId: harness.id, derived });
    actions.setFlag(`model:${model.id}`);
    actions.setFlag(`harness:${harness.id}`);
    saveRun(getState());

    // The combined stat line, with the burst.
    const stat = document.createElement('div');
    stat.className = 'oc-stat';
    stat.innerHTML = this.statBlockHtml(model, harness, derived);
    if (!this.reduced) stat.classList.add('oc-reveal');
    after.appendChild(stat);
    this.burst(stat);

    // The ledger: the canonical comparison, whatever the player picked.
    const ledger = document.createElement('div');
    ledger.className = 'oc-log oc-ledger';
    after.appendChild(ledger);
    await this.typeLines(ledger, canonicalLedger());

    await showCurriculumCard('model_vs_harness');
    await this.continueButton(after);
  }

  private statBlockHtml(model: ModelCard, harness: HarnessCard, d: DerivedStats): string {
    const meter = (v: number): string =>
      `<span class="oc-meter"><span class="oc-meter-fill" style="width:${Math.min(100, v * 10)}%"></span></span>`;
    const row = (label: string, v: number, text?: string): string =>
      `<div class="oc-mrow"><span class="oc-mlabel">${label}</span>${meter(v)}<span>${text ?? `${v}/10`}</span></div>`;
    return `
      <div class="oc-stat-title">EFFECTIVE STAT LINE — ${esc(model.name.toUpperCase())} + ${esc(harness.name.toUpperCase())}</div>
      ${row('OUTPUT', d.output)}
      ${row('SPEED', d.speed)}
      ${row('ADHERENCE', d.adherence)}
      ${row('COST/MILE', Math.min(10, d.costPerMile * (10 / 15)), `${d.costPerMile} TK`)}
      ${row('DETERMINISM', d.determinism)}`;
  }

  // -------------------------------------------------------------------------
  // Swap reveal (Harness Hollow)
  // -------------------------------------------------------------------------

  private async swapReveal(
    model: ModelCard,
    oldHarness: HarnessCard,
    newHarness: HarnessCard,
  ): Promise<void> {
    const panel = this.panel;
    if (!panel) return;

    const before = deriveStats(model, oldHarness);
    const derived = deriveStats(model, newHarness);

    actions.log(fill(OUTFIT.notices.swap, { old: oldHarness.name, new: newHarness.name }));
    saveLoadout({
      modelId: model.id,
      harnessId: newHarness.id,
      derived,
      swappedFromHarnessId: oldHarness.id,
    });
    actions.setFlag(`harness:${newHarness.id}`);
    actions.setFlag('harnessSwapped');
    saveRun(getState());

    panel.innerHTML = `
      <div class="oc-frame">
        <h1 class="oc-title">HARNESS HOLLOW</h1>
        <div class="oc-log" aria-live="polite"></div>
        <div class="oc-after"></div>
      </div>`;
    const log = panel.querySelector<HTMLElement>('.oc-log');
    const after = panel.querySelector<HTMLElement>('.oc-after');
    if (!log || !after) return;

    await this.typeLines(log, [
      { text: `engine ....... ${model.name} (kept)`, tone: 'head' },
      { text: `harness ...... ${oldHarness.name} -> ${newHarness.name}`, tone: 'head' },
      { text: OUTFIT.swap.head, tone: 'plain' },
    ]);

    const stat = document.createElement('div');
    stat.className = 'oc-stat';
    stat.innerHTML = this.deltaBlockHtml(before, derived);
    if (!this.reduced) stat.classList.add('oc-reveal');
    after.appendChild(stat);
    this.burst(stat);

    await showCurriculumCard('harness_variance');
    await this.continueButton(after);
  }

  private deltaBlockHtml(before: DerivedStats, after: DerivedStats): string {
    const rows: { label: string; b: number; a: number; higherIsBetter: boolean; unit: string }[] = [
      { label: 'OUTPUT', b: before.output, a: after.output, higherIsBetter: true, unit: '/10' },
      { label: 'SPEED', b: before.speed, a: after.speed, higherIsBetter: true, unit: '/10' },
      { label: 'ADHERENCE', b: before.adherence, a: after.adherence, higherIsBetter: true, unit: '/10' },
      { label: 'COST/MILE', b: before.costPerMile, a: after.costPerMile, higherIsBetter: false, unit: ' TK' },
      { label: 'DETERMINISM', b: before.determinism, a: after.determinism, higherIsBetter: true, unit: '/10' },
    ];
    const body = rows
      .map((r) => {
        const delta = Math.round((r.a - r.b) * 10) / 10;
        const glyph = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
        const good = delta === 0 ? 'same' : (delta > 0) === r.higherIsBetter ? 'good' : 'bad';
        const sign = delta > 0 ? '+' : '';
        return `<div class="oc-drow oc-d${good}">
          <span class="oc-mlabel">${r.label}</span>
          <span>${r.b}${r.unit}</span><span>→</span><span>${r.a}${r.unit}</span>
          <span>${glyph} ${sign}${delta}</span></div>`;
      })
      .join('');
    return `<div class="oc-stat-title">YOUR RUN — BEFORE / AFTER</div>${body}`;
  }

  // -------------------------------------------------------------------------
  // Terminal typing, burst, continue
  // -------------------------------------------------------------------------

  /** Type lines into `host` with a phosphor cursor. Enter/Space/click skips.
   * Reduced motion: everything appears instantly. */
  private typeLines(host: HTMLElement, lines: LogLine[]): Promise<void> {
    const makeLine = (tone: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = `oc-line oc-${tone}`;
      const text = document.createElement('span');
      el.appendChild(text);
      host.appendChild(el);
      return text as HTMLElement;
    };
    if (this.reduced || lines.length === 0) {
      for (const l of lines) makeLine(l.tone).textContent = l.text;
      host.scrollTop = host.scrollHeight;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const cursor = document.createElement('span');
      cursor.className = 'oc-cursor';
      let li = 0;
      let ci = 0;
      let textEl = makeLine(lines[0]?.tone ?? 'plain');
      textEl.parentElement?.appendChild(cursor);

      const finish = (): void => {
        if (this.typingTimer !== null) window.clearInterval(this.typingTimer);
        this.typingTimer = null;
        window.removeEventListener('keydown', onKey, true);
        host.removeEventListener('pointerdown', finishAllNow);
        cursor.remove();
        resolve();
      };
      const finishAllNow = (): void => {
        const line = lines[li];
        if (line) {
          textEl.textContent = line.text;
          li++;
        }
        for (; li < lines.length; li++) {
          const l = lines[li];
          if (l) makeLine(l.tone).textContent = l.text;
        }
        host.scrollTop = host.scrollHeight;
        finish();
      };
      const onKey = (e: KeyboardEvent): void => {
        // Never steal keys while the shared Field Note modal is open.
        if (document.querySelector('.field-note-backdrop')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          finishAllNow();
        }
      };
      window.addEventListener('keydown', onKey, true);
      host.addEventListener('pointerdown', finishAllNow);

      this.typingTimer = window.setInterval(() => {
        for (let step = 0; step < 2; step++) {
          const line = lines[li];
          if (!line) {
            finish();
            return;
          }
          if (ci < line.text.length) {
            ci++;
            textEl.textContent = line.text.slice(0, ci);
          } else {
            li++;
            ci = 0;
            const nextLine = lines[li];
            if (!nextLine) {
              finish();
              return;
            }
            textEl = makeLine(nextLine.tone);
            textEl.parentElement?.appendChild(cursor);
          }
        }
        host.scrollTop = host.scrollHeight;
      }, 16);
    });
  }

  /** Small particle burst centered on `target`. Skipped under reduced motion. */
  private burst(target: HTMLElement): void {
    if (this.reduced) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + Math.min(rect.height / 2, 60);
    const colors = ['#1bcb01', '#ffffff', '#0da1ff', '#f55d08'];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'oc-spark';
      s.style.left = `${cx}px`;
      s.style.top = `${cy}px`;
      s.style.background = colors[i % colors.length] ?? '#1bcb01';
      document.body.appendChild(s);
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 40 + Math.random() * 90;
      const anim = s.animate(
        [
          { transform: 'translate(-50%,-50%)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${
              Math.sin(ang) * dist - 24
            }px)) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: 600 + Math.random() * 300, easing: 'cubic-bezier(0.1,0.8,0.3,1)' },
      );
      anim.onfinish = () => s.remove();
    }
  }

  private continueButton(host: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      const btn = document.createElement('button');
      btn.className = 'oc-confirm';
      btn.textContent = 'TAKE THE TRAIL';
      // Guard: the Enter that dismisses the Field Note must not also
      // activate this button the instant it receives focus.
      const armedAt = performance.now();
      btn.addEventListener('click', () => {
        if (performance.now() - armedAt < 300) return;
        resolve();
      });
      host.appendChild(btn);
      btn.focus();
      btn.scrollIntoView({ block: 'nearest' });
    });
  }
}

// ---------------------------------------------------------------------------
// Styles (scoped to this scene's panel; injected once)
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.outfit-root { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; background: radial-gradient(ellipse at center, #041104 0%, #000 78%);
  font-family: var(--font-mono, monospace); }
.oc-frame { width: min(920px, 96vw); max-height: 94vh; overflow-y: auto;
  border: 2px solid var(--green); padding: 1rem 1.4rem;
  background: linear-gradient(rgba(27,203,1,0.05) 50%, transparent 50%) 0 0 / 100% 4px, #010401;
  color: var(--green);
  box-shadow: 0 0 26px rgba(27,203,1,0.3), inset 0 0 70px rgba(27,203,1,0.05); }
.oc-title { font-size: 1.1rem; margin: 0 0 0.35rem; letter-spacing: 0.16em; }
.oc-flavor { margin: 0.15rem 0; font-size: 0.85rem; line-height: 1.45; }
.oc-role { margin: 0.15rem 0 0.4rem; font-size: 0.8rem; line-height: 1.45;
  color: rgba(255,255,255,0.85); }
.oc-step { display: flex; justify-content: space-between; color: var(--white);
  font-size: 0.78rem; letter-spacing: 0.1em; margin: 0.5rem 0 0.3rem; }
.oc-chip { display: inline-block; border: 1px solid var(--blue); color: var(--blue);
  padding: 0.1rem 0.5rem; font-size: 0.75rem; margin: 0.1rem 0 0.3rem; }
.oc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;
  margin: 0.4rem 0 0.7rem; }
@media (max-width: 700px) { .oc-grid { grid-template-columns: repeat(2, 1fr); } }
.oc-card { text-align: left; padding: 0.5rem 0.6rem; width: 100%;
  border: 1px solid rgba(27,203,1,0.45); background: #000; color: var(--green);
  font-size: 0.8rem; letter-spacing: 0.02em; cursor: pointer;
  transition: box-shadow 120ms, border-color 120ms, transform 120ms; }
.oc-card:hover { background: #000; color: var(--green); border-color: var(--green);
  box-shadow: 0 0 12px rgba(27,203,1,0.8); transform: translateY(-1px); }
.oc-card.sel { border-color: var(--white);
  box-shadow: 0 0 8px rgba(255,255,255,0.7), 0 0 20px rgba(27,203,1,0.6); }
.oc-card.locked { border-style: dashed; border-color: var(--violet); }
.oc-card.locked:hover { border-color: var(--violet); box-shadow: 0 0 10px rgba(187,54,255,0.6); }
.oc-name { display: block; color: var(--white); font-size: 0.82rem; letter-spacing: 0.06em; }
.oc-card.locked .oc-name { color: var(--violet); }
.oc-cstats { display: block; font-size: 0.68rem; opacity: 0.85; margin-top: 0.2rem; }
.oc-cprice { display: block; font-size: 0.72rem; color: var(--white); margin-top: 0.25rem; }
.oc-card.locked .oc-cprice { color: var(--violet); }
.oc-detail { border: 1px solid rgba(27,203,1,0.4); padding: 0.6rem 0.8rem;
  min-height: 6.5rem; font-size: 0.85rem; }
.oc-dname { color: var(--white); letter-spacing: 0.08em; margin-bottom: 0.4rem; }
.oc-dprice { float: right; color: var(--white); }
.oc-mrow { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem;
  margin: 0.15rem 0; }
.oc-mlabel { width: 8.5rem; flex: none; }
.oc-meter { display: inline-block; width: 9rem; height: 0.55rem; flex: none;
  border: 1px solid rgba(27,203,1,0.5); }
.oc-meter-fill { display: block; height: 100%; background: var(--green);
  box-shadow: 0 0 8px rgba(27,203,1,0.8); }
.oc-blurb { margin: 0.5rem 0 0; font-size: 0.8rem; line-height: 1.5;
  color: rgba(27,203,1,0.92); }
.oc-actions { display: flex; gap: 0.6rem; margin-top: 0.7rem; flex-wrap: wrap; }
.oc-confirm { font-size: 0.85rem; }
.oc-confirm:disabled { color: var(--violet); border-color: var(--violet);
  background: #000; cursor: not-allowed; }
.oc-keep { font-size: 0.85rem; color: var(--blue); border-color: var(--blue); }
.oc-keep:hover { background: var(--blue); color: #000; }
.oc-log { font-size: 0.85rem; line-height: 1.55; max-height: 44vh; overflow-y: auto;
  white-space: pre-wrap; margin-top: 0.4rem; }
.oc-ledger { margin-top: 0.8rem; max-height: none; }
.oc-line.oc-head { color: var(--white); }
.oc-line.oc-plain { color: var(--green); }
.oc-line.oc-ok { color: var(--green); text-shadow: 0 0 6px rgba(27,203,1,0.6); }
.oc-line.oc-warn { color: var(--orange); }
.oc-line.oc-fail { color: var(--violet); }
.oc-cursor { display: inline-block; width: 0.55em; height: 1em; background: var(--green);
  box-shadow: 0 0 6px var(--green); margin-left: 2px; vertical-align: -0.15em;
  animation: oc-blink 1s steps(2, start) infinite; }
@keyframes oc-blink { to { visibility: hidden; } }
.oc-stat { border: 1px solid var(--white); padding: 0.6rem 0.8rem; margin-top: 0.8rem; }
.oc-stat-title { color: var(--white); font-size: 0.8rem; letter-spacing: 0.08em;
  margin-bottom: 0.4rem; }
.oc-reveal { animation: oc-reveal 500ms ease-out;
  box-shadow: 0 0 14px rgba(255,255,255,0.45), 0 0 28px rgba(27,203,1,0.4); }
@keyframes oc-reveal { from { transform: scale(0.97); filter: brightness(2.2); } }
.oc-drow { display: flex; gap: 0.9rem; font-size: 0.85rem; margin: 0.2rem 0; }
.oc-drow.oc-dgood { color: var(--green); text-shadow: 0 0 6px rgba(27,203,1,0.5); }
.oc-drow.oc-dbad { color: var(--violet); }
.oc-drow.oc-dsame { color: rgba(255,255,255,0.75); }
.oc-spark { position: fixed; width: 5px; height: 5px; z-index: 60; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .oc-cursor { animation: none; }
  .oc-reveal { animation: none; }
  .oc-card { transition: none; }
}
/* Mobile (390px portrait is the bar): fixed-width label+meter columns
   pushed the stat VALUES off the right edge. Let the meter flex and
   shrink the label column so every row fits; thumb-size the buttons. */
@media (max-width: 600px) {
  .oc-frame { padding: 0.7rem 0.75rem; }
  .oc-mrow { gap: 0.35rem; font-size: 0.7rem; }
  .oc-mlabel { width: 5.8rem; }
  .oc-meter { width: auto; flex: 1 1 2.5rem; min-width: 2.5rem; }
  .oc-detail { padding: 0.5rem 0.55rem; }
  .oc-drow { gap: 0.45rem; font-size: 0.78rem; }
  .oc-confirm, .oc-keep { min-height: 44px; }
  .oc-card { min-height: 44px; }
}
`;
  document.head.appendChild(style);
}
