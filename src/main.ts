import Phaser from 'phaser';
import './ui/styles.css';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { installCrispRendering } from './ui/text';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { TrailScene } from './scenes/TrailScene';
import { LandmarkScene } from './scenes/LandmarkScene';
import { DeathScene } from './scenes/DeathScene';
import { ScoreScene } from './scenes/ScoreScene';
import { minigameSceneClasses } from './scenes/index';
import { mountAudioControl } from './systems/audio';
import { noticeRequested, renderNotice } from './ui/notice';

/**
 * The hidden /notice route (spec §17): ?notice=1 or #/notice renders the
 * MANDATORY COMPLIANCE NOTICE instead of booting the game. Compliance
 * takes precedence over delivery, as is traditional.
 */
if (noticeRequested()) {
  renderNotice();
} else {
  bootGame();
}

/**
 * Logical resolution: 320x200 (Apple IIgs / early VGA), letterboxed to
 * fit the window. Spec §13. GAME_WIDTH/GAME_HEIGHT live in config.ts so
 * scenes never import main.
 *
 * The BACKING store is supersampled RENDER_SCALE x (see ui/text.ts):
 * scenes still lay out in 320x200 logical pixels via a global camera
 * zoom, sprites stay nearest-neighbour chunky, but text renders at high
 * resolution instead of being decimated to the logical grid.
 */
function bootGame(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: '#000000',
    pixelArt: true, // nearest-neighbour scaling, no antialiasing
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT, // letterbox to preserve 16:10 logical aspect
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [
      BootScene,
      TitleScene,
      TrailScene,
      LandmarkScene,
      DeathScene,
      ScoreScene,
      ...minigameSceneClasses(),
    ],
  });

  // Supersampled backing store + crisp text (mobile pass — ui/text.ts).
  installCrispRendering(game);

  // Chiptune (spec §13): muted by default, M to toggle, zero assets.
  mountAudioControl();

  // Dev-only deep link (?minigame=<mechanic>) is handled inside BootScene,
  // synchronously, so the Title scene is never created underneath a
  // deep-linked minigame (see BootScene for the rationale + the accepted
  // harness_swap limitation).
}
