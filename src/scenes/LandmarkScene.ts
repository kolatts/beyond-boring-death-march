/**
 * LandmarkScene — arrival + landmark life (Wave 3, spec §7.8 + §9).
 *
 * Phased flow, fully keyboard-driven (Up/Down move, Enter/Space select):
 *
 *  1. blurb     — landmark name + snarky blurb (content landmarks.json)
 *  2. npcIntro  — the landmark's NPC introduces themselves (npcs.json)
 *  3. npcTalk   — the NPC dispenses two pieces of advice, one genuinely
 *                 correct and one confidently wrong, UNMARKED and in
 *                 shuffled order (§7.8) — then three dialogue options
 *  4. npcResult — the chosen option's response + resource effects
 *  5. bb        — Boring & Brilliant's exchange (boring-brilliant.json,
 *                 portraits from public/assets/art) with a HEED choice;
 *                 exactly one is right for THIS landmark (marked in data,
 *                 never in prose). Their deadpan reactions appear at the
 *                 first campfire after the minigame (TrailScene).
 *  6. depart    — "> APPROACH" into the landmark's minigame as before
 *
 * Missing content for a landmark skips its phase gracefully.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, TOTAL_MILES } from '../config';
import { LANDMARKS, bbForLandmark, npcForLandmark } from '../systems/content';
import type { BBExchange, EventEffects, Landmark, Npc, NpcOption } from '../systems/content';
import { applyEventEffects } from '../systems/eventEngine';
import { actions, getState, hasRun } from '../systems/state';
import { saveRun } from '../systems/save';
import { queueArt } from '../systems/art';
import { bus } from '../ui/overlay';
import { padHit } from '../ui/touch';
import { MINIGAMES } from './index';

const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const BLUE = '#0da1ff';
const ORANGE = '#f55d08';

/** HEED outcome deltas (§7.8: choices spend or earn Credibility/Morale).
 * Small on purpose — the exchange teaches reading the situation, not
 * farming the robots. */
const HEED_CORRECT: EventEffects = { credibility: 2, morale: 2 };
const HEED_WRONG: EventEffects = { morale: -2, credibility: -1 };

type Phase = 'blurb' | 'npcIntro' | 'npcTalk' | 'npcResult' | 'bb' | 'depart';

interface MenuItem {
  label: string;
  onSelect: () => void;
}

export class LandmarkScene extends Phaser.Scene {
  private landmark: Landmark | null = null;
  private npc: Npc | undefined;
  private bb: BBExchange | undefined;
  private phase: Phase = 'blurb';
  private menu: MenuItem[] = [];
  private menuIndex = 0;
  private drawn: Phaser.GameObjects.GameObject[] = [];
  /** Set for phase npcResult. */
  private npcChosen: NpcOption | null = null;
  /** Advice order for npcTalk, shuffled once per visit (seeded rand). */
  private adviceCorrectFirst = true;

  constructor() {
    super('Landmark');
  }

  init(data: { landmarkId?: string }): void {
    this.landmark = LANDMARKS.find((l) => l.id === data.landmarkId) ?? null;
    this.phase = 'blurb';
    this.npcChosen = null;
  }

  preload(): void {
    // Lazy per-scene art: the mascot portraits plus THIS landmark's
    // vignette only — arriving at Fort Prompt never downloads Production.
    queueArt(this, {
      'bb-boring': 'boring-portrait.png',
      'bb-brilliant': 'brilliant-portrait.png',
    });
    const lm = this.landmark;
    if (lm) {
      const idx = LANDMARKS.findIndex((l) => l.id === lm.id);
      if (idx >= 0) {
        queueArt(this, {
          [`lm-${lm.id}`]: `landmark-${String(idx + 1).padStart(2, '0')}-${lm.id.replaceAll('_', '-')}.png`,
        });
      }
    }
  }

  create(): void {
    if (!hasRun() || !this.landmark) {
      this.scene.start(hasRun() ? 'Trail' : 'Title');
      return;
    }
    this.cameras.main.setBackgroundColor('#000000');
    this.npc = npcForLandmark(this.landmark.id);
    this.bb = bbForLandmark(this.landmark.id);
    this.adviceCorrectFirst = actions.rand() < 0.5;

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.moveCursor(-1));
      kb.on('keydown-DOWN', () => this.moveCursor(1));
      kb.on('keydown-ENTER', () => this.select());
      kb.on('keydown-SPACE', () => this.select());
    }

    this.render();
    bus.emit('scene:ready', { scene: 'Landmark' });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private moveCursor(delta: number): void {
    if (this.menu.length < 2) return;
    this.menuIndex = (this.menuIndex + delta + this.menu.length) % this.menu.length;
    this.render();
  }

  private select(): void {
    const item = this.menu[this.menuIndex];
    if (item) item.onSelect();
  }

  private goto(phase: Phase): void {
    this.phase = phase;
    this.menuIndex = 0;
    this.render();
  }

  private afterBlurb(): void {
    if (this.npc) this.goto('npcIntro');
    else this.afterNpc();
  }

  private afterNpc(): void {
    if (this.bb) this.goto('bb');
    else this.goto('depart');
  }

  // -------------------------------------------------------------------------
  // Phase actions
  // -------------------------------------------------------------------------

  private chooseNpcOption(option: NpcOption): void {
    this.npcChosen = option;
    const notices = applyEventEffects(option.effects, false);
    if (notices.length > 0) actions.log(...notices);
    saveRun(getState());
    this.goto('npcResult');
  }

  private heed(which: 'boring' | 'brilliant'): void {
    const bb = this.bb;
    const lm = this.landmark;
    if (!bb || !lm) {
      this.goto('depart');
      return;
    }
    const correct = bb.correct === which;
    applyEventEffects(correct ? HEED_CORRECT : HEED_WRONG, false);
    // The campfire on the far side of the minigame shows both reactions.
    actions.setLastLandmarkHeed({ landmarkId: lm.id, heeded: which, correct });
    saveRun(getState());
    this.goto('depart');
  }

  private continueOn(): void {
    const lm = this.landmark;
    if (!lm) {
      this.scene.start('Trail');
      return;
    }
    if (lm.mile >= TOTAL_MILES) {
      this.scene.start('Score');
      return;
    }
    const minigame = MINIGAMES[lm.mechanic];
    if (minigame) {
      this.scene.start(minigame.sceneKey, {
        landmarkId: lm.id,
        mechanic: lm.mechanic,
      });
    } else {
      this.scene.start('Trail');
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private text(
    x: number,
    y: number,
    str: string,
    color: string,
    size = 7,
    wrapWidth = GAME_WIDTH - 16,
  ): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, str, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        lineSpacing: 2,
        wordWrap: { width: wrapWidth },
      })
      .setOrigin(0, 0);
    this.drawn.push(t);
    return t;
  }

  private centeredText(y: number, str: string, color: string, size: number): Phaser.GameObjects.Text {
    const t = this.add
      .text(GAME_WIDTH / 2, y, str, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 16 },
      })
      .setOrigin(0.5, 0);
    this.drawn.push(t);
    return t;
  }

  /** Render the phase's menu starting at y. Single items center at 190. */
  private renderMenu(items: MenuItem[], y: number): void {
    this.menu = items;
    if (items.length === 1) {
      const only = items[0];
      if (!only) return;
      const t = this.add
        .text(GAME_WIDTH / 2, 190, `> ${only.label}`, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: WHITE,
        })
        .setOrigin(0.5, 0.5);
      padHit(t, 20, 6);
      t.on('pointerdown', () => only.onSelect());
      this.drawn.push(t);
      return;
    }
    items.forEach((item, i) => {
      const selected = i === this.menuIndex;
      const t = this.text(
        12,
        y + i * 11,
        `${selected ? '>' : ' '} ${item.label}`,
        selected ? WHITE : GREEN,
        7,
        GAME_WIDTH - 24,
      );
      padHit(t, 8, 1);
      t.on('pointerdown', () => {
        this.menuIndex = i;
        item.onSelect();
      });
    });
  }

  private effectSummary(effects: EventEffects): string {
    const parts: string[] = [];
    const push = (v: number | undefined, label: string) => {
      if (v) parts.push(`${v > 0 ? '+' : ''}${v} ${label}`);
    };
    push(effects.credibility, 'CRED');
    push(effects.morale, 'MORALE');
    push(effects.tokens, 'TOKENS');
    push(effects.trust, 'TRUST');
    push(effects.context, 'CONTEXT');
    push(effects.greenBuilds, 'BUILDS');
    if (effects.days) parts.push(`${effects.days} DAY${effects.days === 1 ? '' : 'S'}`);
    return parts.join('  ');
  }

  private render(): void {
    this.drawn.forEach((o) => o.destroy());
    this.drawn = [];
    const lm = this.landmark;
    if (!lm) return;

    switch (this.phase) {
      case 'blurb':
        this.renderBlurb(lm);
        break;
      case 'npcIntro':
        this.renderNpcIntro();
        break;
      case 'npcTalk':
        this.renderNpcTalk();
        break;
      case 'npcResult':
        this.renderNpcResult();
        break;
      case 'bb':
        this.renderBB();
        break;
      case 'depart':
        this.renderDepart(lm);
        break;
    }
  }

  /** The landmark's generated vignette, right of the text. 0 if absent. */
  private drawVignette(lm: Landmark, cx: number, cy: number, size: number): boolean {
    const key = `lm-${lm.id}`;
    if (!this.textures.exists(key)) return false;
    const img = this.add.image(cx, cy, key).setDisplaySize(size, size);
    const border = this.add.graphics();
    border.lineStyle(1, 0xffffff, 0.55);
    border.strokeRect(cx - size / 2 - 1, cy - size / 2 - 1, size + 2, size + 2);
    this.drawn.push(img, border);
    return true;
  }

  private renderBlurb(lm: Landmark): void {
    this.centeredText(6, lm.name.toUpperCase(), WHITE, 12);
    this.centeredText(20, `MILE ${lm.mile}`, BLUE, 8);
    if (this.drawVignette(lm, 268, 78, 88)) {
      this.text(8, 34, lm.blurb, GREEN, 7, 208);
    } else {
      this.text(8, 34, lm.blurb, GREEN);
    }
    const label = this.npc ? `TALK TO ${this.npc.name.toUpperCase()}` : this.departLabel(lm);
    this.renderMenu([{ label, onSelect: () => this.afterBlurb() }], 0);
  }

  private renderNpcIntro(): void {
    const npc = this.npc;
    if (!npc) {
      this.afterNpc();
      return;
    }
    this.centeredText(6, npc.name.toUpperCase(), WHITE, 10);
    this.text(8, 22, npc.intro, GREEN);
    this.renderMenu([{ label: 'ASK AROUND', onSelect: () => this.goto('npcTalk') }], 0);
  }

  private renderNpcTalk(): void {
    const npc = this.npc;
    if (!npc) {
      this.afterNpc();
      return;
    }
    this.centeredText(4, npc.name.toUpperCase(), WHITE, 9);
    // Two pieces of advice: one true, one confidently wrong. Unmarked,
    // shuffled. The player must tell them apart (§7.8).
    const first = this.adviceCorrectFirst ? npc.advice.correct : npc.advice.wrong;
    const second = this.adviceCorrectFirst ? npc.advice.wrong : npc.advice.correct;
    const a = this.text(8, 16, `"${first}"`, GREEN);
    const b = this.text(8, 16 + a.height + 4, `"${second}"`, GREEN);
    const menuY = 16 + a.height + b.height + 12;
    this.renderMenu(
      npc.options.map((opt) => ({
        label: opt.label,
        onSelect: () => this.chooseNpcOption(opt),
      })),
      menuY,
    );
  }

  private renderNpcResult(): void {
    const npc = this.npc;
    const chosen = this.npcChosen;
    if (!npc || !chosen) {
      this.afterNpc();
      return;
    }
    this.centeredText(6, npc.name.toUpperCase(), WHITE, 10);
    const r = this.text(8, 22, chosen.response, GREEN);
    const summary = this.effectSummary(chosen.effects);
    if (summary) this.text(8, 26 + r.height, summary, ORANGE);
    this.renderMenu([{ label: 'CONTINUE', onSelect: () => this.afterNpc() }], 0);
  }

  private renderBB(): void {
    const bb = this.bb;
    if (!bb) {
      this.goto('depart');
      return;
    }
    this.centeredText(2, 'THE ROBOTS WEIGH IN', WHITE, 9);

    const textX = 36;
    const wrap = GAME_WIDTH - textX - 8;
    let y = 16;

    if (this.textures.exists('bb-boring')) {
      const img = this.add.image(18, y + 12, 'bb-boring').setDisplaySize(26, 26);
      this.drawn.push(img);
    }
    const boring = this.text(textX, y, `BORING: ${bb.boring}`, GREEN, 7, wrap);
    y += Math.max(30, boring.height + 6);

    if (this.textures.exists('bb-brilliant')) {
      const img = this.add.image(18, y + 12, 'bb-brilliant').setDisplaySize(26, 26);
      this.drawn.push(img);
    }
    const brilliant = this.text(textX, y, `BRILLIANT: ${bb.brilliant}`, BLUE, 7, wrap);
    y += Math.max(30, brilliant.height + 8);

    this.renderMenu(
      [
        { label: 'HEED BORING', onSelect: () => this.heed('boring') },
        { label: 'HEED BRILLIANT', onSelect: () => this.heed('brilliant') },
      ],
      Math.min(y, 172),
    );
  }

  private departLabel(lm: Landmark): string {
    if (lm.mile >= TOTAL_MILES) return 'ENTER PRODUCTION';
    return MINIGAMES[lm.mechanic] ? 'APPROACH' : 'CONTINUE THE MARCH';
  }

  private renderDepart(lm: Landmark): void {
    this.centeredText(6, lm.name.toUpperCase(), WHITE, 12);
    this.centeredText(20, `MILE ${lm.mile}`, BLUE, 8);
    this.drawVignette(lm, 160, 112, 92);
    // The heed's resource effect is applied silently; whether it was the
    // right call surfaces at the campfire (and on the bars). No spoilers.
    const heed = getState().lastLandmarkHeed;
    if (heed && heed.landmarkId === lm.id) {
      this.centeredText(40, `YOU HEED ${heed.heeded.toUpperCase()}. THE TRAIL WILL GRADE IT.`, GREEN, 8);
    }
    this.renderMenu([{ label: this.departLabel(lm), onSelect: () => this.continueOn() }], 0);
  }
}
