/**
 * Scene transitions + shared outcome flourishes (ART-DIRECTION v3:
 * "motion is a feature").
 *
 * installSceneTransitions() wraps ScenePlugin.start once, game-wide, so
 * EVERY scene change gets the same quick fade instead of a hard cut —
 * zero per-scene changes, exactly like ui/text.ts patches the text
 * factory. Under prefers-reduced-motion the wrapper is a pass-through
 * (instant cut, spec §12.3).
 *
 * winBurst()/failPuff() are the consistent minigame outcome flourishes:
 * a confetti-ish palette burst for wins, a manila dust puff for
 * failures. Both are no-ops under reduced motion, both are modestly
 * capped (≤ 26 particles), and both self-destroy — no per-frame cost
 * after they finish.
 */
import Phaser from 'phaser';

/** Fade-out before the switch / fade-in after it, in ms. Quick on purpose. */
const FADE_OUT_MS = 130;
const FADE_IN_MS = 170;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scenes currently mid-fade; second starts pass through immediately. */
const fading = new WeakSet<Phaser.Scene>();

let installed = false;

/**
 * Patch ScenePlugin.start so every scene change fades out the current
 * camera (130ms), switches, then fades the new scene in (170ms).
 *
 * Guards:
 *  - reduced motion / no camera / Boot scene → instant original start;
 *  - a second start while fading → instant original start (the pending
 *    fade's completion dies with the old camera, so no stale route);
 *  - the fading flag is also cleared on scene shutdown so reused scene
 *    instances (Phaser restarts them constantly) never get stuck.
 */
export function installSceneTransitions(game: Phaser.Game): void {
  if (installed) return;
  installed = true;

  const proto = Phaser.Scenes.ScenePlugin.prototype;
  const originalStart = proto.start;

  proto.start = function (
    this: Phaser.Scenes.ScenePlugin,
    key?: string | Phaser.Scene,
    data?: object,
  ): Phaser.Scenes.ScenePlugin {
    const current = this.scene;
    const cam = current?.cameras?.main;

    const doStart = (): Phaser.Scenes.ScenePlugin => {
      const out = originalStart.call(this, key as string, data);
      // Fade the target in once it has built itself.
      if (!prefersReducedMotion()) {
        const target =
          typeof key === 'string' ? game.scene.getScene(key) : (key ?? null);
        target?.events.once(Phaser.Scenes.Events.CREATE, () => {
          target.cameras?.main?.fadeIn(FADE_IN_MS, 0, 0, 0);
        });
      }
      return out;
    };

    if (
      prefersReducedMotion() ||
      !cam ||
      !current ||
      current.scene.key === 'Boot' ||
      fading.has(current)
    ) {
      return doStart();
    }

    fading.add(current);
    current.events.once(Phaser.Scenes.Events.SHUTDOWN, () => fading.delete(current));
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      fading.delete(current);
      doStart();
    });
    cam.fadeOut(FADE_OUT_MS, 0, 0, 0);
    return this;
  };
}

// ---------------------------------------------------------------------------
// Shared particle flourishes
// ---------------------------------------------------------------------------

/** Register the shared 2x2 particle texture in this scene's manager. */
export function ensureFxTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-px')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 2, 2);
  g.generateTexture('fx-px', 2, 2);
  g.destroy();
}

/**
 * Soft cloud texture (radial-gradient blobs on canvas) for drifting
 * ambient layers. ~96x32, white on transparent; tint/alpha at use site.
 */
export function ensureCloudTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-cloud')) return;
  const w = 96;
  const h = 32;
  const tex = scene.textures.createCanvas('fx-cloud', w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const blob = (cx: number, cy: number, r: number, a: number): void => {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  blob(30, 18, 16, 0.5);
  blob(48, 14, 20, 0.6);
  blob(66, 18, 14, 0.45);
  blob(40, 22, 12, 0.35);
  tex.refresh();
}

/** Confetti-ish burst for wins — palette colors, small, self-destroying. */
export function winBurst(scene: Phaser.Scene, x: number, y: number, quantity = 26): void {
  if (prefersReducedMotion()) return;
  ensureFxTexture(scene);
  const emitter = scene.add
    .particles(x, y, 'fx-px', {
      speed: { min: 40, max: 110 },
      angle: { min: 0, max: 360 },
      gravityY: 90,
      lifespan: { min: 400, max: 750 },
      scale: { start: 1.4, end: 0 },
      tint: [0x1bcb01, 0xffffff, 0x0da1ff, 0xf55d08],
      emitting: false,
    })
    .setDepth(90);
  emitter.explode(Math.min(quantity, 26));
  scene.time.delayedCall(900, () => emitter.destroy());
}

/** Dust puff for failures — manila motes drifting up, small and dry. */
export function failPuff(scene: Phaser.Scene, x: number, y: number, quantity = 14): void {
  if (prefersReducedMotion()) return;
  ensureFxTexture(scene);
  const emitter = scene.add
    .particles(x, y, 'fx-px', {
      speed: { min: 8, max: 30 },
      angle: { min: 200, max: 340 },
      gravityY: -12,
      lifespan: { min: 500, max: 900 },
      alpha: { start: 0.7, end: 0 },
      scale: { start: 1.2, end: 0.3 },
      tint: [0xd8c7a0, 0x9a8c6c],
      emitting: false,
    })
    .setDepth(90);
  emitter.explode(Math.min(quantity, 16));
  scene.time.delayedCall(1000, () => emitter.destroy());
}
