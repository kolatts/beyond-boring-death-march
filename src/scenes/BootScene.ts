import Phaser from 'phaser';
import { MINIGAMES } from './index';
import { actions, hasRun } from '../systems/state';

/**
 * BootScene: decides the first real scene, deterministically.
 *
 * DEV DEEP LINK (?minigame=<mechanic>[&landmark=<id>]): handled HERE,
 * before Title ever starts. The previous implementation lived in main.ts
 * behind two dynamic import()s that resolved AFTER Boot→Title had begun,
 * so `getScenes(true)` missed the just-starting TitleScene — the hidden
 * Title kept its key handlers, popped its party-naming panel over the
 * minigame, and its focused DOM input froze Phaser input. Boot deciding
 * the route synchronously means Title is simply never created on a deep
 * link — nothing to stop, nothing to leak.
 *
 * KNOWN LIMITATION (accepted): ?minigame=harness_swap cannot exercise the
 * swap branch. The deep link creates a fresh default run, and newRun()
 * wipes the run-scoped `bbdm:outfitting` loadout the swap branch needs,
 * so OutfittingScene falls back to the full draft. The swap is only
 * reachable in real play at Harness Hollow (mile 1010).
 *
 * Later phases preload sprite sheets, bitmap fonts, and lazy audio here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const params = new URLSearchParams(window.location.search);
    const mechanic = params.get('minigame');
    if (mechanic) {
      const entry = MINIGAMES[mechanic];
      if (entry) {
        // Fresh default run so the scene has state to act on.
        if (!hasRun()) actions.newRun('staff', []);
        this.scene.start(entry.sceneKey, {
          landmarkId: params.get('landmark') ?? undefined,
          mechanic,
        });
        return;
      }
    }
    this.scene.start('Title');
  }
}
