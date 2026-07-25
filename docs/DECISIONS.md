# DECISIONS

Running log of build decisions. If a detail was underspecified, we picked the
simpler option, wrote it down here, and kept moving.

## Resolved contradictions (user-confirmed, from the approved plan)

| Conflict | Resolution |
|---|---|
| Spec §2 "Backend: none" vs. the Persistence row's Azure Function, plus the new social features | **One C# Azure Function** (consumption plan, its own resource group + App Insights, Azure Table Storage) serves the death feed and hall of fame. The frontend stays static on GitHub Pages. **The game is static; only the graveyard has a server.** |
| Art-direction stickers (orange/charcoal, smooth) vs. spec §13 green-phosphor pixel art | **Pixel art wins; the palette is re-derived from the original Apple II Oregon Trail colors** (black, white, hi-res green, violet, orange, blue). The sticker images are character reference only (Boring = boxy, deadpan, coffee mug, clipboard; Brilliant = starry-eyed, lightbulb, mid-gesture). |
| "The Agentic Trail" / `agentic-trail` naming throughout the spec | Title is **BEYOND BORING: DEATH MARCH**; the tagline stays *"You have died of context exhaustion."* Repo and Vite base path are `beyond-boring-death-march`. |
| Spice level | Sharper, more savage, **no profanity** — the deadpan register does the damage. Spec §12.2 hard limits remain absolute: no real companies, vendors, or people; never punch down. |
| Surprise deadlines | **Core mechanic** (the Death March doom clock, Day ~120 business deadline, surprise compliance deadlines from InfoSec / Compliance / ARB / PMO / The Standards Body), threaded through events, deaths, NPC dialogue, and endgame scoring. |
| Bug Hunt scroll complexity | Simplified to **grid-based movement** (still an 8-directional feel, no smooth-scrolling camera). |

## Palette

Apple II Oregon Trail, six values, no seventh (spec §13 rule kept; hexes retargeted):

| Token | Hex | Use |
|---|---|---|
| `--black` | `#000000` | Backgrounds, the void beyond the trail |
| `--white` | `#FFFFFF` | Headings, high-contrast text |
| `--green` | `#1BCB01` | Primary text, healthy status, the loop when it's working |
| `--violet` | `#BB36FF` | Denials, failures, death |
| `--orange` | `#F55D08` | Warnings, hazards, the doom clock running hot |
| `--blue` | `#0DA1FF` | Water, night, the overnight sequence |

Every status indicator carries a glyph (`✓` `!` `×`) as well as a colour, so it
survives colourblindness and a bad projector at a meetup.

## Tech stack (spec §3 rationale, adopted)

**Phaser 3 + TypeScript + Vite. No React. No physics beyond Arcade.**

- **Phaser 3** — the most widely used, best-documented, actively maintained 2D
  web game engine. Enormous tutorial corpus, so both the coding agents building
  it and the humans reading it later have strong priors. Browser-only by
  design, which is exactly the requirement.
- **TypeScript** — the game state machine has ~15 interacting systems; untyped
  state would rot inside a week.
- **Vite** — dev server + build in one config file; sets `base` for GitHub
  Pages subpath deployment.
- **No React** — Phaser owns the canvas; DOM UI is a thin HTML/CSS overlay
  driven by a tiny typed event bus (`src/ui/overlay.ts`). A framework here buys
  nothing and costs bundle size.
- **No physics engine beyond Arcade** — nothing in this game needs Matter.js.
- **Explicitly rejected:** Unity/Godot web export (20 MB+ payloads, wrong
  tool), Three.js (this is a 2D game), any state-management library (Phaser's
  registry plus one typed store module is enough).

Dependency allowlist: `phaser ^3.90`, `typescript ^5`, `vite ^7`, plus `ajv`
(dev-only, content lint). `howler` only if Phaser audio fails on iOS Safari.
Nothing else — every additional dependency is a supply-chain conversation you
don't want to have with a Standards Body.

## Phase 0 scaffold decisions

- **Logical resolution 320×200**, nearest-neighbour upscale (`pixelArt: true`),
  letterboxed via `Phaser.Scale.FIT`. Matches spec §13's Apple IIgs frame.
- **Content lint** (`scripts/validate-content.mjs`) exits 0 when
  `src/schemas/` is missing or empty: schemas and content are authored by a
  separate workstream and may land after the scaffold. Once a schema exists,
  its content file must exist and validate — a missing or invalid content file
  fails the build.
- **Deploy workflow** uses the official Pages actions
  (`upload-pages-artifact` → `deploy-pages`) with
  `permissions: contents:read, pages:write, id-token:write` and a
  `concurrency: pages` queue (never cancel in-flight) so parallel agent pushes
  don't double-deploy.
- **OG image and favicon** are referenced from `index.html` at
  `assets/art/og.png` / `favicon.ico`; the art workstream generates the actual
  files under `public/`.
- **No analytics, no telemetry, no runtime services in the frontend.** The
  whole point of the joke is that this cost nothing and shipped in a week.

## Content interface decisions (Wave 1B)

- **Escalation events use `weight: 0`** — never drawn from the random pool;
  fired only by the deadline system via `escalationEventId` (also used for the
  flag-triggered events `hollow_green_discovered`, `compromised_consequence`).
  The event engine MUST treat weight 0 as "referenced-only, never random."
- **`deferPenalty` values are negative deltas** (e.g. `credibility: -6`),
  enforced by schema (`maximum: 0`).
- **Real product names genericized** even where the spec mentioned them
  ("the ticketing system", "chat scrollback", "the wiki"). Vendor names appear
  only in `docs/CURRICULUM.md` reference links, which §18 mandates.
- **Boring/Brilliant correctness sequence** across the 12 landmarks is
  BXXBBXXBBXBX (6/6, no learnable pattern), marked in data, unmarked in prose.
- **Social backend** (Wave 1C): the game is static; only the graveyard has a
  server. API base `https://death-march-prod-functions.azurewebsites.net/api`,
  resource group `death-march-prod`, Y1 consumption + Table Storage +
  sampled App Insights. Frontend must degrade gracefully to localStorage
  when the API is unreachable.

## Educational layer vs. fiction layer (user directive, 2026-07-25)

This ruling overrides the earlier blanket genericization where the two conflict.

- **The educational content is purely focused on agentic coding**: Claude
  skills, agentic workflows with GitHub Actions, the Claude SDK, and the
  practices around them. It is allowed — and expected — to **name real
  tools**: Claude Code, the Claude Agent SDK, GitHub Actions, `gh-aw`,
  `claude-code-action`, MCP. Teach the real thing concretely. The
  educational layer is: `src/content/curriculum.json` (Field Notes),
  `docs/CURRICULUM.md`, and the endgame scoring explanations.
- **The fiction layer stays vendor-neutral** per prompt.md §12.2: events,
  landmarks, deaths, NPC dialogue, and the robots' lines never name a real
  vendor or product. The bureaucracy is the target, not anyone's tool.
- **No real person's name appears in any player-visible copy, anywhere** —
  fiction or educational. The endgame formerly credited the three-loops
  framework by name; it now says "the three loops" and the attribution
  lives in `docs/CURRICULUM.md` (and the README points there).
- **Primary-source links in Field Notes are required by prompt.md §10.1**
  and are attribution, not satire. A link URL may contain an author's or
  vendor's domain name; the card prose may not name a person.
- The `surprise_deadlines` card teaches the agentic lesson, not interrupt
  management: recurring compliance toil belongs in **scheduled agentic
  workflows** (gh-aw schedule triggers, read-only permissions, safe
  outputs) so mandates stop costing engineer-days.
