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

  /**
   * Dev-only deep link: ?minigame=<mechanic>[&landmark=<id>] jumps straight
   * into a registered minigame scene (fresh default run is created if none
   * exists). For agents and playtests; harmless in production.
   */
  game.events.once(Phaser.Core.Events.READY, () => {
    const params = new URLSearchParams(window.location.search);
    const mechanic = params.get('minigame');
    if (!mechanic) return;
    import('./scenes/index').then(({ MINIGAMES }) => {
      const entry = MINIGAMES[mechanic];
      if (!entry) return;
      import('./systems/state').then(({ hasRun, actions }) => {
        if (!hasRun()) actions.newRun('staff', []);
        game.scene.getScenes(true).forEach((s) => game.scene.stop(s.scene.key));
        game.scene.start(entry.sceneKey, {
          landmarkId: params.get('landmark') ?? undefined,
          mechanic,
        });
      });
    });
  });
}
