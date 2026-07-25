# Art Direction — Modern-Retro (v2)

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
