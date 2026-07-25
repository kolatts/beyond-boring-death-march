/**
 * TitleScene — title, role select (§5.2), party naming, Start.
 *
 * Three steps inside one scene:
 *   MENU  — New march / Continue (if a saved run exists)
 *   ROLE  — pick VP / Staff Engineer / Contractor with arrows + Enter
 *   PARTY — name the five (DOM overlay inputs, defaults provided), Start
 *
 * Keyboard: Up/Down + Enter throughout; Esc backs up a step. The party
 * panel is plain tab-order DOM with visible focus (stylesheet handles it).
 */

import Phaser from 'phaser';
import { GAME_WIDTH, PARTY_TEMPLATE, ROLES, ROLE_ORDER, type RoleId } from '../config';
import { actions } from '../systems/state';
import { LANDMARKS } from '../systems/content';
import { loadRun, loadTombstones, saveRun } from '../systems/save';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import { getState } from '../systems/state';

const PANEL_ID = 'party-naming';
const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const ORANGE = '#f55d08';
const BLUE = '#0da1ff';

type Step = 'menu' | 'role';

export class TitleScene extends Phaser.Scene {
  private step: Step = 'menu';
  private cursor = 0;
  private drawn: Phaser.GameObjects.GameObject[] = [];
  private hasSave = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    this.step = 'menu';
    this.cursor = 0;
    this.hasSave = loadRun() !== null;

    this.add
      .text(GAME_WIDTH / 2, 24, 'BEYOND BORING:\nDEATH MARCH', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: WHITE,
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 70, 'You have died of context exhaustion.', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: GREEN,
      })
      .setOrigin(0.5, 0);

    const graves = loadTombstones().length;
    if (graves > 0) {
      this.add
        .text(GAME_WIDTH / 2, 84, `The trail holds ${graves} grave${graves === 1 ? '' : 's'}.`, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: ORANGE,
        })
        .setOrigin(0.5, 0);
    }

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.move(-1));
      kb.on('keydown-DOWN', () => this.move(1));
      kb.on('keydown-ENTER', () => this.select());
      kb.on('keydown-SPACE', () => this.select());
      kb.on('keydown-ESC', () => this.back());
    }

    this.events.once('shutdown', () => unmountPanel(PANEL_ID));
    this.redraw();
    bus.emit('scene:ready', { scene: 'Title' });
  }

  // -------------------------------------------------------------------------

  private menuItems(): string[] {
    return this.hasSave ? ['NEW MARCH', 'CONTINUE THE MARCH'] : ['NEW MARCH'];
  }

  private move(delta: number): void {
    const count = this.step === 'menu' ? this.menuItems().length : ROLE_ORDER.length;
    this.cursor = (this.cursor + delta + count) % count;
    this.redraw();
  }

  private select(): void {
    if (this.step === 'menu') {
      const item = this.menuItems()[this.cursor];
      if (item === 'CONTINUE THE MARCH') {
        const saved = loadRun();
        if (saved) {
          actions.restoreRun(saved);
          this.scene.start('Trail');
          return;
        }
      }
      this.step = 'role';
      this.cursor = 1; // default Staff Engineer, the balanced pick
      this.redraw();
    } else {
      const role = ROLE_ORDER[this.cursor];
      if (role) this.openPartyPanel(role);
    }
  }

  private back(): void {
    if (this.step === 'role') {
      this.step = 'menu';
      this.cursor = 0;
      this.redraw();
    }
  }

  private text(x: number, y: number, str: string, color: string, size = 9): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, str, { fontFamily: 'monospace', fontSize: `${size}px`, color })
      .setOrigin(0, 0);
    this.drawn.push(t);
    return t;
  }

  private redraw(): void {
    this.drawn.forEach((o) => o.destroy());
    this.drawn = [];

    if (this.step === 'menu') {
      this.menuItems().forEach((label, i) => {
        const selected = i === this.cursor;
        const t = this.text(110, 110 + i * 14, `${selected ? '>' : ' '} ${label}`, selected ? WHITE : GREEN);
        t.setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => {
          this.cursor = i;
          this.select();
        });
      });
      this.text(70, 182, 'ARROWS + ENTER. THAT IS THE WHOLE MANUAL.', BLUE, 7);
    } else {
      this.text(16, 96, 'WHO IS ACCOUNTABLE FOR THIS?', WHITE, 9);
      ROLE_ORDER.forEach((id, i) => {
        const role = ROLES[id];
        const selected = i === this.cursor;
        const t = this.text(
          16,
          112 + i * 22,
          `${selected ? '>' : ' '} ${role.name}  (SCORE x${role.scoreMultiplier})`,
          selected ? WHITE : GREEN,
          8,
        );
        t.setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => {
          this.cursor = i;
          this.select();
        });
        this.text(26, 121 + i * 22, role.tagline, selected ? ORANGE : BLUE, 7);
      });
      this.text(16, 184, 'ESC TO GO BACK', BLUE, 7);
    }
  }

  // -------------------------------------------------------------------------
  // Party naming — DOM overlay (5 inputs, defaults provided)
  // -------------------------------------------------------------------------

  private openPartyPanel(role: RoleId): void {
    const panel = mountPanel(PANEL_ID);
    panel.setAttribute(
      'style',
      [
        'position:absolute',
        'left:50%',
        'top:50%',
        'transform:translate(-50%,-50%)',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'background:#000000',
        'border:2px solid #1bcb01',
        'padding:16px 20px',
        'font-family:monospace',
        'max-height:90vh',
        'overflow-y:auto',
      ].join(';'),
    );

    const heading = document.createElement('div');
    heading.textContent = `NAME THE PARTY — ${ROLES[role].name}`;
    heading.setAttribute('style', 'color:#ffffff;font-size:14px;letter-spacing:0.08em;');
    panel.appendChild(heading);

    const inputs: HTMLInputElement[] = [];
    PARTY_TEMPLATE.forEach((slot, i) => {
      const row = document.createElement('label');
      row.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;color:#0da1ff;font-size:11px;');
      row.textContent = slot.title;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 24;
      input.value = slot.defaultName;
      input.setAttribute('aria-label', `Name for ${slot.title}`);
      input.setAttribute(
        'style',
        'background:#000;color:#fff;border:2px solid #1bcb01;font-family:monospace;font-size:13px;padding:4px 8px;width:260px;',
      );
      row.appendChild(input);
      panel.appendChild(row);
      inputs[i] = input;
    });

    const buttonRow = document.createElement('div');
    buttonRow.setAttribute('style', 'display:flex;gap:10px;margin-top:6px;');

    const startBtn = document.createElement('button');
    startBtn.className = 'btn';
    startBtn.textContent = 'Begin the march';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = 'Back';

    buttonRow.append(startBtn, backBtn);
    panel.appendChild(buttonRow);

    const start = (): void => {
      const names = inputs.map((el) => el.value);
      unmountPanel(PANEL_ID);
      actions.newRun(role, names);
      saveRun(getState());
      // Legacy Junction sits at mile 0: show its arrival screen first.
      const first = LANDMARKS[0];
      if (first && first.mile === 0) {
        actions.advanceLandmark();
        saveRun(getState());
        this.scene.start('Landmark', { landmarkId: first.id });
      } else {
        this.scene.start('Trail');
      }
    };

    startBtn.addEventListener('click', start);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target !== backBtn) start();
    });
    backBtn.addEventListener('click', () => {
      unmountPanel(PANEL_ID);
      this.redraw();
    });

    inputs[0]?.focus();
    inputs[0]?.select();
  }
}
