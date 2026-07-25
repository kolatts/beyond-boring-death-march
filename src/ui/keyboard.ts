/**
 * Phaser-keyboard vs DOM-dialog arbitration (mobile & readability pass).
 *
 * Phaser's global KeyboardManager calls `preventDefault()` on every
 * captured key code (anything registered via `addKeys`/`addKey` with
 * capture on) for as long as the capture list is non-empty — even when a
 * scene's KeyboardPlugin is `enabled = false`, and even after the scene
 * that added the capture has shut down. A captured SPACE therefore eats
 * the keypress before the browser can toggle a focused checkbox or type
 * a space into an <input> (the Bug Hunt pack-out bug).
 *
 * Any scene that opens a DOM dialog over the canvas must suspend the
 * whole pipeline — plugin AND global captures — and restore it on close.
 */
import type Phaser from 'phaser';

/**
 * Hand keyboard ownership to a DOM dialog: disable the scene's keyboard
 * plugin, clear ALL global key captures (so browser defaults — checkbox
 * toggling, text entry, focus traversal — work again), and reset held
 * keys so nothing stays "down" when play resumes.
 */
export function suspendKeyboard(scene: Phaser.Scene): void {
  const kb = scene.input.keyboard;
  if (!kb) return;
  kb.enabled = false;
  kb.clearCaptures();
  kb.resetKeys();
}

/**
 * Take keyboard ownership back from a DOM dialog. `captures` re-registers
 * the key codes the scene wants preventDefault-ed (e.g. 'UP,DOWN,SPACE'
 * so the page never scrolls under the game).
 */
export function resumeKeyboard(scene: Phaser.Scene, captures?: string): void {
  const kb = scene.input.keyboard;
  if (!kb) return;
  kb.enabled = true;
  kb.resetKeys();
  if (captures) kb.addCapture(captures);
}
