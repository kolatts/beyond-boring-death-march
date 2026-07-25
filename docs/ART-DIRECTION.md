# Art Direction — Cartoony SVGA (v3)

**v3 supersedes v2 below.** User direction: *"less pixelated art… modernized,
keep a cartoony feel. Think Warcraft 2 levels of detail. More animations to
keep things exciting looking."*

## The v3 look

Mid-90s SVGA strategy-game art: hand-painted, cartoony, saturated, chunky
OUTLINES not chunky PIXELS. Detail density like Warcraft 2 — readable
silhouettes, painterly shading, personality in every sprite. No longer
pretending to be an Apple II.

- **Rendering: smooth.** No palette quantization, no nearest-neighbour
  decimation for images. Art displays at native fidelity (the 4× backing
  store gives real resolution headroom). Text stays crisp as-is.
- **Palette identity kept loosely**: phosphor green, signal orange, manila,
  ledger blue remain the brand accents on a richer painted palette.
- **Characters**: Boring and Brilliant keep their established personalities
  and silhouettes (boxy deadpan + coffee vs. starry-eyed + lightbulb),
  re-rendered as cartoony painted sprites.
- **Motion is a feature**: ambient animation everywhere it's cheap — bobbing
  wagon, dust trails, parallax clouds, flickering fires, drifting title
  scene, animated UI transitions, particle flourishes on outcomes. All
  still instant-cut under `prefers-reduced-motion`.
- Terminal/log UI elements may stay "screen-like" (that's fiction, not
  pixelation).

---

# (superseded) Art Direction — Modern-Retro (v2)

**Supersedes the strict-Apple-II ruling in DECISIONS.md.** User-directed shift
mid-build: *"more modern looking, but still reminiscent of the old game.
Flashy effect animations and things like that to make it more stylized."*

## The look in one sentence

Pixel art the way 2020s indie games do pixel art (Shovel Knight / Celeste-era
presentation values), built on the Apple II Oregon Trail color family — so it
reads as the old game, remembered better than it actually looked.

## Static art (generated images)

- **Foundation stays pixel art.** Chunky pixels, hard silhouettes, dithering
  as a texture. No photorealism, no smooth vector look.
- **Palette: the six Apple II hues remain the color identity** — black
  `#000000`, white `#FFFFFF`, green `#1BCB01`, violet `#BB36FF`, orange
  `#F55D08`, blue `#0DA1FF` — but shades, tints, and glow halos of those hues
  are now allowed. Rim light, bloom around phosphor-green elements, dramatic
  key lighting in hero pieces.
- **Hero pieces** (title key art, pegboard, tombstone, night watch, CAB river)
  get the full modern treatment: depth, lighting, atmosphere.
- **Sprites** (walk cycles, portraits, wagon) stay chunky and readable at
  small sizes; modest glow accents are fine.

## Motion & effects (in-engine, Phaser)

The juice budget goes UP. Use Phaser 3.60+ built-ins — postFX pipelines
(bloom, glow), particle emitters, camera shake/flash/fade, tweened UI.

- **Signature moments** (biggest effects): the loop pegboard current +
  failure sparks; the death-stamp slam on the tombstone (red stamp smashes
  down with camera shake + particle burst); the overnight travel sequence;
  verifier pass (green flash + particle shower).
- **Ambient juice**: scanline/vignette CRT overlay (subtle, toggleable),
  parallax on the trail, resource bars that pulse when critical, screen
  shake on hostile events, animated scene transitions (wipe/dissolve, not
  hard cuts).
- **UI**: buttons/cards get hover glow + press feedback; curriculum cards
  slide in with paper physics feel; doom clock flickers as Day 120 nears.

## Hard rules (unchanged)

- `prefers-reduced-motion`: every effect above must degrade to an instant
  cut/static state. No exceptions.
- Status is never color alone — glyphs (`✓ ! ×`) stay.
- Functional UI copy stays instantly readable; effects never delay input.
- Bundle budget still < 3 MB first load; effects are code, not video files.
