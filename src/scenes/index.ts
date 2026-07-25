/**
 * Minigame scene registry.
 *
 * Each landmark in src/content/landmarks.json names a `mechanic`. When a
 * minigame scene exists for that mechanic, LandmarkScene routes the player
 * into it after the blurb; otherwise the landmark is a plain stopover.
 *
 * MINIGAME WAVE CONTRACT: register your scene by appending ONE entry per
 * mechanic key to MINIGAMES below (several mechanics may share one scene
 * class — it is registered once). Your scene receives
 * `{ landmarkId, mechanic }` in init data, and must return to the trail
 * with `this.scene.start('Trail')` (or 'Death' via actions.markDead).
 * Do not edit main.ts or LandmarkScene.ts.
 */
import type Phaser from 'phaser';

type SceneClass = new (...args: never[]) => Phaser.Scene;

export interface MinigameEntry {
  /** Phaser scene key to start. */
  sceneKey: string;
  sceneClass: SceneClass;
}

/** mechanic key (from landmarks.json) -> scene to launch. */
export const MINIGAMES: Record<string, MinigameEntry> = {
  // outfitting: { sceneKey: 'Outfitting', sceneClass: OutfittingScene },
};

/** Unique scene classes for Phaser registration in main.ts. */
export function minigameSceneClasses(): SceneClass[] {
  return [...new Set(Object.values(MINIGAMES).map((e) => e.sceneClass))];
}
