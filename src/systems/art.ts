/**
 * Generated-art integration helpers (Phase 9).
 *
 * LAZY per-scene loading: each scene's preload() calls queueArt() with only
 * the images that scene uses. Nothing is loaded in BootScene, so the
 * first-load transfer stays under the 3 MB budget — a player who never
 * reaches the CAB Crossing never downloads its backdrop.
 *
 * The generated sprites (wagon, vulture) ship with opaque black backgrounds
 * (palette PNGs, no alpha). keyOutBlack() converts near-black pixels to
 * transparent at runtime via a canvas pass and registers the result as a
 * new texture, so sprites sit cleanly on terrain.
 */
import type Phaser from 'phaser';

/** Base URL for generated art (respects the Pages subpath). */
export const ART_BASE = `${import.meta.env.BASE_URL ?? '/'}assets/art/`;

/**
 * Queue images for a scene's loader unless already in the texture cache.
 * Call from preload(); Phaser fetches them before create().
 */
export function queueArt(scene: Phaser.Scene, images: Record<string, string>): void {
  for (const [key, file] of Object.entries(images)) {
    if (!scene.textures.exists(key)) {
      scene.load.image(key, `${ART_BASE}${file}`);
    }
  }
}

/**
 * Register `outKey` as a copy of `srcKey` with near-black pixels made
 * transparent (chroma key), optionally pre-downsampled to `outHeight`
 * logical pixels (smooth area-average, so tiny trail sprites don't
 * decimate into noise under the game's global nearest-neighbour scaling).
 * No-op if the source is missing or the result already exists.
 */
export function keyOutBlack(
  scene: Phaser.Scene,
  srcKey: string,
  outKey: string,
  outHeight?: number,
  threshold = 24,
): void {
  if (scene.textures.exists(outKey) || !scene.textures.exists(srcKey)) return;
  const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & {
    width: number;
    height: number;
  };
  const w = src.width;
  const h = src.height;

  // Pass 1: full-resolution chroma key on a scratch canvas.
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  sctx.drawImage(src, 0, 0);
  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    if (r < threshold && g < threshold && b < threshold) {
      px[i + 3] = 0;
    }
  }
  sctx.putImageData(data, 0, 0);

  // Pass 2: smooth downsample to the display size (if requested).
  const outH = outHeight && outHeight < h ? outHeight : h;
  const outW = Math.max(1, Math.round((w * outH) / h));
  const canvasTexture = scene.textures.createCanvas(outKey, outW, outH);
  if (!canvasTexture) return;
  const ctx = canvasTexture.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, 0, 0, w, h, 0, 0, outW, outH);
  canvasTexture.refresh();
}

/**
 * Register `outKey` as a smooth-downsampled copy of `srcKey` at `scale`
 * (for tiled terrain that would otherwise decimate under nearest-neighbour).
 */
export function resample(scene: Phaser.Scene, srcKey: string, outKey: string, scale: number): void {
  if (scene.textures.exists(outKey) || !scene.textures.exists(srcKey)) return;
  const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & {
    width: number;
    height: number;
  };
  const outW = Math.max(1, Math.round(src.width * scale));
  const outH = Math.max(1, Math.round(src.height * scale));
  const canvasTexture = scene.textures.createCanvas(outKey, outW, outH);
  if (!canvasTexture) return;
  const ctx = canvasTexture.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, outW, outH);
  canvasTexture.refresh();
}

/**
 * Register `outKey` as a nearest-neighbour decimated copy of `srcKey` at
 * `outW` x `outH` LOGICAL pixels.
 *
 * Why: the backing store is now supersampled (config.RENDER_SCALE — see
 * ui/text.ts), so a 400px generated PNG drawn at 88 logical pixels would
 * render its full native detail instead of the 320x200-grid decimation
 * the art direction was built on. Quantising to the logical grid first
 * (with smoothing OFF, matching the GPU's old NEAREST downsample
 * pixel-for-pixel) preserves the chunky aesthetic; the supersampled
 * framebuffer then upscales each logical pixel into a crisp block.
 */
export function quantize(
  scene: Phaser.Scene,
  srcKey: string,
  outKey: string,
  outW: number,
  outH: number,
): void {
  if (scene.textures.exists(outKey) || !scene.textures.exists(srcKey)) return;
  const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & {
    width: number;
    height: number;
  };
  const canvasTexture = scene.textures.createCanvas(outKey, Math.max(1, Math.round(outW)), Math.max(1, Math.round(outH)));
  if (!canvasTexture) return;
  const ctx = canvasTexture.getContext();
  ctx.imageSmoothingEnabled = false; // nearest: identical to the old decimation
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, canvasTexture.width, canvasTexture.height);
  canvasTexture.refresh();
}

/**
 * Add an image covering the full logical canvas (like CSS `cover`),
 * centered, preserving aspect. Returns the image (or null if the texture
 * never loaded — scenes must stay playable art-less).
 *
 * The source is quantised to the logical cover size first so backdrops
 * keep the 320x200 look under the supersampled backing store.
 */
export function coverBackdrop(
  scene: Phaser.Scene,
  key: string,
  canvasW: number,
  canvasH: number,
  alpha = 1,
): Phaser.GameObjects.Image | null {
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
  const scale = Math.max(canvasW / src.width, canvasH / src.height);
  const qKey = `${key}-q`;
  quantize(scene, key, qKey, src.width * scale, src.height * scale);
  const useKey = scene.textures.exists(qKey) ? qKey : key;
  const img = scene.add.image(canvasW / 2, canvasH / 2, useKey);
  if (useKey === key) img.setScale(scale);
  img.setAlpha(alpha);
  return img;
}
