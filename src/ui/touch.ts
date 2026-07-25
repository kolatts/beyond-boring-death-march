/**
 * Touch helpers for canvas UI (Phase 10 mobile pass).
 *
 * The logical canvas is 320x200; on a 390px-wide phone one logical pixel is
 * ~1.2 screen pixels, so an 8px menu row is a ~10px tap target. padHit()
 * widens a text object's interactive area without changing its looks, so
 * menus are thumb-usable while the layout stays untouched.
 */
import Phaser from 'phaser';

/**
 * Make a text object interactive with a hit area padded beyond its bounds
 * (logical pixels). Safe to call instead of setInteractive().
 */
export function padHit<T extends Phaser.GameObjects.Text>(t: T, padX = 8, padY = 4): T {
  t.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-padX, -padY, t.width + padX * 2, t.height + padY * 2),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  return t;
}
