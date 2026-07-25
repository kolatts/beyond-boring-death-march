/**
 * DeathScene — the tombstone.
 *
 * Cause line (from content deaths.json when it exists, else the generic
 * cause passed by the killing system), a player-typed epitaph (DOM
 * overlay input, max 120 chars), tombstone persistence (survives new
 * runs; economy.ts surfaces old graves at their mile marker), and
 * "Start again" back to Title.
 *
 * Keyboard: the epitaph input autofocuses; Enter carves it.
 */

import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { deathLineFor } from '../systems/content';
import { actions, getState, hasRun, type Tombstone } from '../systems/state';
import { addTombstone, clearRun } from '../systems/save';
import { postDeath, roleApiName } from '../systems/social';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';

const PANEL_ID = 'epitaph';
const WHITE = '#ffffff';
const VIOLET = '#bb36ff';
const GREEN = '#1bcb01';

export class DeathScene extends Phaser.Scene {
  private cause = 'THE TRAIL';
  private carved = false;

  constructor() {
    super('Death');
  }

  init(data: { cause?: string }): void {
    this.cause = data.cause ?? 'THE TRAIL';
    this.carved = false;
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    const s = getState();
    this.cameras.main.setBackgroundColor('#000000');

    const line = deathLineFor(`YOU HAVE DIED OF ${this.cause}.`, actions.rand());

    this.add
      .text(GAME_WIDTH / 2, 24, 'HERE LIES YOUR SPRINT', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: WHITE,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 48, line, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: VIOLET,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 24 },
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 80, `MILE ${Math.floor(s.mile)} — DAY ${s.day}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: GREEN,
      })
      .setOrigin(0.5, 0);

    this.mountEpitaphPanel(line);
    // Phaser does not auto-call a shutdown() method; hook the event.
    this.events.once('shutdown', () => unmountPanel(PANEL_ID));
    bus.emit('scene:ready', { scene: 'Death' });
  }

  /**
   * DOM overlay: epitaph input + carve button. Inline styles only — the
   * shared stylesheet belongs to the UI wave; this panel must not depend
   * on classes that may change under it (beyond the existing .btn).
   */
  private mountEpitaphPanel(deathLine: string): void {
    const panel = mountPanel(PANEL_ID);
    panel.setAttribute(
      'style',
      [
        'position:absolute',
        'left:50%',
        'top:55%',
        'transform:translate(-50%,0)',
        'display:flex',
        'flex-direction:column',
        'gap:12px',
        'align-items:center',
        'font-family:monospace',
      ].join(';'),
    );

    const label = document.createElement('label');
    label.htmlFor = 'epitaph-input';
    label.textContent = 'Carve an epitaph (120 chars):';
    label.setAttribute('style', 'color:#1bcb01;font-size:14px;');

    const input = document.createElement('input');
    input.id = 'epitaph-input';
    input.type = 'text';
    input.maxLength = 120;
    input.placeholder = 'It compiled locally.';
    input.setAttribute(
      'style',
      [
        'background:#000000',
        'color:#ffffff',
        'border:2px solid #1bcb01',
        'font-family:monospace',
        'font-size:14px',
        'padding:6px 10px',
        'width:min(70vw,420px)',
      ].join(';'),
    );

    const carveBtn = document.createElement('button');
    carveBtn.className = 'btn';
    carveBtn.textContent = 'Carve the epitaph';

    const againBtn = document.createElement('button');
    againBtn.className = 'btn';
    againBtn.textContent = 'Start again';
    againBtn.hidden = true;

    let carvedAt = 0;
    const carve = (): void => {
      if (this.carved) return;
      this.carved = true;
      carvedAt = performance.now();
      const s = getState();
      const epitaph = input.value.trim().slice(0, 120) || input.placeholder;
      const tombstone: Tombstone = {
        mile: Math.floor(s.mile),
        day: s.day,
        cause: deathLine,
        epitaph,
        role: s.role,
        when: new Date().toISOString(),
      };
      addTombstone(tombstone);
      clearRun();
      input.disabled = true;
      carveBtn.hidden = true;
      againBtn.hidden = false;
      againBtn.focus();

      // Send the grave to the shared graveyard. Fire-and-forget: silent
      // on failure, and the confirmation line appears only on a real 2xx
      // (spec: it is the API's own line, not ours to fake).
      const leaderName = s.party[0]?.name ?? 'Anonymous';
      void postDeath({
        name: leaderName,
        cause: deathLine,
        mile: tombstone.mile,
        epitaph,
        role: roleApiName(s.role),
        days: Math.max(1, s.day),
      }).then((ok) => {
        if (!ok || !this.scene.isActive()) return;
        this.add
          .text(GAME_WIDTH / 2, 96, 'Your death has been recorded. The trail continues without you.', {
            fontFamily: 'monospace',
            fontSize: '7px',
            color: GREEN,
            align: 'center',
            wordWrap: { width: GAME_WIDTH - 24 },
          })
          .setOrigin(0.5, 0);
      });
    };

    carveBtn.addEventListener('click', carve);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') carve();
    });
    againBtn.addEventListener('click', () => {
      // The Enter that carved can activate this freshly-focused button in
      // the same dispatch; ignore activations inside the carve keypress.
      if (performance.now() - carvedAt < 250) return;
      unmountPanel(PANEL_ID);
      actions.endRun();
      this.scene.start('Title');
    });

    panel.append(label, input, carveBtn, againBtn);
    input.focus();
  }
}
