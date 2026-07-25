/**
 * Touch helpers for canvas UI (Phase 10 mobile pass, upgraded by the
 * mobile & readability fix).
 *
 * The logical canvas is 320x200; on a 390px-wide phone one logical pixel
 * is ~1.2 CSS pixels, so an 8px menu row is a ~10px tap target — far
 * under the 44px accessibility bar. padHit() widens a text object's
 * interactive area without changing its looks. On coarse pointers it now
 * grows the hit area toward MIN_TOUCH_PX *device* pixels (computed from
 * the displayed canvas scale), capped by an optional band height so
 * stacked menu rows can tile the space without overlapping — an overlap
 * would make Phaser pick whichever object sorts last (adjacent-row
 * misfires).
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, MIN_TOUCH_PX } from '../config';

/** True on touch-first devices (no fine pointer). Menus add spacing. */
export function isCoarse(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Device (CSS) pixels per logical pixel of the displayed canvas. */
export function devicePxPerLogical(scene: Phaser.Scene): number {
  const h = scene.scale.displaySize?.height ?? 0;
  return h > 0 ? h / GAME_HEIGHT : 1;
}

/** MIN_TOUCH_PX device pixels expressed in logical pixels. */
export function touchTargetLogical(scene: Phaser.Scene): number {
  return MIN_TOUCH_PX / devicePxPerLogical(scene);
}

/**
 * Make a text object interactive with a hit area padded beyond its bounds
 * (logical pixels). Safe to call instead of setInteractive().
 *
 * On coarse pointers the hit area auto-grows toward MIN_TOUCH_PX device
 * pixels in both axes. `maxBandH` (logical px) caps the total hit-area
 * height — pass the row pitch for stacked menus so adjacent rows' bands
 * touch but never overlap.
 */
export function padHit<T extends Phaser.GameObjects.Text>(
  t: T,
  padX = 8,
  padY = 4,
  maxBandH?: number,
): T {
  if (isCoarse()) {
    const target = touchTargetLogical(t.scene);
    const bandH = maxBandH !== undefined ? Math.min(target, maxBandH) : target;
    // The band fully determines vertical padding on touch: growing it
    // past `maxBandH` would let stacked rows' hit areas overlap.
    padY = Math.max(0, (bandH - t.height) / 2);
    padX = Math.max(padX, (target - t.width) / 2);
  }
  t.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-padX, -padY, t.width + padX * 2, t.height + padY * 2),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  return t;
}
