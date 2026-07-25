/**
 * PermissionsPassScene — Permissions Pass, mile 1520 (§6 row 10).
 *
 * A short gauntlet: five rapid permission requests from your own agents,
 * each answered GRANT / SCOPE DOWN / DENY with an immediate consequence.
 * Two or more over-grants end in the incident; two or more over-denies
 * end in the trust-zero crawl preview (4 mi/day); otherwise a clean pass.
 * A palate cleanser — ~90 seconds.
 *
 * Curriculum: least_privilege_safe_outputs at the end, only if the Night
 * Watch raid hasn't already collected it (journal check).
 *
 * Keyboard: 1/2/3 choose, Enter continues.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, TOTAL_MILES } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { journalEntries, showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import passContent from '../content/permissions-pass.json';

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

interface Choice {
  id: string;
  kind: 'grant' | 'scope' | 'deny';
  counts: 'over_grant' | 'over_deny' | 'sound';
  label: string;
  outcome: string;
  effects: Effects;
}

interface Scenario {
  id: string;
  title: string;
  body: string;
  choices: Choice[];
}

interface Finale {
  title: string;
  body: string;
  effects: Effects;
  days: number;
  miles?: number;
}

interface PassContent {
  intro: string;
  scenarios: Scenario[];
  finales: { incident: Finale; crawl: Finale; clean: Finale };
}

const CONTENT = passContent as PassContent;

const PANEL_ID = 'permissionspass';
const STYLE_ID = 'pp-styles';

const PANEL_CSS = `
#panel-${PANEL_ID} {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: auto; z-index: 20;
}
.pp-box {
  width: min(44rem, 94vw); max-height: 92vh; overflow-y: auto;
  background: rgba(0, 0, 0, 0.92); border: 2px solid var(--green);
  padding: 1rem 1.25rem; color: var(--green); font-family: var(--font-mono);
}
.pp-box h1 { font-size: 0.95rem; margin: 0 0 0.2rem; color: var(--white); }
.pp-progress { font-size: 0.75rem; color: var(--blue); margin: 0 0 0.6rem; }
.pp-body { font-size: 0.9rem; margin: 0.4rem 0 0.8rem; }
.pp-choices { display: flex; flex-direction: column; gap: 0.5rem; }
.pp-choices .btn { text-align: left; }
.pp-outcome { font-size: 0.9rem; margin: 0.5rem 0; }
.pp-outcome.pp-over { color: var(--orange); }
.pp-effects { font-size: 0.8rem; color: var(--blue); margin: 0.4rem 0 0.8rem; }
.pp-finale-title { color: var(--white); letter-spacing: 0.1em; }
.pp-actions { display: flex; justify-content: flex-end; margin-top: 0.6rem; }
`;

export class PermissionsPassScene extends Phaser.Scene {
  private index = 0;
  private overGrants = 0;
  private overDenies = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super('PermissionsPass');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.ensureStyles();
    this.index = 0;
    this.overGrants = 0;
    this.overDenies = 0;

    this.drawBackdrop();
    this.renderScenario();

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
    bus.emit('scene:ready', { scene: 'PermissionsPass' });
  }

  private ensureStyles(): void {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }

  private drawBackdrop(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#000000');
    // A file of gates receding up the pass.
    for (let i = 0; i < 5; i++) {
      const scale = 1 - i * 0.16;
      const y = 165 - i * 24;
      const w = 90 * scale;
      this.add.rectangle(GAME_WIDTH / 2 - w / 2, y, 6 * scale, 34 * scale, 0x123310);
      this.add.rectangle(GAME_WIDTH / 2 + w / 2, y, 6 * scale, 34 * scale, 0x123310);
      this.add.rectangle(GAME_WIDTH / 2, y - 17 * scale, w + 6 * scale, 4 * scale, 0x1bcb01, 0.5);
    }
    this.add
      .text(GAME_WIDTH / 2, 8, 'PERMISSIONS PASS', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);
    this.add
      .text(GAME_WIDTH / 2, 22, 'MILE 1520 — WHAT IS THE LEAST YOU COULD CARRY?', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#0da1ff',
      })
      .setOrigin(0.5, 0);
  }

  private renderScenario(): void {
    const scenario = CONTENT.scenarios[this.index];
    if (!scenario) {
      void this.renderFinale();
      return;
    }
    const esc = escapeHtml;
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = `
      <div class="pp-box" role="dialog" aria-label="${esc(scenario.title)}">
        <h1>${esc(scenario.title)}</h1>
        <p class="pp-progress">GATE ${this.index + 1} OF ${CONTENT.scenarios.length}${
          this.index === 0 ? ` — ${esc(CONTENT.intro)}` : ''
        }</p>
        <p class="pp-body">${esc(scenario.body)}</p>
        <div class="pp-choices">
          ${scenario.choices
            .map(
              (c, i) =>
                `<button type="button" class="btn" data-choice="${esc(c.id)}">${i + 1}. ${esc(c.label)}</button>`,
            )
            .join('')}
        </div>
      </div>`;
    const buttons = panel.querySelectorAll<HTMLButtonElement>('[data-choice]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = scenario.choices.find((c) => c.id === btn.dataset['choice']);
        if (choice) this.choose(scenario, choice);
      });
    });
    buttons[0]?.focus();
  }

  private choose(scenario: Scenario, choice: Choice): void {
    if (choice.counts === 'over_grant') this.overGrants += 1;
    if (choice.counts === 'over_deny') this.overDenies += 1;
    actions.applyResourceDelta({ ...choice.effects });
    saveRun(getState());

    const esc = escapeHtml;
    const glyph = choice.counts === 'sound' ? '✓' : '!';
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = `
      <div class="pp-box" role="dialog" aria-label="Consequence">
        <h1>${esc(scenario.title)}</h1>
        <p class="pp-progress">GATE ${this.index + 1} OF ${CONTENT.scenarios.length} — ${esc(choice.label)}</p>
        <p class="pp-outcome${choice.counts === 'sound' ? '' : ' pp-over'}">${glyph} ${esc(choice.outcome)}</p>
        <p class="pp-effects">${esc(formatEffects(choice.effects))}</p>
        <div class="pp-actions">
          <button type="button" class="btn" data-action="next">NEXT GATE</button>
        </div>
      </div>`;
    const next = panel.querySelector<HTMLButtonElement>('[data-action="next"]');
    next?.addEventListener('click', () => {
      this.index += 1;
      this.renderScenario();
    });
    next?.focus();
  }

  private async renderFinale(): Promise<void> {
    const finale =
      this.overGrants >= 2
        ? CONTENT.finales.incident
        : this.overDenies >= 2
          ? CONTENT.finales.crawl
          : CONTENT.finales.clean;

    if (finale.days > 0) actions.advanceDay(finale.days);
    if (finale.miles && finale.miles > 0) actions.travelMiles(finale.miles, TOTAL_MILES);
    actions.applyResourceDelta({ ...finale.effects });
    if (finale === CONTENT.finales.incident) actions.setFlag('permissions_incident');
    saveRun(getState());

    const esc = escapeHtml;
    const glyph = finale === CONTENT.finales.clean ? '✓' : '×';
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = `
      <div class="pp-box" role="dialog" aria-label="${esc(finale.title)}">
        <h1 class="pp-finale-title">${glyph} ${esc(finale.title)}</h1>
        <p class="pp-body">${esc(finale.body)}</p>
        <p class="pp-effects">${esc(formatEffects(finale.effects))}${
          finale.miles ? esc(` · MILES +${finale.miles} (that is the whole day)`) : ''
        }</p>
        <div class="pp-actions">
          <button type="button" class="btn" data-action="leave">REJOIN THE TRAIL</button>
        </div>
      </div>`;
    const leave = panel.querySelector<HTMLButtonElement>('[data-action="leave"]');
    leave?.addEventListener('click', () => this.scene.start('Trail'));
    leave?.focus();

    if (!journalEntries().includes('least_privilege_safe_outputs')) {
      await showCurriculumCard('least_privilege_safe_outputs');
      leave?.focus();
    }
  }
}

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
