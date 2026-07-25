import Phaser from 'phaser';
import './ui/styles.css';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { TrailScene } from './scenes/TrailScene';
import { LandmarkScene } from './scenes/LandmarkScene';
import { DeathScene } from './scenes/DeathScene';
import { ScoreScene } from './scenes/ScoreScene';

/**
 * Logical resolution: 320x200 (Apple IIgs / early VGA), upscaled with
 * nearest-neighbour and letterboxed to fit the window. Spec §13.
 * GAME_WIDTH/GAME_HEIGHT live in config.ts so scenes never import main.
 */
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
  scene: [BootScene, TitleScene, TrailScene, LandmarkScene, DeathScene, ScoreScene],
});
