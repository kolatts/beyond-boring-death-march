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
import { ContextPackScene } from './ContextPackScene';
import { CabCrossingScene } from './CabCrossingScene';
import { NightWatchScene } from './NightWatchScene';
import { SkillsMarketScene } from './SkillsMarketScene';
import { PermissionsPassScene } from './PermissionsPassScene';
import { LoopBuilderScene } from './LoopBuilderScene';

type SceneClass = new (...args: never[]) => Phaser.Scene;

export interface MinigameEntry {
  /** Phaser scene key to start. */
  sceneKey: string;
  sceneClass: SceneClass;
}

/** mechanic key (from landmarks.json) -> scene to launch. */
export const MINIGAMES: Record<string, MinigameEntry> = {
  // outfitting: { sceneKey: 'Outfitting', sceneClass: OutfittingScene },
<<<<<<< HEAD
  context_pack: { sceneKey: 'ContextPack', sceneClass: ContextPackScene },
  cab_crossing: { sceneKey: 'CabCrossing', sceneClass: CabCrossingScene },
  night_watch: { sceneKey: 'NightWatch', sceneClass: NightWatchScene },
  skills_market: { sceneKey: 'SkillsMarket', sceneClass: SkillsMarketScene },
  permissions_gauntlet: { sceneKey: 'PermissionsPass', sceneClass: PermissionsPassScene },
  tutorial_one_shot: { sceneKey: 'LoopBuilder', sceneClass: LoopBuilderScene },
  loop_builder_guided: { sceneKey: 'LoopBuilder', sceneClass: LoopBuilderScene },
  loop_builder_verifier: { sceneKey: 'LoopBuilder', sceneClass: LoopBuilderScene },
};

/** Unique scene classes for Phaser registration in main.ts. */
export function minigameSceneClasses(): SceneClass[] {
  return [...new Set(Object.values(MINIGAMES).map((e) => e.sceneClass))];
}
