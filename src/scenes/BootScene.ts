import Phaser from 'phaser';

/**
 * BootScene: loads nothing yet (Phase 0). Later phases preload sprite
 * sheets, bitmap fonts, and lazy-load audio here. Hands off to Title.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Title');
  }
}
