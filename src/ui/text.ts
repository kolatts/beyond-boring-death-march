/**
 * Crisp text rendering (mobile & readability pass).
 *
 * THE PROBLEM: the game renders at a 320x200 logical resolution. With
 * Phaser.Scale.FIT the canvas *backing store* stays 320x200 and CSS
 * upscales it, so every glyph is rasterised into a handful of physical
 * pixels and then blown up — unreadable mush on a 390px phone, chunky on
 * desktop. Setting only Text `resolution` would not help: the glyphs
 * would still be squeezed through the 320x200 framebuffer.
 *
 * THE APPROACH (documented per the fix brief): supersample the backing
 * store instead.
 *
 *  1. main.ts boots the canvas at GAME_WIDTH*RENDER_SCALE x
 *     GAME_HEIGHT*RENDER_SCALE (1280x800).
 *  2. installCrispRendering() keeps every scene's main camera at
 *     zoom=RENDER_SCALE centered on the logical canvas, so all scene code
 *     keeps thinking in 320x200 coordinates — zero per-scene changes.
 *  3. It also wraps GameObjectFactory.text in one place so every Text
 *     object defaults to `resolution: RENDER_SCALE`; its glyph canvas
 *     then maps 1:1 onto backing-store pixels — crisp at any size.
 *
 * Sprites and Graphics still render nearest-neighbour (pixelArt: true):
 * one logical pixel becomes an exact RENDER_SCALE-sized block, which is
 * pixel-identical to what CSS upscaling produced before. Art that ships
 * larger than its on-screen logical size (backdrops, portraits) is
 * pre-quantised to the logical grid in systems/art.ts so the 320x200 art
 * aesthetic survives the higher-resolution framebuffer.
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';

/** Resolution applied to every Phaser Text object (glyph pixels per
 * logical pixel). Matches the backing-store supersample exactly, so text
 * textures hit the framebuffer 1:1 even under the NEAREST filter. */
export const TEXT_RESOLUTION = RENDER_SCALE;

type TextStyleArg = Phaser.Types.GameObjects.Text.TextStyle | undefined;

let patched = false;

/** Patch scene.add.text once, game-wide, to default `resolution`. */
function patchTextFactory(): void {
  if (patched) return;
  patched = true;
  const factory = Phaser.GameObjects.GameObjectFactory.prototype;
  const original = factory.text;
  factory.text = function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    text: string | string[],
    style?: TextStyleArg,
  ): Phaser.GameObjects.Text {
    const merged: Phaser.Types.GameObjects.Text.TextStyle = { ...(style ?? {}) };
    if (merged.resolution === undefined || merged.resolution === 0) {
      merged.resolution = TEXT_RESOLUTION;
    }
    return original.call(this, x, y, text, merged);
  };
}

/**
 * Install the supersampled-rendering pass. Call once right after
 * `new Phaser.Game(...)`.
 *
 * Cameras are (re)created every time a scene starts, so instead of
 * touching all fifteen scenes we re-assert the zoom in a PRE_RENDER hook:
 * a freshly built camera has zoom 1 and gets snapped to RENDER_SCALE
 * before its first frame is drawn. Costs a comparison per active scene
 * per frame; camera shake/flash/fade are unaffected.
 */
export function installCrispRendering(game: Phaser.Game): void {
  patchTextFactory();
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
    for (const scene of game.scene.getScenes(true)) {
      const cam = scene.cameras?.main;
      if (cam && cam.zoom !== RENDER_SCALE) {
        cam.setZoom(RENDER_SCALE);
        cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      }
    }
  });
}
