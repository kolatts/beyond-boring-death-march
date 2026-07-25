/**
 * SkillsMarketScene — The Skills Exchange, mile 1350 (§7.7).
 *
 * Barter UI over src/content/skills.json: four kinds of goods that look
 * identical on the shelf (procedure / scout / standing order / trade
 * route), bought with Credibility + Tokens. The confusability IS the
 * lesson, so the two authored traps do exactly what the catalog warns:
 *
 *  - secret_scrubbing_procedure: sells fine, works four times; purchase
 *    arms the delayed fifth-time failure — flag `procedure_trap_armed`
 *    plus localStorage `bbdm:skillsmarket` detail `procedureTrap`
 *    { goodId, usesRemaining: 4 }. The Wave-3 event engine decrements
 *    usesRemaining on qualifying agent-write events and fires the leak
 *    (and should call showCurriculumCard('enforcement_in_harness')) when
 *    it hits zero.
 *  - bargain_stall_route: works immediately (+tokens). If the Security
 *    Champion is alive she intercepts (trust -1, her line, no flag). If
 *    she is gone there is no warning: flag `compromised` is set, which
 *    the existing weight-0 event `compromised_consequence` consumes.
 *
 * Curriculum: layer_selection (trap procedure purchase),
 * supply_chain_injection (unvetted route purchase) — after the joke lands.
 *
 * Keyboard: Tab/arrows move between BUY buttons, Enter buys, L leaves.
 */

import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import skillsRaw from '../content/skills.json';
import marketContent from '../content/skills-market.json';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

type GoodType = 'procedure' | 'scout' | 'standing_order' | 'trade_route';

interface Good {
  id: string;
  type: GoodType;
  name: string;
  cost: { credibility: number; tokens: number };
  blurb: string;
  effect: string;
  trap: boolean;
  trapNote?: string;
}

interface MarketContent {
  intro: string;
  typeSigns: { type: GoodType; name: string; sign: string }[];
  proprietor: {
    greeting: string;
    genericSale: string;
    trapProcedureSale: string;
    trapRouteChampionDead: string;
  };
  championIntercept: string;
}

const GOODS = skillsRaw as Good[];
const CONTENT = marketContent as MarketContent;

const PANEL_ID = 'skillsmarket';
const STYLE_ID = 'sx-styles';
export const SKILLS_MARKET_KEY = 'bbdm:skillsmarket';

/**
 * localStorage `bbdm:skillsmarket` — what Wave 3 integrates:
 *  - `owned`: good ids purchased this run; the economy wires each good's
 *    `effect` line (event mitigation, day savings, hazard preview).
 *  - `procedureTrap`: present once the trap procedure is owned. The event
 *    engine decrements `usesRemaining` each time the prose rule would
 *    apply; at 0 it fires the secret-leak event, sets whatever flag that
 *    event defines, and shows curriculum card `enforcement_in_harness`.
 */
interface MarketRecord {
  v: 1;
  owned: string[];
  procedureTrap?: { goodId: string; usesRemaining: number };
}

function loadRecord(): MarketRecord {
  try {
    const raw = window.localStorage.getItem(SKILLS_MARKET_KEY);
    if (raw) {
      const data = JSON.parse(raw) as MarketRecord;
      if (data?.v === 1 && Array.isArray(data.owned)) return data;
    }
  } catch {
    /* fall through */
  }
  return { v: 1, owned: [] };
}

function saveRecord(record: MarketRecord): void {
  try {
    window.localStorage.setItem(SKILLS_MARKET_KEY, JSON.stringify(record));
  } catch {
    /* storage blocked: purchases still live in run flags/resources */
  }
}

const PANEL_CSS = `
#panel-${PANEL_ID} {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: auto; z-index: 20;
}
.sx-box {
  width: min(52rem, 96vw); max-height: 94vh; overflow-y: auto;
  background: rgba(0, 0, 0, 0.93); border: 2px solid var(--green);
  padding: 1rem 1.25rem; color: var(--green); font-family: var(--font-mono);
}
.sx-box h1 { font-size: 1rem; margin: 0; color: var(--white); }
.sx-intro { font-size: 0.82rem; margin: 0.3rem 0 0.5rem; }
.sx-balances { font-size: 0.85rem; color: var(--blue); margin: 0 0 0.6rem; }
.sx-type { margin-top: 0.7rem; border-top: 1px solid var(--blue); padding-top: 0.4rem; }
.sx-type-name { color: var(--white); font-size: 0.85rem; letter-spacing: 0.08em; }
.sx-type-sign { color: var(--blue); font-size: 0.75rem; margin: 0.1rem 0 0.4rem; }
.sx-good { display: grid; grid-template-columns: 1fr auto; gap: 0.2rem 0.8rem;
  padding: 0.3rem 0; align-items: start; }
.sx-good-name { color: var(--green); font-size: 0.88rem; }
.sx-good-blurb { grid-column: 1 / -1; color: var(--green); opacity: 0.75;
  font-size: 0.74rem; margin: 0; }
.sx-good-effect { grid-column: 1 / -1; color: var(--blue); font-size: 0.72rem; margin: 0; }
.sx-cost { color: var(--orange); font-size: 0.75rem; }
.sx-buy { font-size: 0.78rem; padding: 0.25rem 0.7rem; white-space: nowrap; }
.sx-buy[disabled] { opacity: 0.45; cursor: default; }
.sx-buy[disabled]:hover { background: var(--black); color: var(--green); }
.sx-owned { color: var(--green); font-size: 0.78rem; white-space: nowrap; }
.sx-proprietor { margin-top: 0.8rem; border: 1px dashed var(--green);
  padding: 0.5rem 0.7rem; font-size: 0.82rem; min-height: 2.4rem; }
.sx-proprietor .who { color: var(--white); }
.sx-actions { display: flex; justify-content: flex-end; margin-top: 0.7rem; }
`;

export class SkillsMarketScene extends Phaser.Scene {
  private record: MarketRecord = { v: 1, owned: [] };
  private proprietorLine = '';
  private proprietorWho = 'THE PROPRIETOR';
  private busy = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super('SkillsMarket');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.ensureStyles();
    this.record = loadRecord();
    this.proprietorLine = CONTENT.proprietor.greeting;
    this.proprietorWho = 'THE PROPRIETOR';
    this.busy = false;

    // Dev-only (mirrors main.ts's ?minigame deep link): ?champion=dead
    // exercises the no-warning branch of the unvetted route without
    // grinding morale to zero three times. Harmless in production.
    if (new URLSearchParams(window.location.search).get('champion') === 'dead') {
      const idx = getState().party.findIndex((m) => m.specialization === 'security');
      if (idx > 0) actions.loseMember(idx);
    }

    this.drawBackdrop();
    this.render();

    this.keyHandler = (e: KeyboardEvent) => {
      if (document.querySelector('.field-note-backdrop')) return;
      if (e.key === 'l' || e.key === 'L') this.leave();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(`#panel-${PANEL_ID} button:not([disabled])`),
        );
        if (buttons.length === 0) return;
        const idx = buttons.findIndex((b) => b === document.activeElement);
        const next =
          e.key === 'ArrowDown'
            ? buttons[(idx + 1) % buttons.length]
            : buttons[(idx - 1 + buttons.length) % buttons.length];
        next?.focus();
        e.preventDefault();
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
    bus.emit('scene:ready', { scene: 'SkillsMarket' });
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
    // Shelf lines and folder shapes: everything here is a folder.
    for (let row = 0; row < 3; row++) {
      const y = 60 + row * 44;
      this.add.rectangle(GAME_WIDTH / 2, y + 12, 280, 2, 0x123310);
      for (let i = 0; i < 7; i++) {
        this.add.rectangle(36 + i * 42, y, 24, 16, 0x0a2a08).setStrokeStyle(1, 0x1bcb01);
        this.add.rectangle(28 + i * 42, y - 10, 8, 4, 0x0a2a08).setStrokeStyle(1, 0x1bcb01);
      }
    }
    this.add
      .text(GAME_WIDTH / 2, 8, 'THE SKILLS EXCHANGE', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);
  }

  private securityChampion(): { name: string; alive: boolean } {
    const member = getState().party.find((m) => m.specialization === 'security');
    return { name: member?.name ?? 'The Security Champion', alive: member?.alive ?? false };
  }

  private canAfford(good: Good): { ok: boolean; why: string } {
    const r = getState().resources;
    if (r.credibility < good.cost.credibility) return { ok: false, why: 'NOT ENOUGH CREDIBILITY' };
    if (r.tokens <= good.cost.tokens) return { ok: false, why: 'NOT ENOUGH TOKENS' };
    return { ok: true, why: '' };
  }

  private render(): void {
    const esc = escapeHtml;
    const r = getState().resources;
    const panel = mountPanel(PANEL_ID);

    const sections = CONTENT.typeSigns
      .map((sign) => {
        const goods = GOODS.filter((g) => g.type === sign.type)
          .map((g) => {
            const owned = this.record.owned.includes(g.id);
            const afford = this.canAfford(g);
            const action = owned
              ? `<span class="sx-owned">✓ STOCKED</span>`
              : `<button type="button" class="btn sx-buy" data-buy="${esc(g.id)}"
                   ${afford.ok ? '' : `disabled title="${esc(afford.why)}"`}>
                   BUY ${afford.ok ? '' : `— ${esc(afford.why)}`}</button>`;
            return `<div class="sx-good">
              <div>
                <span class="sx-good-name">${esc(g.name)}</span>
                <span class="sx-cost"> — ${g.cost.credibility} CRED · ${g.cost.tokens} TOKENS</span>
              </div>
              <div>${action}</div>
              <p class="sx-good-blurb">${esc(g.blurb)}</p>
              <p class="sx-good-effect">${esc(g.effect)}</p>
            </div>`;
          })
          .join('');
        return `<div class="sx-type">
          <div class="sx-type-name">${esc(sign.name)}</div>
          <div class="sx-type-sign">${esc(sign.sign)}</div>
          ${goods}
        </div>`;
      })
      .join('');

    panel.innerHTML = `
      <div class="sx-box" role="dialog" aria-label="The Skills Exchange">
        <h1>THE SKILLS EXCHANGE</h1>
        <p class="sx-intro">${esc(CONTENT.intro)}</p>
        <p class="sx-balances">TOKENS ${Math.floor(r.tokens)} · CREDIBILITY ${Math.floor(r.credibility)}</p>
        ${sections}
        <div class="sx-proprietor"><span class="who">${esc(this.proprietorWho)}:</span>
          ${esc(this.proprietorLine)}</div>
        <div class="sx-actions">
          <button type="button" class="btn" data-action="leave">LEAVE THE EXCHANGE (L)</button>
        </div>
      </div>`;

    panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const good = GOODS.find((g) => g.id === btn.dataset['buy']);
        if (good) void this.buy(good);
      });
    });
    panel
      .querySelector<HTMLButtonElement>('[data-action="leave"]')
      ?.addEventListener('click', () => this.leave());
  }

  private async buy(good: Good): Promise<void> {
    if (this.busy || this.record.owned.includes(good.id)) return;
    if (!this.canAfford(good).ok) return;
    this.busy = true;

    actions.applyResourceDelta(
      { credibility: -good.cost.credibility, tokens: -good.cost.tokens },
      `Bought: ${good.name}.`,
    );
    this.record.owned.push(good.id);
    this.proprietorWho = 'THE PROPRIETOR';
    this.proprietorLine = CONTENT.proprietor.genericSale;

    if (good.id === 'secret_scrubbing_procedure') {
      // THE TRAP: a Procedure sold for a Standing Order's job. Works four
      // times; the fifth is armed here and fired by the event engine.
      actions.setFlag('procedure_trap_armed');
      this.record.procedureTrap = { goodId: good.id, usesRemaining: 4 };
      this.proprietorLine = CONTENT.proprietor.trapProcedureSale;
      saveRecord(this.record);
      saveRun(getState());
      this.render();
      await showCurriculumCard('layer_selection');
    } else if (good.id === 'bargain_stall_route') {
      // THE OTHER TRAP: the unvetted route works — immediately, which is
      // the most suspicious thing about it — and reads the wagon.
      actions.applyResourceDelta({ tokens: 10 }, 'The bargain route works at once. +10 tokens.');
      const champion = this.securityChampion();
      if (champion.alive) {
        actions.applyResourceDelta({ trust: -1 });
        this.proprietorWho = 'THE SECURITY CHAMPION';
        this.proprietorLine = CONTENT.championIntercept.replaceAll('{champion}', champion.name);
      } else {
        actions.setFlag('compromised');
        this.proprietorLine = CONTENT.proprietor.trapRouteChampionDead;
      }
      saveRecord(this.record);
      saveRun(getState());
      this.render();
      await showCurriculumCard('supply_chain_injection');
    } else {
      saveRecord(this.record);
      saveRun(getState());
      this.render();
    }
    this.busy = false;
  }

  private leave(): void {
    saveRun(getState());
    this.scene.start('Trail');
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
