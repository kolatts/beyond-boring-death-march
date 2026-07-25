import Phaser from 'phaser';
import './ui/styles.css';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { TrailScene } from './scenes/TrailScene';
import { LandmarkScene } from './scenes/LandmarkScene';
import { DeathScene } from './scenes/DeathScene';
import { ScoreScene } from './scenes/ScoreScene';
import { minigameSceneClasses } from './scenes/index';

/**
 * Logical resolution: 320x200 (Apple IIgs / early VGA), upscaled with
 * nearest-neighbour and letterboxed to fit the window. Spec §13.
 * GAME_WIDTH/GAME_HEIGHT live in config.ts so scenes never import main.
 */
const game = new Phaser.Game({
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
