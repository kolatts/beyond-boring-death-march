import Phaser from 'phaser';
import './ui/styles.css';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { installCrispRendering } from './ui/text';
import { installSceneTransitions } from './ui/transitions';
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
 * zoom. Since the v3 art pass, images render SMOOTHLY (linear filter,
 * native art resolution) and text renders at high resolution — nothing
 * is decimated to the logical grid anymore.
 */
function bootGame(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: '#000000',
    // ART-DIRECTION v3: smooth rendering. LINEAR texture filtering lets
    // generated art display at native fidelity on the supersampled
    // backing store (no nearest-neighbour decimation); text already
    // renders at RENDER_SCALE resolution so it stays crisp either way.
    pixelArt: false,
    roundPixels: false,
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

  // Quick fade between every scene change instead of hard cuts
  // (ART-DIRECTION v3; instant cut under prefers-reduced-motion).
  installSceneTransitions(game);

  // Chiptune (spec §13): muted by default, click-only toggle, zero assets.
  mountAudioControl();

  // Dev-only deep link (?minigame=<mechanic>) is handled inside BootScene,
  // synchronously, so the Title scene is never created underneath a
  // deep-linked minigame (see BootScene for the rationale + the accepted
  // harness_swap limitation).
}
