# Minigame Wave — Shared Brief

Read before building any minigame scene. Applies to every Wave 2 agent.

## Required reading (in order)

1. `prompt.md` — your assigned §7.x section, plus §5 (resources), §10 (your
   curriculum rows), §12 (voice + hard limits), §13 (art frame)
2. `docs/ART-DIRECTION.md` — modern-retro v2; your scene's juice budget
3. `docs/DECISIONS.md` — interface decisions (weight-0 events, palette, API)
4. `src/scenes/index.ts` — the registry contract (header comment)
5. `src/systems/state.ts`, `economy.ts`, `deadlines.ts` — the state API

## The contract

- Own files only: `src/scenes/<Your>Scene.ts`, `src/systems/<your>Sim.ts`,
  optional `src/content/<yours>.json` + `src/schemas/<yours>.schema.json`
  (unique names — content lint validates pairs). Plus your one-line-per-
  mechanic registration in `src/scenes/index.ts`. Do NOT edit `main.ts`,
  `LandmarkScene.ts`, `TrailScene.ts`, `state.ts`, or another scene.
- Your scene `init` receives `{ landmarkId, mechanic }`. Several mechanics
  may share your scene class; branch on `mechanic`.
- Exit: `this.scene.start('Trail')`. Death:
  `actions.markDead(cause)` then `this.scene.start('Death', { cause })`.
- State: `import { getState, actions } from '../systems/state'` —
  `applyResourceDelta({tokens:-5}, 'notice')` (auto-clamped),
  `setFlag('x')` (boolean-true only), `rand()` (seeded). After mutations:
  `saveRun(getState())` from `systems/save.ts`.
- Per-run data beyond resources/flags (e.g. chosen loadout): namespaced
  localStorage key `bbdm:<yourscene>`, documented in your report — Wave 3
  integrates it into the economy.
- Curriculum: `await showCurriculumCard('<id>')` from `ui/curriculumCard.ts`
  AFTER the joke lands, never before.
- Flavor prose lives in JSON content, not in `.ts` (spec §2). Functional
  UI labels ("RUN", "FORD THE CROSSING") may live in code. Buttons say what
  happens; satire never blocks comprehension (§12.3).

## Look & feel

- Palette: the six Apple II hues + shades/glow per ART-DIRECTION v2.
- Juice: Phaser 3.90 postFX (bloom/glow), particle emitters,
  `this.cameras.main.shake/flash/fade`, tweens. Every effect needs a
  reduced-motion fallback: check
  `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → instant
  cut, no flashing.
- Keyboard playable end to end, visible focus, status glyphs `✓ ! ×`
  alongside color.
- Do NOT load `public/assets/art/**` yet (generation in flight). Draw with
  Phaser primitives/text/FX; Wave 4 swaps in sprites.

## Test before you report

- `npm ci` in your worktree, `npm run build` clean (strict tsconfig).
- Playtest in a real browser with the playwright-cli skill on YOUR assigned
  port: `npx vite --port <PORT> --strictPort`. Deep link straight into your
  scene: `http://localhost:<PORT>/?minigame=<mechanic>`.
- Phaser ignores synthetic key events without a real `keyCode` — dispatch
  `new KeyboardEvent('keydown', { key, keyCode })` on `window`; DOM panel
  inputs get events on the focused element.
- Exercise every failure/success mode in your spec table; screenshot each.

## Git

Work happens in your isolated worktree branch. Commit only your own files
(message ends `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
Do NOT push, do NOT merge — report your branch name and the orchestrator
merges. Report: files, mechanics registered, curriculum cards wired,
localStorage keys, failure modes demonstrated (with screenshots), and any
interface needs for Wave 3.
