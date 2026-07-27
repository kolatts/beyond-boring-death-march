/**
 * SkillsMarketScene — THE SKILLSMITH, mile 1350 (§7.7, reworked).
 *
 * The stall forges a skill instead of selling four abstract goods. The
 * player assembles a skill folder in three picks — DESCRIPTION (the
 * trigger surface: too broad / too narrow / right-sized), INSTRUCTIONS
 * (nine concise steps vs. a 4,000-word persona), optional SCRIPT
 * attachment — then watches THE DEMONSTRATION: three trail tasks pass
 * and, for each, the agent reviews the label and loads the skill or
 * doesn't. Too broad loads (and bloats context) on every task; too
 * narrow never loads, even on the perfect match; right-sized loads once,
 * cleanly. One free re-forge of the description after seeing results —
 * the iteration is the lesson. Curriculum card `skills_dynamic_loading`
 * fires when the player accepts the forging (unknown id no-ops until the
 * sibling curriculum content merges).
 *
 * The closing enforcement beat and both traps keep their exact
 * interfaces for the Wave-3 event engine:
 *
 *  - secret_scrubbing_procedure ("a skill that remembers to scrub
 *    secrets"): purchase arms the delayed fifth-time failure — flag
 *    `procedure_trap_armed` plus localStorage `bbdm:skillsmarket` detail
 *    `procedureTrap` { goodId, usesRemaining: 4 }. eventEngine.ts
 *    decrements usesRemaining on qualifying agent-write moments and
 *    fires the leak when it hits zero. Card: layer_selection.
 *  - secret_scan_order: the Standing Order (hook) next door — the
 *    correct purchase for the same job. A skill advises; the harness
 *    enforces.
 *  - bargain_stall_route ("the bargain connection"): works immediately
 *    (+10 tokens). If the Security Champion is alive she intercepts
 *    (trust -1, her line, no flag). If she is gone: flag `compromised`,
 *    consumed by the weight-0 event `compromised_consequence`.
 *    Card: supply_chain_injection.
 *
 * localStorage `bbdm:skillsmarket` (shape v1, additive only):
 *  - `owned`: purchased ids; `release_runbook` is added when the player
 *    accepts a right-sized forging (Wave 3 wires its release benefit).
 *  - `procedureTrap`: unchanged shape, see above.
 *  - `forged`: { description, instructions, attachment, reforged } —
 *    what came off the anvil, for Wave-3 flavor/economy use.
 *
 * Keyboard: 1-9 pick options, arrows move focus, Enter activates
 * (fast-forwards the demonstration), R re-forges, L leaves.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { showCurriculumCard, isFieldNoteOpen } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import contentRaw from '../content/skills.json';

// ---------------------------------------------------------------------------
// Content types (see src/schemas/skills.schema.json)
// ---------------------------------------------------------------------------

type DescId = 'too_broad' | 'too_narrow' | 'right_sized';
type InstrId = 'concise' | 'persona';
type AttachId = 'none' | 'script';

interface Effects {
  tokens?: number;
  credibility?: number;
  morale?: number;
  greenBuilds?: number;
  trust?: number;
}

interface PickOption {
  id: string;
  label: string;
  text: string;
  aside: string;
  tokenCost?: number;
}

interface Pick {
  prompt: string;
  options: PickOption[];
}

interface DemoTask {
  id: string;
  title: string;
  body: string;
  match: boolean;
}

interface Outcome {
  tasks: { line: string; effects: Effects }[];
  verdict: string;
}

interface ClosingOffer {
  id: string;
  kind: 'trap_skill' | 'standing_order' | 'trade_route';
  name: string;
  pitch: string;
  cost: { credibility: number; tokens: number };
}

interface SkillsContent {
  stall: {
    title: string;
    intro: string;
    greeting: string;
    cornerSigns: { layer: string; name: string; sign: string }[];
  };
  forge: {
    intro: string;
    descriptionPick: Pick;
    instructionsPick: Pick;
    attachmentPick: Pick;
    forgeLine: string;
  };
  demo: {
    intro: string;
    reviewPrefix: string;
    tasks: DemoTask[];
    outcomes: Record<DescId, Outcome>;
    personaLine: string;
    personaEffects: Effects;
    scriptLine: string;
    scriptEffects: Effects;
  };
  reforge: { offer: string; offerAlreadyRight: string; reforgeIntro: string };
  closing: {
    intro: string;
    offers: ClosingOffer[];
    proprietor: {
      genericSale: string;
      trapProcedureSale: string;
      trapRouteChampionDead: string;
    };
    championIntercept: string;
  };
}

const CONTENT = contentRaw as SkillsContent;

const PANEL_ID = 'skillsmarket';
const STYLE_ID = 'sk-styles';
export const SKILLS_MARKET_KEY = 'bbdm:skillsmarket';

/** Skill id recorded in `owned` when a right-sized forging is accepted. */
const FORGED_SKILL_ID = 'release_runbook';

/** Context-bar segments (percent of the demonstration context bar). */
const BAR_WORK = 45;
const BAR_SKILL_CONCISE = 12;
const BAR_SKILL_PERSONA = 40;

// ---------------------------------------------------------------------------
// localStorage record (shape consumed by systems/eventEngine.ts — additive)
// ---------------------------------------------------------------------------

interface MarketRecord {
  v: 1;
  owned: string[];
  procedureTrap?: { goodId: string; usesRemaining: number };
  forged?: {
    description: DescId;
    instructions: InstrId;
    attachment: AttachId;
    reforged: boolean;
  };
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

// ---------------------------------------------------------------------------
// Panel CSS
// ---------------------------------------------------------------------------

const PANEL_CSS = `
#panel-${PANEL_ID} {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: auto; z-index: 20;
}
.sk-box {
  width: min(54rem, 96vw); max-height: 94vh; overflow-y: auto;
  background: rgba(0, 0, 0, 0.9); border: 2px solid var(--green);
  padding: 1rem 1.25rem; color: var(--green); font-family: var(--font-mono);
}
.sk-box h1 { font-size: 1rem; margin: 0; color: var(--white); }
.sk-step { color: var(--blue); font-size: 0.72rem; letter-spacing: 0.1em; margin: 0 0 0.2rem; }
.sk-prose { font-size: 0.82rem; margin: 0.3rem 0 0.5rem; }
.sk-smith { color: var(--orange); }
.sk-balances { font-size: 0.8rem; color: var(--blue); margin: 0 0 0.5rem; }

.sk-signs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem;
  margin: 0.5rem 0; }
.sk-sign { border: 1px solid var(--blue); padding: 0.3rem 0.4rem; }
.sk-sign-name { color: var(--white); font-size: 0.7rem; letter-spacing: 0.08em; }
.sk-sign-text { color: var(--blue); font-size: 0.62rem; margin: 0.15rem 0 0; }
.sk-signs.compact .sk-sign-text { display: none; }

.sk-folder { background: #f2e7c9; color: #221c10; border: 2px solid #221c10;
  padding: 0.5rem 0.7rem; margin: 0.5rem 0; position: relative;
  font-size: 0.78rem; }
.sk-folder::before { content: ''; position: absolute; top: -10px; left: 12px;
  width: 64px; height: 10px; background: #f2e7c9; border: 2px solid #221c10;
  border-bottom: none; }
.sk-folder-row { margin: 0.1rem 0; }
.sk-folder-key { font-weight: 700; letter-spacing: 0.06em; }
.sk-folder .unset { opacity: 0.45; font-style: italic; }
.sk-folder.glow { box-shadow: 0 0 14px rgba(27, 203, 1, 0.75); }

.sk-opts { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.5rem 0; }
.sk-opt { display: block; width: 100%; text-align: left; font-size: 0.8rem;
  padding: 0.45rem 0.7rem; }
.sk-opt .num { color: var(--orange); }
.sk-opt .opt-text { display: block; text-transform: none; letter-spacing: 0;
  font-size: 0.74rem; opacity: 0.85; margin-top: 0.15rem; }
.sk-opt .opt-aside { display: block; text-transform: none; letter-spacing: 0;
  font-size: 0.7rem; color: var(--blue); font-style: italic; margin-top: 0.15rem; }
.sk-opt:hover .opt-aside, .sk-opt:focus-visible .opt-aside { color: var(--black); }
.sk-opt[disabled] { opacity: 0.45; cursor: default; }
.sk-opt[disabled]:hover { background: var(--black); color: var(--green); }

.sk-demo-hint { color: var(--blue); font-size: 0.7rem; margin: 0.2rem 0 0.4rem; }
.sk-task { border: 1px solid var(--blue); padding: 0.45rem 0.6rem;
  margin: 0.5rem 0; animation: sk-slide-in 300ms ease-out; }
.sk-task-title { color: var(--white); font-size: 0.8rem; letter-spacing: 0.06em; }
.sk-task-body { font-size: 0.76rem; margin: 0.15rem 0 0.3rem; }
.sk-review { font-size: 0.74rem; color: var(--blue); margin: 0.2rem 0; }
.sk-review .label-quote { color: var(--white); }
.sk-load { font-size: 0.78rem; letter-spacing: 0.06em; margin: 0.2rem 0; }
.sk-load.loaded { animation: sk-glow-in 500ms ease-out; }
.sk-outcome { font-size: 0.76rem; margin: 0.25rem 0; }
.sk-mod { font-size: 0.72rem; color: var(--orange); margin: 0.15rem 0; }
.sk-chips { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; margin: 0.2rem 0; }
.sk-chips span { font-size: 0.72rem; }

.sk-bar { display: flex; height: 14px; border: 1px solid var(--green);
  margin: 0.3rem 0; background: var(--black); }
.sk-bar-seg { height: 100%; transition: width 600ms ease-out; }
.sk-bar-seg.work { background: var(--blue); }
.sk-bar-seg.skill-good { background: var(--green); }
.sk-bar-seg.skill-waste { background: var(--orange); }
.sk-bar-label { font-size: 0.64rem; color: var(--blue); margin: 0 0 0.2rem; }
.sk-bar-miss { font-size: 0.72rem; color: var(--violet); }

.sk-verdict { border: 1px dashed var(--green); padding: 0.5rem 0.7rem;
  margin: 0.6rem 0; font-size: 0.8rem; animation: sk-slide-in 300ms ease-out; }
.sk-verdict .who { color: var(--white); }

.sk-offer { display: grid; grid-template-columns: 1fr auto; gap: 0.2rem 0.8rem;
  padding: 0.35rem 0; border-top: 1px solid var(--blue); align-items: start; }
.sk-offer-name { color: var(--green); font-size: 0.85rem; }
.sk-offer-pitch { grid-column: 1 / -1; font-size: 0.74rem; opacity: 0.8; margin: 0; }
.sk-cost { color: var(--orange); font-size: 0.74rem; }
.sk-buy { font-size: 0.78rem; padding: 0.25rem 0.7rem; white-space: nowrap; }
.sk-buy[disabled] { opacity: 0.45; cursor: default; }
.sk-buy[disabled]:hover { background: var(--black); color: var(--green); }
.sk-owned { color: var(--green); font-size: 0.78rem; white-space: nowrap; }

.sk-proprietor { margin-top: 0.7rem; border: 1px dashed var(--green);
  padding: 0.5rem 0.7rem; font-size: 0.8rem; min-height: 2.2rem; }
.sk-proprietor .who { color: var(--white); }
.sk-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 0.7rem; }

.sk-box.striking { animation: sk-strike 420ms ease-out; }
@keyframes sk-strike {
  0% { box-shadow: none; }
  30% { box-shadow: 0 0 26px rgba(245, 93, 8, 0.9); transform: translateY(2px); }
  100% { box-shadow: none; transform: none; }
}
@keyframes sk-slide-in {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes sk-glow-in {
  from { text-shadow: 0 0 14px rgba(27, 203, 1, 1); }
  to { text-shadow: none; }
}
@media (max-width: 600px) {
  .sk-signs { grid-template-columns: repeat(2, 1fr); }
}
`;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

type Phase =
  | 'arrive'
  | 'pick_desc'
  | 'pick_instr'
  | 'pick_attach'
  | 'demo'
  | 'results'
  | 'closing';

export class SkillsMarketScene extends Phaser.Scene {
  private record: MarketRecord = { v: 1, owned: [] };
  private phase: Phase = 'arrive';
  private description: DescId | null = null;
  private instructions: InstrId | null = null;
  private attachment: AttachId | null = null;
  private reforgeUsed = false;
  private reforging = false;
  private fastForward = false;
  private reduced = false;
  private alive = false;
  private busy = false;
  private proprietorWho = 'THE PROPRIETOR';
  private proprietorLine = '';
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
    this.phase = 'arrive';
    this.description = null;
    this.instructions = null;
    this.attachment = null;
    this.reforgeUsed = false;
    this.reforging = false;
    this.fastForward = false;
    this.busy = false;
    this.alive = true;
    this.proprietorWho = 'THE PROPRIETOR';
    this.proprietorLine = '';
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      if (isFieldNoteOpen()) return;
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const opts = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            `#panel-${PANEL_ID} [data-opt]:not([disabled])`,
          ),
        );
        opts[digit - 1]?.click();
        return;
      }
      if ((e.key === 'l' || e.key === 'L') && (this.phase === 'arrive' || this.phase === 'closing')) {
        this.leave();
        return;
      }
      if ((e.key === 'r' || e.key === 'R') && this.phase === 'results') {
        document
          .querySelector<HTMLButtonElement>(`#panel-${PANEL_ID} [data-action="reforge"]`)
          ?.click();
        return;
      }
      if (this.phase === 'demo' && (e.key === 'Enter' || e.key === ' ')) {
        this.fastForward = true;
        return;
      }
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
      this.alive = false;
      unmountPanel(PANEL_ID);
      if (this.keyHandler) {
        window.removeEventListener('keydown', this.keyHandler);
        this.keyHandler = null;
      }
    });
    bus.emit('scene:ready', { scene: 'SkillsMarket' });
  }

  private ensureStyles(): void {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Phaser backdrop: the forge (ambient flicker per ART-DIRECTION v3)
  // -------------------------------------------------------------------------

  private drawBackdrop(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#000000');

    // Hearth glow along the bottom, anvil silhouette, hanging folders.
    const glow = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 18, GAME_WIDTH, 46, 0xf55d08, 0.16);
    const fire = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 30, 44, 20, 0xf55d08, 0.5);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 46, 60, 10, 0x123310).setStrokeStyle(1, 0x1bcb01);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 56, 26, 10, 0x0a2a08).setStrokeStyle(1, 0x1bcb01);
    for (let i = 0; i < 6; i++) {
      this.add.rectangle(30 + i * 52, 44, 24, 16, 0x0a2a08).setStrokeStyle(1, 0x1bcb01);
      this.add.rectangle(22 + i * 52, 34, 8, 4, 0x0a2a08).setStrokeStyle(1, 0x1bcb01);
    }
    this.add
      .text(GAME_WIDTH / 2, 8, 'THE SKILLSMITH', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);

    if (!this.reduced) {
      this.tweens.add({
        targets: [glow, fire],
        alpha: { from: 1, to: 0.55 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      // Sparks drifting up off the anvil.
      for (let i = 0; i < 3; i++) {
        const spark = this.add.rectangle(
          GAME_WIDTH / 2 - 8 + i * 8,
          GAME_HEIGHT - 40,
          2,
          2,
          0xf55d08,
          0.9,
        );
        this.tweens.add({
          targets: spark,
          y: GAME_HEIGHT - 80 - i * 10,
          alpha: 0,
          duration: 1200 + i * 300,
          repeat: -1,
          delay: i * 400,
          ease: 'Sine.easeOut',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shared HTML fragments
  // -------------------------------------------------------------------------

  private signsHtml(compact: boolean): string {
    const cells = CONTENT.stall.cornerSigns
      .map(
        (s) => `<div class="sk-sign">
          <div class="sk-sign-name">${escapeHtml(s.name)}</div>
          <p class="sk-sign-text">${escapeHtml(s.sign)}</p>
        </div>`,
      )
      .join('');
    return `<div class="sk-signs${compact ? ' compact' : ''}">${cells}</div>`;
  }

  private balancesHtml(): string {
    const r = getState().resources;
    return `<p class="sk-balances">TOKENS ${Math.floor(r.tokens)} · CREDIBILITY ${Math.floor(
      r.credibility,
    )}</p>`;
  }

  private pickedOption(pick: Pick, id: string | null): PickOption | null {
    return pick.options.find((o) => o.id === id) ?? null;
  }

  private folderHtml(glow = false): string {
    const desc = this.pickedOption(CONTENT.forge.descriptionPick, this.description);
    const instr = this.pickedOption(CONTENT.forge.instructionsPick, this.instructions);
    const attach = this.pickedOption(CONTENT.forge.attachmentPick, this.attachment);
    const row = (key: string, opt: PickOption | null): string =>
      `<div class="sk-folder-row"><span class="sk-folder-key">${key}:</span> ${
        opt ? escapeHtml(opt.text) : '<span class="unset">— not yet struck —</span>'
      }</div>`;
    return `<div class="sk-folder${glow ? ' glow' : ''}">
      <div class="sk-folder-row"><span class="sk-folder-key">NAME:</span> THE RELEASE RUNBOOK</div>
      ${row('DESCRIPTION', desc)}
      ${row('INSTRUCTIONS', instr)}
      ${row('ATTACHMENT', attach)}
    </div>`;
  }

  private mountBox(inner: string): HTMLElement {
    const panel = mountPanel(PANEL_ID);
    panel.innerHTML = `<div class="sk-box" role="dialog" aria-label="The Skillsmith">${inner}</div>`;
    return panel;
  }

  // -------------------------------------------------------------------------
  // Render dispatch
  // -------------------------------------------------------------------------

  private render(): void {
    switch (this.phase) {
      case 'arrive':
        this.renderArrive();
        break;
      case 'pick_desc':
        this.renderPick(
          'STEP 1 OF 3 — THE DESCRIPTION',
          CONTENT.forge.descriptionPick,
          this.reforging ? CONTENT.reforge.reforgeIntro : CONTENT.forge.intro,
          (id) => {
            this.description = id as DescId;
            if (this.reforging) void this.forgeAndDemo();
            else {
              this.phase = 'pick_instr';
              this.render();
            }
          },
        );
        break;
      case 'pick_instr':
        this.renderPick('STEP 2 OF 3 — THE INSTRUCTIONS', CONTENT.forge.instructionsPick, null, (id) => {
          this.instructions = id as InstrId;
          this.phase = 'pick_attach';
          this.render();
        });
        break;
      case 'pick_attach':
        this.renderPick('STEP 3 OF 3 — THE ATTACHMENT', CONTENT.forge.attachmentPick, null, (id) => {
          this.attachment = id as AttachId;
          void this.forgeAndDemo();
        });
        break;
      case 'closing':
        this.renderClosing();
        break;
      default:
        break; // demo/results render themselves
    }
  }

  private renderArrive(): void {
    const c = CONTENT.stall;
    const panel = this.mountBox(`
      <h1>${escapeHtml(c.title)}</h1>
      <p class="sk-prose">${escapeHtml(c.intro)}</p>
      ${this.signsHtml(false)}
      <div class="sk-proprietor"><span class="who">THE SMITH:</span> ${escapeHtml(c.greeting)}</div>
      <div class="sk-actions">
        <button type="button" class="btn" data-action="leave">LEAVE (L)</button>
        <button type="button" class="btn" data-action="begin">STEP TO THE ANVIL (Enter)</button>
      </div>`);
    panel.querySelector<HTMLButtonElement>('[data-action="begin"]')?.addEventListener('click', () => {
      this.phase = 'pick_desc';
      this.render();
    });
    panel.querySelector<HTMLButtonElement>('[data-action="leave"]')?.addEventListener('click', () => {
      this.leave();
    });
    panel.querySelector<HTMLButtonElement>('[data-action="begin"]')?.focus();
  }

  private renderPick(
    step: string,
    pick: Pick,
    intro: string | null,
    onPick: (id: string) => void,
  ): void {
    const tokens = getState().resources.tokens;
    const options = pick.options
      .map((o, i) => {
        const cost = o.tokenCost ?? 0;
        const affordable = cost === 0 || tokens > cost;
        return `<button type="button" class="btn sk-opt" data-opt="${escapeHtml(o.id)}"
          ${affordable ? '' : 'disabled title="NOT ENOUGH TOKENS"'}>
          <span class="num">${i + 1}.</span> ${escapeHtml(o.label)}${
            cost > 0 ? ` <span class="sk-cost">— ${cost} TOKENS</span>` : ''
          }${affordable ? '' : ' <span class="sk-cost">— NOT ENOUGH TOKENS</span>'}
          <span class="opt-text">${escapeHtml(o.text)}</span>
          <span class="opt-aside">THE SMITH: ${escapeHtml(o.aside)}</span>
        </button>`;
      })
      .join('');

    const panel = this.mountBox(`
      <h1>${escapeHtml(CONTENT.stall.title)}</h1>
      ${this.signsHtml(true)}
      ${intro ? `<p class="sk-prose">${escapeHtml(intro)}</p>` : ''}
      ${this.balancesHtml()}
      ${this.folderHtml()}
      <p class="sk-step">${escapeHtml(step)}</p>
      <p class="sk-prose">${escapeHtml(pick.prompt)}</p>
      <div class="sk-opts">${options}</div>`);

    panel.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['opt'];
        if (id) onPick(id);
      });
    });
    panel.querySelector<HTMLButtonElement>('[data-opt]')?.focus();
  }

  // -------------------------------------------------------------------------
  // The forging + THE DEMONSTRATION
  // -------------------------------------------------------------------------

  private delay(ms: number): Promise<void> {
    const t = this.reduced || this.fastForward ? 0 : ms;
    return new Promise((resolve) => window.setTimeout(resolve, t));
  }

  private async forgeAndDemo(): Promise<void> {
    if (!this.description || !this.instructions || !this.attachment) return;
    this.phase = 'demo';
    this.fastForward = false;

    // Charge the attachment once, at first forging only.
    if (!this.reforging) {
      const attach = this.pickedOption(CONTENT.forge.attachmentPick, this.attachment);
      const cost = attach?.tokenCost ?? 0;
      if (cost > 0) {
        actions.applyResourceDelta({ tokens: -cost }, 'The Skillsmith bolts in the rollback script.');
        saveRun(getState());
      }
    }

    // Strike.
    const panel = this.mountBox(`
      <h1>${escapeHtml(CONTENT.stall.title)}</h1>
      ${this.folderHtml(true)}
      <div class="sk-proprietor"><span class="who">THE SMITH:</span> ${escapeHtml(
        CONTENT.forge.forgeLine,
      )}</div>
      <p class="sk-prose">${escapeHtml(CONTENT.demo.intro)}</p>
      <p class="sk-demo-hint">ENTER FAST-FORWARDS THE DEMONSTRATION.</p>
      <div data-demo></div>`);
    const box = panel.querySelector<HTMLElement>('.sk-box');
    if (box && !this.reduced) {
      box.classList.add('striking');
      window.setTimeout(() => box.classList.remove('striking'), 450);
    }
    if (!this.reduced) this.cameras.main.flash(200, 245, 93, 8);
    await this.delay(700);
    if (!this.alive) return;

    const host = panel.querySelector<HTMLElement>('[data-demo]');
    if (!host) return;

    const desc = this.description;
    const descOpt = this.pickedOption(CONTENT.forge.descriptionPick, desc);
    const outcome = CONTENT.demo.outcomes[desc];
    const persona = this.instructions === 'persona';
    const script = this.attachment === 'script';
    const skillSeg = persona ? BAR_SKILL_PERSONA : BAR_SKILL_CONCISE;
    const totals = { tokens: 0, credibility: 0, morale: 0, greenBuilds: 0, trust: 0 };

    for (let i = 0; i < CONTENT.demo.tasks.length; i++) {
      const task = CONTENT.demo.tasks[i];
      const result = outcome.tasks[i];
      if (!task || !result) continue;
      const loaded = desc === 'too_broad' ? true : desc === 'too_narrow' ? false : task.match;

      const card = document.createElement('div');
      card.className = 'sk-task';
      card.innerHTML = `
        <div class="sk-task-title">${escapeHtml(task.title)}</div>
        <p class="sk-task-body">${escapeHtml(task.body)}</p>`;
      host.appendChild(card);
      card.scrollIntoView({ block: 'nearest' });
      await this.delay(500);
      if (!this.alive) return;

      // The skill-review moment: the agent reads the label, not the folder.
      const review = document.createElement('p');
      review.className = 'sk-review';
      review.innerHTML = `${escapeHtml(CONTENT.demo.reviewPrefix)}
        <span class="label-quote">&ldquo;${escapeHtml(descOpt?.text ?? '')}&rdquo;</span>`;
      card.appendChild(review);
      await this.delay(700);
      if (!this.alive) return;

      const verdictEl = document.createElement('div');
      verdictEl.className = `sk-load ${loaded ? 'loaded status-ok' : 'status-warn'}`;
      verdictEl.textContent = loaded
        ? ' SKILL LOADED — the folder opens and slots into context'
        : ' NOT LOADED — the label does not match; the folder stays shut';
      card.appendChild(verdictEl);

      // Context bar: the work, plus the skill if it loaded.
      const wasted = loaded && !task.match;
      const bar = document.createElement('div');
      bar.innerHTML = `
        <div class="sk-bar-label">CONTEXT THIS TASK — WORK ${BAR_WORK}%${
          loaded ? ` + SKILL ${skillSeg}%` : ''
        }</div>
        <div class="sk-bar">
          <div class="sk-bar-seg work" style="width:0%"></div>
          ${loaded ? `<div class="sk-bar-seg ${wasted ? 'skill-waste' : 'skill-good'}" style="width:0%"></div>` : ''}
        </div>`;
      card.appendChild(bar);
      const segs = bar.querySelectorAll<HTMLElement>('.sk-bar-seg');
      window.requestAnimationFrame(() => {
        const work = segs[0];
        if (work) work.style.width = `${BAR_WORK}%`;
        const skillEl = segs[1];
        if (skillEl) skillEl.style.width = `${skillSeg}%`;
      });
      await this.delay(650);
      if (!this.alive) return;

      const chips: string[] = [];
      const addFx = (fx: Effects): void => {
        totals.tokens += fx.tokens ?? 0;
        totals.credibility += fx.credibility ?? 0;
        totals.morale += fx.morale ?? 0;
        totals.greenBuilds += fx.greenBuilds ?? 0;
        totals.trust += fx.trust ?? 0;
        chips.push(...fmtEffects(fx));
      };

      if (loaded && persona) {
        const mod = document.createElement('p');
        mod.className = 'sk-mod';
        mod.textContent = CONTENT.demo.personaLine;
        card.appendChild(mod);
        addFx(CONTENT.demo.personaEffects);
      }
      if (loaded && script && task.match) {
        const mod = document.createElement('p');
        mod.className = 'sk-mod';
        mod.textContent = CONTENT.demo.scriptLine;
        card.appendChild(mod);
        addFx(CONTENT.demo.scriptEffects);
      }
      if (!loaded && task.match) {
        const miss = document.createElement('p');
        miss.className = 'sk-bar-miss';
        miss.textContent = '× THE ONE JOB IT WAS FORGED FOR PASSES BY UNAIDED.';
        card.appendChild(miss);
        if (!this.reduced) this.cameras.main.shake(150, 0.004);
      }

      const line = document.createElement('p');
      line.className = 'sk-outcome';
      line.textContent = result.line;
      card.appendChild(line);
      addFx(result.effects);

      if (chips.length > 0) {
        const chipRow = document.createElement('div');
        chipRow.className = 'sk-chips';
        chipRow.innerHTML = chips.join(' ');
        card.appendChild(chipRow);
      }
      card.scrollIntoView({ block: 'nearest' });
      await this.delay(900);
      if (!this.alive) return;
    }

    actions.applyResourceDelta(totals, 'The Skillsmith runs the demonstration.');
    saveRun(getState());
    this.showResults(host, outcome.verdict);
  }

  private showResults(host: HTMLElement, verdict: string): void {
    this.phase = 'results';
    const rightSized = this.description === 'right_sized';
    const offer = this.reforgeUsed
      ? null
      : rightSized
        ? CONTENT.reforge.offerAlreadyRight
        : CONTENT.reforge.offer;

    const block = document.createElement('div');
    block.className = 'sk-verdict';
    block.innerHTML = `
      <p class="sk-prose"><span class="who">THE SMITH:</span> ${escapeHtml(verdict)}</p>
      ${offer ? `<p class="sk-prose">${escapeHtml(offer)}</p>` : ''}
      <div class="sk-actions">
        ${offer ? '<button type="button" class="btn" data-action="reforge">RE-FORGE THE DESCRIPTION (R)</button>' : ''}
        <button type="button" class="btn" data-action="accept">KEEP THIS SKILL AND MOVE ON</button>
      </div>`;
    host.appendChild(block);
    block.scrollIntoView({ block: 'nearest' });

    block.querySelector<HTMLButtonElement>('[data-action="reforge"]')?.addEventListener('click', () => {
      this.reforgeUsed = true;
      this.reforging = true;
      this.phase = 'pick_desc';
      this.render();
    });
    block.querySelector<HTMLButtonElement>('[data-action="accept"]')?.addEventListener('click', () => {
      void this.accept();
    });
    block.querySelector<HTMLButtonElement>('[data-action="accept"]')?.focus();
  }

  private async accept(): Promise<void> {
    if (this.busy || !this.description || !this.instructions || !this.attachment) return;
    this.busy = true;
    this.record.forged = {
      description: this.description,
      instructions: this.instructions,
      attachment: this.attachment,
      reforged: this.reforgeUsed,
    };
    if (this.description === 'right_sized' && !this.record.owned.includes(FORGED_SKILL_ID)) {
      this.record.owned.push(FORGED_SKILL_ID);
    }
    saveRecord(this.record);
    saveRun(getState());
    // The lesson has landed: dynamic loading, keyed on the description.
    await showCurriculumCard('skills_dynamic_loading');
    this.busy = false;
    this.phase = 'closing';
    this.render();
  }

  // -------------------------------------------------------------------------
  // Closing beat: the back counter (traps + the Standing Order next door)
  // -------------------------------------------------------------------------

  private securityChampion(): { name: string; alive: boolean } {
    const member = getState().party.find((m) => m.specialization === 'security');
    return { name: member?.name ?? 'The Security Champion', alive: member?.alive ?? false };
  }

  private canAfford(offer: ClosingOffer): { ok: boolean; why: string } {
    const r = getState().resources;
    if (r.credibility < offer.cost.credibility) return { ok: false, why: 'NOT ENOUGH CREDIBILITY' };
    if (r.tokens <= offer.cost.tokens) return { ok: false, why: 'NOT ENOUGH TOKENS' };
    return { ok: true, why: '' };
  }

  private renderClosing(): void {
    if (!this.proprietorLine) {
      this.proprietorWho = 'THE PROPRIETOR';
      this.proprietorLine = CONTENT.closing.intro;
    }
    const offers = CONTENT.closing.offers
      .map((o) => {
        const owned = this.record.owned.includes(o.id);
        const afford = this.canAfford(o);
        const action = owned
          ? `<span class="sk-owned">✓ STOCKED</span>`
          : `<button type="button" class="btn sk-buy" data-buy="${escapeHtml(o.id)}"
               ${afford.ok ? '' : `disabled title="${escapeHtml(afford.why)}"`}>
               BUY ${afford.ok ? '' : `— ${escapeHtml(afford.why)}`}</button>`;
        return `<div class="sk-offer">
          <div>
            <span class="sk-offer-name">${escapeHtml(o.name)}</span>
            <span class="sk-cost"> — ${o.cost.credibility} CRED · ${o.cost.tokens} TOKENS</span>
          </div>
          <div>${action}</div>
          <p class="sk-offer-pitch">${escapeHtml(o.pitch)}</p>
        </div>`;
      })
      .join('');

    const panel = this.mountBox(`
      <h1>THE BACK COUNTER</h1>
      ${this.signsHtml(true)}
      ${this.balancesHtml()}
      ${offers}
      <div class="sk-proprietor"><span class="who">${escapeHtml(this.proprietorWho)}:</span>
        ${escapeHtml(this.proprietorLine)}</div>
      <div class="sk-actions">
        <button type="button" class="btn" data-action="leave">LEAVE THE SKILLSMITH (L)</button>
      </div>`);

    panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const offer = CONTENT.closing.offers.find((o) => o.id === btn.dataset['buy']);
        if (offer) void this.buy(offer);
      });
    });
    panel
      .querySelector<HTMLButtonElement>('[data-action="leave"]')
      ?.addEventListener('click', () => this.leave());
  }

  private async buy(offer: ClosingOffer): Promise<void> {
    if (this.busy || this.record.owned.includes(offer.id)) return;
    if (!this.canAfford(offer).ok) return;
    this.busy = true;

    actions.applyResourceDelta(
      { credibility: -offer.cost.credibility, tokens: -offer.cost.tokens },
      `Bought: ${offer.name}.`,
    );
    this.record.owned.push(offer.id);
    this.proprietorWho = 'THE PROPRIETOR';
    this.proprietorLine = CONTENT.closing.proprietor.genericSale;

    if (offer.id === 'secret_scrubbing_procedure') {
      // THE TRAP: a skill sold for a Standing Order's job. Advisory prose
      // works four times; the fifth is armed here and fired by the event
      // engine (bbdm:skillsmarket.procedureTrap — shape unchanged).
      actions.setFlag('procedure_trap_armed');
      this.record.procedureTrap = { goodId: offer.id, usesRemaining: 4 };
      this.proprietorLine = CONTENT.closing.proprietor.trapProcedureSale;
      saveRecord(this.record);
      saveRun(getState());
      this.renderClosing();
      await showCurriculumCard('layer_selection');
    } else if (offer.id === 'bargain_stall_route') {
      // THE OTHER TRAP: the unvetted route works — immediately, which is
      // the most suspicious thing about it — and reads the wagon.
      actions.applyResourceDelta({ tokens: 10 }, 'The bargain route works at once. +10 tokens.');
      const champion = this.securityChampion();
      if (champion.alive) {
        actions.applyResourceDelta({ trust: -1 });
        this.proprietorWho = 'THE SECURITY CHAMPION';
        this.proprietorLine = CONTENT.closing.championIntercept.replaceAll(
          '{champion}',
          champion.name,
        );
      } else {
        actions.setFlag('compromised');
        this.proprietorLine = CONTENT.closing.proprietor.trapRouteChampionDead;
      }
      saveRecord(this.record);
      saveRun(getState());
      this.renderClosing();
      await showCurriculumCard('supply_chain_injection');
    } else {
      saveRecord(this.record);
      saveRun(getState());
      this.renderClosing();
    }
    this.busy = false;
  }

  private leave(): void {
    saveRun(getState());
    this.scene.start('Trail');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_LABEL: Record<keyof Required<Effects>, string> = {
  tokens: 'TOKENS',
  credibility: 'CREDIBILITY',
  morale: 'MORALE',
  greenBuilds: 'GREEN BUILDS',
  trust: 'TRUST',
};

function fmtEffects(fx: Effects): string[] {
  const out: string[] = [];
  (Object.keys(RESOURCE_LABEL) as (keyof Required<Effects>)[]).forEach((key) => {
    const v = fx[key];
    if (!v) return;
    const cls = v > 0 ? 'status-ok' : 'status-fail';
    const sign = v > 0 ? '+' : '−';
    out.push(`<span class="${cls}"> ${sign}${Math.abs(v)} ${RESOURCE_LABEL[key]}</span>`);
  });
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
