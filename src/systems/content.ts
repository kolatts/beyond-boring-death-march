/**
 * Typed loaders for /src/content/*.json.
 *
 * landmarks.json is a hard dependency (the content agent landed it in
 * Wave 1) and is statically imported — a missing file fails the build,
 * which is what we want.
 *
 * deaths.json may not exist yet (content agent, later wave), so it is
 * loaded through import.meta.glob, which resolves to an empty record when
 * the file is absent and never breaks the build.
 */

import rawLandmarks from '../content/landmarks.json';

export interface Landmark {
  id: string;
  mile: number;
  name: string;
  mechanic: string;
  blurb: string;
}

/** The twelve landmarks (§6), sorted by mile. */
export const LANDMARKS: readonly Landmark[] = [...(rawLandmarks as Landmark[])].sort(
  (a, b) => a.mile - b.mile,
);

// ---------------------------------------------------------------------------
// deaths.json (optional until the content wave lands it)
// ---------------------------------------------------------------------------

const deathModules = import.meta.glob('../content/deaths.json', { eager: true }) as Record<
  string,
  { default?: unknown }
>;

function extractDeathLines(): string[] {
  const lines: string[] = [];
  for (const mod of Object.values(deathModules)) {
    const data = mod.default;
    if (!Array.isArray(data)) continue;
    for (const entry of data) {
      if (typeof entry === 'string') {
        lines.push(entry);
      } else if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        const text = o['text'] ?? o['line'] ?? o['title'] ?? o['cause'];
        if (typeof text === 'string') lines.push(text);
      }
    }
  }
  return lines;
}

const deathLines = extractDeathLines();

/**
 * Pick a death line from content if available; otherwise return the
 * generic cause supplied by the killing system.
 */
export function deathLineFor(fallbackCause: string, roll: number): string {
  if (deathLines.length === 0) return fallbackCause;
  const idx = Math.min(deathLines.length - 1, Math.floor(roll * deathLines.length));
  return deathLines[idx] ?? fallbackCause;
}
