import Phaser from 'phaser';
import { GAME_WIDTH } from '../main';
import { bus } from '../ui/overlay';

/** Apple II palette (see docs/DECISIONS.md). */
const GREEN = 0x1bcb01;
const WHITE = '#ffffff';
const GREEN_CSS = '#1bcb01';

/**
 * TitleScene, Phase 0: black screen, the title, the tagline, and a green
 * rectangle proving Phaser renders. Roles, tombstone ticker, and key art
 * arrive in later phases.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');

    this.add
      .text(GAME_WIDTH / 2, 60, 'BEYOND BORING:\nDEATH MARCH', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: WHITE,
        align: 'center',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 104, 'You have died of context exhaustion.', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: GREEN_CSS,
        align: 'center',
      })
      .setOrigin(0.5);

    // The green rectangle. It proves the engine renders. It is doing its best.
    this.add.rectangle(GAME_WIDTH / 2, 150, 48, 24, GREEN);

    bus.emit('scene:ready', { scene: 'Title' });
  }
}
