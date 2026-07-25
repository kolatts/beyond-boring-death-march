/**
 * LandmarkScene — arrival stub (Phase 1).
 *
 * Landmark name + blurb (from src/content/landmarks.json via
 * systems/content.ts) + Continue. Later waves attach minigames, NPC
 * dialogue, and Curriculum Cards per the landmark's `mechanic` field.
 *
 * Keyboard: Enter/Space continues. Production (mile 2000) continues to
 * the Score screen instead of the Trail.
 */

import Phaser from 'phaser';
import { GAME_WIDTH, TOTAL_MILES } from '../config';
import { LANDMARKS, type Landmark } from '../systems/content';
import { hasRun } from '../systems/state';
import { bus } from '../ui/overlay';

const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const BLUE = '#0da1ff';

export class LandmarkScene extends Phaser.Scene {
  private landmark: Landmark | null = null;

  constructor() {
    super('Landmark');
  }

  init(data: { landmarkId?: string }): void {
    this.landmark = LANDMARKS.find((l) => l.id === data.landmarkId) ?? null;
  }

  create(): void {
    if (!hasRun() || !this.landmark) {
      this.scene.start(hasRun() ? 'Trail' : 'Title');
      return;
    }
    const lm = this.landmark;
    this.cameras.main.setBackgroundColor('#000000');

    this.add
      .text(GAME_WIDTH / 2, 6, lm.name.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: WHITE,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 20, `MILE ${lm.mile}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: BLUE,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(8, 34, lm.blurb, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: GREEN,
        wordWrap: { width: GAME_WIDTH - 16 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0);

    const continueLabel = lm.mile >= TOTAL_MILES ? '> ENTER PRODUCTION' : '> CONTINUE THE MARCH';
    const btn = this.add
      .text(GAME_WIDTH / 2, 190, continueLabel, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: WHITE,
      })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.continueOn());

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', () => this.continueOn());
      kb.on('keydown-SPACE', () => this.continueOn());
    }

    bus.emit('scene:ready', { scene: 'Landmark' });
  }

  private continueOn(): void {
    if (this.landmark && this.landmark.mile >= TOTAL_MILES) {
      this.scene.start('Score');
    } else {
      this.scene.start('Trail');
    }
  }
}
