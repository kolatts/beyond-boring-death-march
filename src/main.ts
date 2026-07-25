import Phaser from 'phaser';
import './ui/styles.css';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';

/**
 * Logical resolution: 320x200 (Apple IIgs / early VGA), upscaled with
 * nearest-neighbour and letterboxed to fit the window. Spec §13.
 */
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 200;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  pixelArt: true, // nearest-neighbour scaling, no antialiasing
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT, // letterbox to preserve 16:10 logical aspect
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene],
});
