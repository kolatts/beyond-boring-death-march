/**
 * TitleScene — title, role select (§5.2), party naming, Start — plus the
 * social surfaces:
 *
 *   THE TRAIL OF THE DEAD — a phosphor-green marquee of recent real-player
 *   deaths from the graveyard API (reduced-motion: a static list of 3).
 *   HALL OF FAME — live top scores (GET /scores), offline-tolerant.
 *   FIELD JOURNAL — curriculum cards collected this browser.
 *
 * Steps inside one scene:
 *   MENU  — New march / Continue / Hall of Fame / Field Journal
 *   ROLE  — pick VP / Staff Engineer / Contractor with arrows + Enter
 *   FAME  — the hall of fame table
 *   JOURNAL — collected field notes; Enter re-reads one
 *   PARTY — name the five (DOM overlay inputs, defaults provided), Start
 *
 * Keyboard: Up/Down + Enter throughout; Esc backs up a step.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PARTY_TEMPLATE, ROLES, ROLE_ORDER, type RoleId } from '../config';
import { coverBackdrop, queueArt } from '../systems/art';
import { setBed } from '../systems/audio';
import { isCoarse, padHit } from '../ui/touch';
import { actions } from '../systems/state';
import { LANDMARKS } from '../systems/content';
import { loadRun, loadTombstones, saveRun } from '../systems/save';
import { fetchRecentDeaths, fetchTopScores, type RemoteScore } from '../systems/social';
import { getCard, journalEntries, showCurriculumCard, isFieldNoteOpen } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import { getState } from '../systems/state';

const PANEL_ID = 'party-naming';
const TICKER_ID = 'death-ticker';
const TICKER_STYLE_ID = 'death-ticker-styles';
const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const ORANGE = '#f55d08';
const BLUE = '#0da1ff';
const VIOLET = '#bb36ff';

type Step = 'menu' | 'role' | 'fame' | 'journal';

const TICKER_CSS = `
#panel-${TICKER_ID} {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  border-top: 1px solid #1bcb01;
  font-family: var(--font-mono, monospace);
  color: #1bcb01;
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  white-space: nowrap;
  text-shadow: 0 0 6px rgba(27, 203, 1, 0.75), 0 0 18px rgba(27, 203, 1, 0.35);
  padding: 3px 0;
}
#panel-${TICKER_ID} .ticker-track {
  display: inline-block;
  padding-left: 100vw;
  animation: bbdm-ticker-scroll 45s linear infinite;
}
@keyframes bbdm-ticker-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}
#panel-${TICKER_ID} .ticker-static {
  white-space: normal;
  padding: 2px 12px;
}
#panel-${TICKER_ID} .ticker-title { color: #ffffff; }
#panel-${TICKER_ID} .ticker-mile { color: #f55d08; text-shadow: none; }
#panel-${TICKER_ID} .ticker-epitaph { color: #0da1ff; text-shadow: none; }
@media (prefers-reduced-motion: reduce) {
  #panel-${TICKER_ID} .ticker-track { animation: none; padding-left: 12px; }
}
`;

export class TitleScene extends Phaser.Scene {
  private step: Step = 'menu';
  private cursor = 0;
  private drawn: Phaser.GameObjects.GameObject[] = [];
  private hasSave = false;
  private fameScores: RemoteScore[] | null = null;
  private fameLoaded = false;
  /** True while the party-naming DOM panel owns input; Phaser keys go inert. */
  private panelOpen = false;

  constructor() {
    super('Title');
  }

  preload(): void {
    // Lazy per-scene art (spec §2 load budget): the title key art loads
    // here, not in BootScene, and only once per session.
    queueArt(this, { 'title-art': 'title-key-art.png' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    this.step = 'menu';
    this.cursor = 0;
    this.panelOpen = false;
    setBed(null);

    // Title key art backdrop, letterboxed to cover; veils keep text legible.
    if (coverBackdrop(this, 'title-art', GAME_WIDTH, GAME_HEIGHT)) {
      this.add.rectangle(GAME_WIDTH / 2, 44, GAME_WIDTH, 88, 0x000000, 0.55);
      this.add.rectangle(GAME_WIDTH / 2, 144, GAME_WIDTH, 112, 0x000000, 0.78);
    }
    this.hasSave = loadRun() !== null;
    this.fameLoaded = false;
    this.fameScores = null;

    this.add
      .text(GAME_WIDTH / 2, 20, 'BEYOND BORING:\nDEATH MARCH', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: WHITE,
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 66, 'You have died of context exhaustion.', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: GREEN,
      })
      .setOrigin(0.5, 0);

    const graves = loadTombstones().length;
    if (graves > 0) {
      this.add
        .text(GAME_WIDTH / 2, 80, `The trail holds ${graves} grave${graves === 1 ? '' : 's'}.`, {
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

    this.mountTicker();
    this.events.once('shutdown', () => {
      unmountPanel(PANEL_ID);
      unmountPanel(TICKER_ID);
    });
    this.redraw();
    bus.emit('scene:ready', { scene: 'Title' });
  }

  // -------------------------------------------------------------------------
  // THE TRAIL OF THE DEAD — live death ticker
  // -------------------------------------------------------------------------

  private mountTicker(): void {
    if (!document.getElementById(TICKER_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = TICKER_STYLE_ID;
      style.textContent = TICKER_CSS;
      document.head.appendChild(style);
    }
    const panel = mountPanel(TICKER_ID);
    panel.setAttribute('aria-label', 'The Trail of the Dead — recent deaths');

    void fetchRecentDeaths().then((deaths) => {
      // The scene may have moved on while the request was out.
      if (!document.getElementById(`panel-${TICKER_ID}`)) return;
      if (!deaths || deaths.length === 0) {
        panel.remove(); // Offline: no ticker. The menu never waited on it.
        return;
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const fmt = (d: (typeof deaths)[number]): string => {
        const epitaph = d.epitaph ? ` — <span class="ticker-epitaph">&quot;${escapeHtml(d.epitaph)}&quot;</span>` : '';
        return `<span class="ticker-title">${escapeHtml(d.name)}</span> · ${escapeHtml(d.cause)} · <span class="ticker-mile">MILE ${Math.floor(d.mile)}</span>${epitaph}`;
      };

      if (reduced) {
        const rows = deaths.slice(0, 3).map((d) => `<div>${fmt(d)}</div>`).join('');
        panel.innerHTML = `<div class="ticker-static"><span class="ticker-title">THE TRAIL OF THE DEAD</span>${rows}</div>`;
      } else {
        const items = deaths.slice(0, 20).map(fmt).join(' &nbsp;✦&nbsp; ');
        panel.innerHTML = `<div class="ticker-track"><span class="ticker-title">THE TRAIL OF THE DEAD:</span> &nbsp; ${items}</div>`;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Menu plumbing
  // -------------------------------------------------------------------------

  private menuItems(): string[] {
    const items = ['NEW MARCH'];
    if (this.hasSave) items.push('CONTINUE THE MARCH');
    items.push('HALL OF FAME', 'FIELD JOURNAL');
    return items;
  }

  private optionCount(): number {
    switch (this.step) {
      case 'menu':
        return this.menuItems().length;
      case 'role':
        return ROLE_ORDER.length;
      case 'journal':
        return Math.max(1, journalEntries().length);
      default:
        return 1;
    }
  }

  private move(delta: number): void {
    if (isFieldNoteOpen() || this.panelOpen) return;
    const count = this.optionCount();
    if (count <= 1) return;
    this.cursor = (this.cursor + delta + count) % count;
    this.redraw();
  }

  private select(): void {
    if (isFieldNoteOpen() || this.panelOpen) return;
    if (this.step === 'menu') {
      const item = this.menuItems()[this.cursor];
      if (item === 'CONTINUE THE MARCH') {
        const saved = loadRun();
        if (saved) {
          actions.restoreRun(saved);
          saveRun(getState()); // run-start hook: kicks the graveyard sync
          this.scene.start('Trail');
          return;
        }
      }
      if (item === 'HALL OF FAME') {
        this.step = 'fame';
        this.cursor = 0;
        this.loadFame();
        this.redraw();
        return;
      }
      if (item === 'FIELD JOURNAL') {
        this.step = 'journal';
        this.cursor = 0;
        this.redraw();
        return;
      }
      this.step = 'role';
      this.cursor = 1; // default Staff Engineer, the balanced pick
      this.redraw();
    } else if (this.step === 'role') {
      const role = ROLE_ORDER[this.cursor];
      if (role) this.openPartyPanel(role);
    } else if (this.step === 'journal') {
      const id = journalEntries()[this.cursor];
      if (id) void showCurriculumCard(id);
    } else if (this.step === 'fame') {
      this.back();
    }
  }

  private back(): void {
    if (isFieldNoteOpen() || this.panelOpen) return;
    if (this.step !== 'menu') {
      this.step = 'menu';
      this.cursor = 0;
      this.redraw();
    }
  }

  private loadFame(): void {
    void fetchTopScores().then((scores) => {
      this.fameScores = scores;
      this.fameLoaded = true;
      if (this.scene.isActive() && this.step === 'fame') this.redraw();
    });
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

    switch (this.step) {
      case 'menu':
        this.drawMenu();
        break;
      case 'role':
        this.drawRoles();
        break;
      case 'fame':
        this.drawFame();
        break;
      case 'journal':
        this.drawJournal();
        break;
    }
  }

  /** Tappable back affordance (touch has no Esc key). */
  private backLink(y: number, label: string): void {
    const t = this.text(16, y, label, BLUE, 7);
    padHit(t, 12, 3, 14);
    t.on('pointerdown', () => this.back());
  }

  private drawMenu(): void {
    // Touch: taller pitch + hit bands capped at the pitch so adjacent
    // rows can never both claim a tap.
    const coarse = isCoarse();
    const pitch = coarse ? 17 : 13;
    const y0 = coarse ? 92 : 96;
    this.menuItems().forEach((label, i) => {
      const selected = i === this.cursor;
      const t = this.text(
        coarse ? 100 : 110,
        y0 + i * pitch,
        `${selected ? '>' : ' '} ${label}`,
        selected ? WHITE : GREEN,
        coarse ? 10 : 9,
      );
      padHit(t, coarse ? 40 : 8, 4, pitch - 1);
      t.on('pointerdown', () => {
        this.cursor = i;
        this.select();
      });
    });
    this.text(
      70,
      178,
      coarse ? 'TAP AN OPTION. THAT IS THE WHOLE MANUAL.' : 'ARROWS + ENTER. THAT IS THE WHOLE MANUAL.',
      BLUE,
      7,
    );
  }

  private drawRoles(): void {
    const coarse = isCoarse();
    const pitch = coarse ? 26 : 22;
    const y0 = coarse ? 104 : 108;
    this.text(16, 92, 'WHO IS ACCOUNTABLE FOR THIS?', WHITE, 9);
    ROLE_ORDER.forEach((id, i) => {
      const role = ROLES[id];
      const selected = i === this.cursor;
      const t = this.text(
        16,
        y0 + i * pitch,
        `${selected ? '>' : ' '} ${role.name}  (SCORE x${role.scoreMultiplier})`,
        selected ? WHITE : GREEN,
        8,
      );
      // Band covers the row AND its tagline: one thumb target per role.
      padHit(t, coarse ? 40 : 8, 4, pitch - 1);
      t.on('pointerdown', () => {
        this.cursor = i;
        this.select();
      });
      this.text(26, y0 + 9 + i * pitch, role.tagline, selected ? ORANGE : BLUE, 7);
    });
    this.backLink(184, coarse ? '< BACK' : 'ESC TO GO BACK');
  }

  private drawFame(): void {
    this.text(16, 92, 'HALL OF FAME — ALL PARTIES, ALL TRAILS', WHITE, 9);
    if (!this.fameLoaded) {
      this.text(16, 108, 'Consulting the record...', GREEN, 8);
    } else if (!this.fameScores) {
      this.text(16, 108, 'The hall of fame is unreachable. The scores', ORANGE, 8);
      this.text(16, 118, 'exist. The network has filed an exception.', ORANGE, 8);
    } else if (this.fameScores.length === 0) {
      this.text(16, 108, 'No party has reached Production yet.', GREEN, 8);
      this.text(16, 118, 'The record is open. So is the position.', BLUE, 8);
    } else {
      this.fameScores.slice(0, 7).forEach((s, i) => {
        const name = s.name.slice(0, 14).padEnd(14);
        const glyph = s.businessDeadlineMet ? '✓' : '×';
        this.text(
          16,
          106 + i * 10,
          `${String(i + 1).padStart(2)}. ${name} ${String(s.score).padStart(6)}  ${glyph} DAY ${s.days}`,
          i === 0 ? WHITE : GREEN,
          7,
        );
      });
    }
    this.backLink(184, isCoarse() ? '< BACK' : 'ESC TO GO BACK');
  }

  private drawJournal(): void {
    const coarse = isCoarse();
    this.text(16, 92, 'FIELD JOURNAL — NOTES COLLECTED', WHITE, 9);
    const ids = journalEntries();
    if (ids.length === 0) {
      this.text(16, 108, 'No field notes yet. Lessons are issued on the', GREEN, 8);
      this.text(16, 118, 'trail, shortly after each joke lands on you.', GREEN, 8);
    } else {
      // Window of entries around the cursor (fewer, taller rows on touch).
      const rows = coarse ? 5 : 7;
      const pitch = coarse ? 14 : 10;
      const start = Math.max(0, Math.min(this.cursor - Math.floor(rows / 2), ids.length - rows));
      ids.slice(start, start + rows).forEach((id, i) => {
        const idx = start + i;
        const card = getCard(id);
        const label = `${card ? card.n : '??'} — ${id.replaceAll('_', ' ').toUpperCase()}`;
        const selected = idx === this.cursor;
        const t = this.text(
          16,
          106 + i * pitch,
          `${selected ? '>' : ' '} ${label}`,
          selected ? WHITE : GREEN,
          coarse ? 8 : 7,
        );
        padHit(t, coarse ? 24 : 4, 1, pitch - 1);
        t.on('pointerdown', () => {
          this.cursor = idx;
          this.select();
        });
      });
      if (ids.length > rows) this.text(260, 92, `${this.cursor + 1}/${ids.length}`, VIOLET, 7);
    }
    this.backLink(184, coarse ? 'TAP A NOTE TO RE-READ · < BACK' : 'ENTER TO RE-READ · ESC TO GO BACK');
  }

  // -------------------------------------------------------------------------
  // Party naming — DOM overlay (5 inputs, defaults provided)
  // -------------------------------------------------------------------------

  private openPartyPanel(role: RoleId): void {
    // The DOM panel owns input now. Without this guard, the Enter that a
    // player presses inside an input would ALSO reach Phaser's window-level
    // keydown handler, re-run select(), and remount the panel mid-keystroke
    // (discarding typed names and replacing the button under the pointer).
    this.panelOpen = true;
    const panel = mountPanel(PANEL_ID);
    // Every mount registers its own cleanup: whatever order shutdown and
    // remounts interleave in, no party panel outlives the scene.
    this.events.once('shutdown', () => unmountPanel(PANEL_ID));
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
      // panelOpen stays TRUE: the same Enter keydown that triggered this
      // continues to Phaser's window-level handler in the same dispatch,
      // and select() must stay inert or it remounts the panel over the
      // next scene (the leaked-panel bug). create() resets the flag.
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
      this.panelOpen = false;
      unmountPanel(PANEL_ID);
      this.redraw();
    });

    inputs[0]?.focus();
    inputs[0]?.select();
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
