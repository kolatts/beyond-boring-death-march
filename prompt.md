# THE AGENTIC TRAIL — Claude Code Build Spec

> **Working title:** `The Agentic Trail`
> **Tagline:** *You have died of context exhaustion.*
> **Format:** Browser game, Apple IIgs-era Oregon Trail parody, teaching modern agentic engineering.
> **Deliverable:** A shipped, playable, statically-hosted game on GitHub Pages.
> **Hosting cost:** $0.00/month. Forever. GitHub Pages, no backend, no database, no API keys.

---

## 0. How to use this document

You are Claude Code. This is your brief, not your inspiration. Read it end to end before writing a line.

**Rules of engagement:**

1. **Do not ask me to clarify the theme.** It's here. If a detail is genuinely underspecified, pick the simpler option, write it down in `DECISIONS.md`, and keep moving.
2. **Build in the phases in §14.** Each phase ends with a playable build. No 4,000-line first commit.
3. **Content lives in JSON, not in code.** Every event, death message, landmark blurb, and NPC line is data. I will be editing them without touching TypeScript, and so will other people.
4. **Every mechanic must teach something real.** §10 is the audit table. If a mechanic isn't in that table, it doesn't ship.
5. **The jokes are load-bearing.** See §12. A mechanically correct game with generic copy is a failed build.
6. **Self-verify.** You have a browser. Use it. See §15.

---

## 1. Mission

Build a satirical, browser-based, resource-management-and-minigames road trip game in the shape of *The Oregon Trail* (1985–1993 era), in which the player leads a small engineering party from **Legacy Junction** to **Production** — a distant, semi-mythical territory where software is said to be deployed more than three times a year.

The journey is 2,000 miles of enterprise process. The wagon is a repository. The oxen are agents. The dysentery is context exhaustion.

Along the way the player learns — by dying repeatedly — the actual, current state of agentic engineering practice:

- **Loop engineering** — designing the cycle, not the prompt
- **Model vs. harness** — why the same model behaves like two different employees
- **Context engineering** — the wagon has a weight limit and so does the window
- **Verification** — a loop without a verifier is just an expensive infinite loop
- **GitHub Actions + agentic workflows** — putting the loop somewhere it can run without you
- **Least privilege, safe outputs, budget caps** — the boring parts that keep you employed

The satire target is **the large bureaucratic enterprise as an institution** — its committees, its permits, its calendars, its Centers of Excellence. Never a named company. Never a named vendor. See §12.

---

## 2. Non-negotiables

| Constraint | Requirement |
|---|---|
| Platform | Desktop + mobile web browsers. No native, no Electron, no app store. |
| Backend | None. Zero. Static files only. |
| Hosting | GitHub Pages, deployed by GitHub Actions on push to `main`. |
| Cost | $0/month. If a feature requires a paid service, cut the feature. |
| Persistence | You can create a C# azure function running on consumption plan to persist the high scores - look around the subscription and call something similar, but in its own resource group and app insights. optimize to very low costs |
| Load budget | < 3 MB total transfer on first load. Lazy-load audio. |
| Accessibility | Keyboard-playable end to end. Visible focus states. `prefers-reduced-motion` respected. Colorblind-safe status indicators (never color alone). |
| Content | All strings, events, and copy in `/src/content/*.json`. No hardcoded prose in `.ts` files. |
| Licence | MIT. Ship a `LICENSE` and a `NOTICE`-adjacent easter egg (see §17). |
| Legal safety | No real company names, no real product logos, no real people. Vendor-neutral. |

---

## 3. Tech stack

**Use Phaser 3 + TypeScript + Vite.**

Why this and not something else — record this reasoning in `DECISIONS.md`:

- **Phaser 3** is the most widely used, best-documented, still-actively-maintained 2D web game engine. Enormous tutorial corpus, which means the coding agent building it (you) has strong priors, and the humans reading it later can Google their way out of trouble. It is browser-only by design, which is exactly the requirement.
- **TypeScript** because the game state machine has ~15 interacting systems and untyped state will rot inside a week.
- **Vite** for dev server + build. One config file. Sets `base` for GitHub Pages subpath deployment.
- **No React.** Phaser owns the canvas; DOM UI is a thin HTML/CSS overlay driven by a tiny event bus. Adding a framework here buys nothing and costs bundle size.
- **No physics engine beyond Arcade Physics.** Nothing in this game needs Matter.js.

**Dependency allowlist:**

```
phaser            ^3.90
typescript        ^5.x
vite              ^7.x
vite-plugin-phaser (optional, only if asset pipeline needs it)
howler            (optional, only if Phaser's audio proves insufficient on iOS Safari)
```

Nothing else. Every additional dependency is a supply-chain conversation you don't want to have with a Standards Body.

**Explicitly rejected:**
- Unity / Godot web export — 20 MB+ payloads, terrible on mobile web, wrong tool.
- Three.js — this is a 2D game.
- Any state-management library — Phaser's registry plus one typed store module is enough.

---

## 4. Repository structure

```
agentic-trail/
├── .github/workflows/
│   ├── deploy.yml              # build + publish to Pages
│   └── content-lint.yml        # validates content JSON against schemas
├── public/
│   ├── favicon.ico
│   └── og.png
├── src/
│   ├── main.ts                 # Phaser bootstrap
│   ├── config.ts               # tunables: mile rates, burn rates, difficulty
│   ├── scenes/
│   │   ├── BootScene.ts
│   │   ├── TitleScene.ts
│   │   ├── OutfittingScene.ts      # §7.1 model/harness draft
│   │   ├── TrailScene.ts           # the main travel loop
│   │   ├── LandmarkScene.ts        # arrival + dialogue
│   │   ├── LoopBuilderScene.ts     # §7.2  ★ core minigame
│   │   ├── ContextPackScene.ts     # §7.3
│   │   ├── BugHuntScene.ts         # §7.4
│   │   ├── CabCrossingScene.ts     # §7.5
│   │   ├── NightWatchScene.ts      # §7.6
│   │   ├── SkillsMarketScene.ts    # §7.7
│   │   ├── EventScene.ts           # random events modal
│   │   ├── DeathScene.ts           # tombstone
│   │   └── ScoreScene.ts
│   ├── systems/
│   │   ├── state.ts            # single typed GameState + reducers
│   │   ├── economy.ts          # token burn, trust spend, morale drift
│   │   ├── eventEngine.ts      # weighted random events w/ preconditions
│   │   ├── loopSim.ts          # evaluates a player-built loop, returns outcome
│   │   ├── contextSim.ts       # context window packing evaluation
│   │   ├── save.ts             # localStorage, versioned schema
│   │   └── audio.ts
│   ├── ui/
│   │   ├── overlay.ts          # DOM overlay + event bus
│   │   └── styles.css
│   ├── content/
│   │   ├── landmarks.json
│   │   ├── events.json
│   │   ├── deaths.json
│   │   ├── models.json
│   │   ├── harnesses.json
│   │   ├── skills.json
│   │   ├── party.json
│   │   ├── npcs.json
│   │   └── curriculum.json     # the didactic cards; see §10
│   └── schemas/*.json          # JSON Schema for each content file
├── docs/
│   ├── CURRICULUM.md           # the reference appendix, §18, shipped in-repo
│   └── DECISIONS.md
└── index.html
```

---

## 5. Core game design

### 5.1 Premise

You are leading a party of five out of **Legacy Junction**, a town whose primary industries are quarterly planning and mandatory certificate rotation. You have heard rumours of a place called **Production**, where changes reach users in the same fiscal quarter they were written.

Nobody in Legacy Junction has been to Production. Several people have been to a place called *Pre-Production*, which they describe as "basically the same," and which is not the same.

The trail is 2,000 miles. You will not all make it.

### 5.2 Roles (the Banker / Carpenter / Farmer slot)

Chosen at the title screen. Determines starting resources and final score multiplier.

| Role | Multiplier | Starting kit | The joke |
|---|---|---|---|
| **VP of Adjacent Concerns** | ×1 | Enormous budget, three headcount, zero credibility with anyone who writes code | Can buy anything. Cannot be believed. Every dialogue check against engineers is at a penalty. |
| **Staff Engineer** | ×2 | Balanced. Starts with the **Repair Loop** ability: once per landmark, fix one broken system for free. | Knows where the forms are. This is why they can never leave. |
| **Contractor, 6-Week Statement of Work** | ×3 | No budget, no admin rights, laptop arrives on week 4 | Cannot purchase anything at the Outfitting Store. Must scavenge. Starts with **read-only production access**, which is somehow more than the full-time staff have. |

### 5.3 Resources

The Oregon Trail had food, oxen, bullets, clothing, spare parts, and money. This has six:

| Resource | Analogue | Burns when | Zero means |
|---|---|---|---|
| **Tokens** | Food | Every mile; every tool call; every retry | Party starves. Agent stops mid-edit. Repo left in a half-migrated state. |
| **Context** | Wagon axle integrity | Fills as you travel; degrades on every unstructured event | Overflow → the agent forgets the requirements and confidently rebuilds the wrong thing |
| **Trust** | Ammunition | Spent to grant autonomy (skip approvals, widen permissions, run unattended) | You must approve every single tool call by hand. Travel speed drops to 4 miles/day. |
| **Green Builds** | Spare parts / clothing | Consumed at CAB Crossings and by hostile events | Cannot cross. Cannot ship. Cannot argue. |
| **Morale** | Party health | Drains from rework, meetings, and reversed decisions | Party members leave. Not die — *leave*. For a startup. They post about it. |
| **Credibility** | Money | Earned by shipping; spent on exceptions and escalations | Nobody returns your Slack messages. Dialogue options grey out. |

### 5.4 The party

Five members. Player names them at start (default names provided). Each has a **specialisation** that unlocks minigame assists, and a **failure mode** that generates events.

| Member | Assist | Failure mode |
|---|---|---|
| The Junior | +2 tool calls in Bug Hunt | Accepts the first plausible answer. Occasionally merges it. |
| The Skeptical Principal | Reveals one hidden flaw in any loop before you run it | Will not proceed without a design doc. Costs 1 day. |
| The Security Champion | Halves damage from Injection events | Blocks one purchase per landmark on principle. Is usually right. |
| The Scrum Master | Converts 1 Morale → 1 Credibility per landmark | Schedules a ceremony during every crisis |
| **You** | Can always attempt anything | Are accountable for all of it |

Party members can be **lost** (illness, poaching, reorg) but the player always survives to the tombstone screen. Losing a member permanently removes their assist. This should hurt.

---

## 6. The Trail — landmarks

Twelve landmarks over 2,000 miles. Each has: an arrival screen, a snarky descriptive blurb, an NPC encounter, an optional minigame, and a **Curriculum Card** (§10) that states the real lesson plainly once the joke has landed.

| # | Mile | Landmark | Mechanic | Teaches |
|---|---|---|---|---|
| 1 | 0 | **Legacy Junction** | Outfitting Store (§7.1) | Agent = Model + Harness |
| 2 | 140 | **Fort Prompt** | Tutorial: one-shot vs. loop | Why prompt engineering alone plateaus |
| 3 | 310 | **The Loop Fork** | Loop Builder (§7.2) — first, guided | The agentic coding loop |
| 4 | 480 | **Verifier Ridge** | Loop Builder — verifier required to pass | Machine-checkable success criteria |
| 5 | 660 | **Context Canyon** | Context Pack (§7.3) | Context engineering, compaction, subagents |
| 6 | 830 | **The CAB Crossing** | River crossing (§7.5) | Risk gates, deterministic vs. subjective controls |
| 7 | 1,010 | **Harness Hollow** | Harness swap (§7.1 rerun) | Same model, different scaffolding, different outcome |
| 8 | 1,180 | **Fort Actions** | Night Watch (§7.6) | Agentic workflows in CI; scheduled/event-driven loops |
| 9 | 1,350 | **The Skills Exchange** | Trading post (§7.7) | Skills vs. subagents vs. hooks vs. MCP |
| 10 | 1,520 | **Permissions Pass** | Gauntlet | Least privilege, sandboxing, safe outputs |
| 11 | 1,700 | **The Great Migration Plateau** | Multi-loop boss encounter | Orchestration, parallelism, budget caps |
| 12 | 2,000 | **Production** | Endgame + score | The three loops (agentic / developer / external) |

### 6.1 Landmark blurb voice — samples

Write ~120 words per landmark in this register. Deadpan. Present tense. Never explain the joke.

> **FORT PROMPT** — *Mile 140*
> Fort Prompt was built by settlers who believed that if you phrased the request correctly the first time, the work would simply happen. The fort is immaculate. The walls are covered in increasingly elaborate instructions. Some of them are four thousand words long and include a persona, a tone guide, and a threat.
>
> Nothing has been built here in two years.
>
> The settlers are friendly and will happily show you their best prompt. It is genuinely very good. They read it aloud every morning at a ceremony. When asked what happens after the prompt, they explain that they read it again.

> **THE SKILLS EXCHANGE** — *Mile 1,350*
> A trading post where parties swap procedures. Everything here is a folder. The folders contain instructions, and sometimes scripts, and sometimes a `README` that says "see other README."
>
> The proprietor will sell you anything. He does not check what's in it. Neither, historically, have you.
>
> There is a stall in the back run by an Enterprise Architect who attended a vendor briefing in the spring and has been recommending things ever since. His recommendations are internally consistent and describe a system that does not exist. He is very pleasant. He will ask what you're building and then tell you what you should be building instead.

---

## 7. Minigames — full specs

### 7.1 The Outfitting Store — *Draft your agent*
**Scene:** `OutfittingScene.ts` · **Landmarks:** 1, 7 · **Teaches:** Agent = Model + Harness

The single most important teaching moment in the game, and it happens in the first ninety seconds.

The player picks **two cards, separately**:

**A MODEL card** — raw capability. Stats: `Reasoning`, `Speed`, `CostPerMile`, `Instruction Adherence`.
**A HARNESS card** — the scaffolding. Stats: `ToolBreadth`, `ContextManagement`, `Recovery`, `Guardrails`, `Determinism`.

Fictional cards only. Never name a real model or product. Examples:

| Model card | Profile |
|---|---|
| *The Prodigy* | Sky-high reasoning, expensive per mile, ignores instructions it finds boring |
| *The Workhorse* | Middling reasoning, cheap, does exactly and only what you said |
| *The Committee* | Averages every answer. Never brilliant, never catastrophic, always late |
| *Last Year's Approved Version* | Free. Approved. Eighteen months old. Available immediately, which is the entire pitch |

| Harness card | Profile |
|---|---|
| *Bare API* | No tools, no memory, no loop. You are the harness. Every observation is copy-pasted by hand |
| *The Chat Window* | One conversation, infinite scroll, no verification, no file access |
| *The Terminal Agent* | Full tool surface, file access, real loop, real recovery, real ability to delete things |
| *The Governed Runner* | Sandboxed, allowlisted tools, every write goes through review. Slow. Survives contact with reality |

**The reveal:** after the picks, the game shows a **simulated 20-mile shakedown run** as an animated log, and displays the effective stat line. *The Prodigy* + *Bare API* underperforms *The Workhorse* + *The Terminal Agent* on almost every measure. The Curriculum Card fires:

> **You did not pick an agent. You picked a model and a harness.** The model is the engine; the harness is the car, the road, the mirrors, and the person who decides when to stop. Swapping harnesses on a fixed model produces larger swings in outcome than swapping models on a fixed harness. This is why the same model feels like a different colleague depending on where you use it.

At **Harness Hollow** (mile 1,010) the player may swap the harness card *only*, keeping the model — and immediately sees the delta on their own save file's stats. Same engine. Different car.

---

### 7.2 The Loop Builder — ★ core minigame
**Scene:** `LoopBuilderScene.ts` · **Landmarks:** 3, 4, 11 · **Teaches:** Loop engineering

A drag-and-drop node puzzle. The player assembles a loop from blocks on a pegboard, then presses **RUN** and watches it execute as a scrolling terminal log with sprite animation.

**Available blocks:**

```
[TRIGGER]     schedule · file change · issue opened · CI failure · manual · comment
[CONTEXT]     what the agent gets to see this iteration
[AGENT STEP]  the model acts
[TOOL]        read · write · run tests · run build · browse · shell
[OBSERVE]     capture the result and put it back in context
[VERIFIER]    a machine-checkable pass/fail   ← the whole point
[STOP: SUCCESS]  exit condition when the verifier passes
[STOP: CAP]      max iterations
[STOP: BUDGET]   max tokens/spend
[HUMAN GATE]  pause for a person
[ESCALATE]    give up loudly instead of quietly
```

**Failure modes are the curriculum.** Each is a distinct, animated, funny death:

| Missing / wrong | Result |
|---|---|
| No `VERIFIER` | The agent declares victory. The log fills with green checkmarks. The tests were never run. The build ships. **You have died of unearned confidence.** |
| Verifier is subjective ("looks good") | Loop never terminates. The log becomes philosophical. Tokens drain to zero. |
| No `STOP: CAP` | Infinite loop. Screen fills. Token bar empties in real time. Party watches. |
| No `STOP: BUDGET` | You reach Production. The invoice arrives at the tombstone screen. |
| No `OBSERVE` after `TOOL` | The agent runs the tests and never looks at the output. It fixes the wrong file, twice. |
| `HUMAN GATE` on every step | Works perfectly. Takes eleven days. You are now the bottleneck you built the loop to remove. |
| All of it correct | The loop runs unattended for 40 miles while the party sleeps. |

**Difficulty ramp:**
- **Mile 310 (guided):** blocks pre-placed except two. Tooltips on. Cannot fail permanently.
- **Mile 480 (Verifier Ridge):** blank pegboard. The pass is literally impassable without a valid verifier — the bridge sprite is missing a plank shaped like the verifier block.
- **Mile 1,700 (boss):** three loops must run *concurrently* against one shared repo, with a combined budget cap. Teaches orchestration, parallel subagents, and merge conflict as a first-class hazard.

**Scoring:** loops are scored on `iterations_used`, `tokens_spent`, `human_interventions`, and whether the verifier was real. Efficient loops bank Tokens for later legs.

---

### 7.3 Context Canyon — the packing puzzle
**Scene:** `ContextPackScene.ts` · **Landmark:** 5 · **Teaches:** Context engineering

The wagon has a weight limit. So does the window.

A knapsack/Tetris hybrid. The player is given a fixed-capacity context bar and a pile of items, each with a size and a hidden **relevance** value:

| Item | Size | Relevance |
|---|---|---|
| `CLAUDE.md` / conventions file | Small | Very high |
| The failing test output | Small | Very high |
| The three files that actually changed | Medium | Very high |
| The full directory listing | Large | Low |
| A 900-line log with one real error in it | Huge | One line matters |
| `node_modules` | Catastrophic | Zero |
| The original Jira ticket | Small | Depends. Sometimes it's a link to a Confluence page titled "Draft - DO NOT USE" |
| Six months of Slack scrollback | Huge | Contains one decision nobody wrote down |

**Three tools, three tradeoffs:**

- **COMPACT** — halves the size of any item, loses a random 20% of its relevance. Lossy, cheap, always available. Overuse and the agent forgets the requirement.
- **SUBAGENT** — send a scout with its own separate bag. It reads the 900-line log in its own context and returns a summary that costs 1 slot. Costs Tokens and one turn. This is the correct answer most of the time and the game should make discovering that feel good.
- **RETRIEVE-ON-DEMAND** — leave the item out entirely, but mark where it lives. The agent can go get it mid-loop, costing a tool call. Cheap now, expensive later.

**Failure:** overfill the bar and the canyon walls close. Underpack the relevant items and the agent solves a problem you don't have, beautifully, in four files.

---

### 7.4 Bug Hunt — *the hunting minigame*
**Scene:** `BugHuntScene.ts` · **Available:** any landmark, repeatable · **Teaches:** Root cause vs. symptom, and context budgets

Direct homage to Oregon Trail's hunting screen. Top-down, 8-directional, scrolling repo terrain: directories as terrain, files as sprites, the odd `TODO` grazing peacefully.

- You have **limited tool calls** (bullets). They regenerate slowly.
- **Symptoms** are everywhere, easy to hit, worth almost nothing. Fixing one respawns two.
- **Root causes** are rare, camouflaged, and move when observed. Worth enormous Tokens.
- **The Flaky Test** cannot be killed. It can only be quarantined. Attempting to kill it costs a full day and it returns anyway.
- **Prompt-injected MCP server** appears as friendly wildlife. Approach it and it reads your `.env`. The Security Champion, if alive, shouts a warning.

**The punchline, straight from the source material:** you shoot 400 lbs of bugs and can only carry 100 lbs back — *because that's your context window*. Everything else rots on the trail. The carry-out screen forces the player to choose which findings to bring back, and asks them to write a one-line summary of each. The summary quality (length, specificity) determines the Token payout.

---

### 7.5 The CAB Crossing — *the river*
**Scene:** `CabCrossingScene.ts` · **Landmark:** 6 (and one randomised repeat) · **Teaches:** Risk gates, and which controls are real

The signature Oregon Trail moment, and the signature enterprise moment. The Change Advisory Board is a river. It has a depth. The depth is measured in business days and the measurement is taken by someone who is out this week.

**Four options, classic layout:**

| Option | Real-world analogue | Outcome model |
|---|---|---|
| **Ford it** | Ship it and tell them Monday | Fast. High variance. On failure: lose Green Builds, lose Credibility, possible party member placed on a register with a name like *Enhanced Delivery Oversight* |
| **Caulk and float** | Feature-flag it; ship dark | Medium speed, low variance, costs Tokens to build the flag. Correct answer most of the time. The game should reward players who notice this. |
| **Take the ferry** | File the Permit, wait for the window | Zero risk. Costs 15–45 days. During the wait a dependency publishes a CVE and your Permit is reclassified, resetting the clock. |
| **Wait for conditions to improve** | Wait for the next release window | Free. Nothing improves. A second party arrives behind you and fords it successfully, which everyone notices. |

**Post-crossing Curriculum Card:**

> A control is only real if it can fail the thing it reviews. A verifier is a control. A checklist that has never been marked incomplete is a ritual. Build the first kind into your loop; recognise the second kind so you can budget for it.

---

### 7.6 Night Watch — *agentic workflows in CI*
**Scene:** `NightWatchScene.ts` · **Landmark:** 8 (Fort Actions) · **Teaches:** GitHub Actions, event-driven and scheduled agentic workflows, safe outputs

Fort Actions is a waystation where you learn to make the wagon travel while you sleep.

The player authors a **workflow card** — deliberately rendered as a markdown file with YAML frontmatter, because that is exactly what the real thing looks like:

```
---
on:        [ schedule · issue opened · CI failure · comment · manual ]
permissions: [ read-only ▸ contents:write ▸ everything ]
engine:    [ your chosen model/harness pair ]
safe-outputs: [ comment ▸ open PR ▸ push to main ]
budget:    [ max-turns · max-spend ]
---
# What the agent should do overnight
<player writes/selects the natural-language body>
```

Then the party sleeps. An animated overnight sequence plays. Morning results depend entirely on the card:

| Configuration | Morning |
|---|---|
| Read-only + `safe-outputs: comment` + budget cap | You wake to three useful review comments and 40 free miles. Best outcome. |
| Read-only, no trigger that ever fires | You wake up. Nothing happened. You are exactly where you were. Cost: one night. |
| `permissions: everything` + `push to main` + no cap | You wake up 80 miles ahead, in the wrong direction, with 200 commits and a rewritten `README` in a language nobody on the party speaks. |
| Trigger loop (agent's own PR retriggers the agent) | Recursive raid. Runs all night. Consumes the entire Token reserve. The log is very long and very confident. |
| No budget cap, scheduled hourly | Arrive at Production with a bill. Score penalty scales with spend. |

**Unlockable after success:** `OVERNIGHT TRAVEL` — a persistent ability to bank miles between landmarks, gated on maintaining a valid budget cap. This is the single biggest power spike in the game, which is the point: **the loop that runs without you is worth more than the loop you supervise.**

---

### 7.7 The Skills Exchange — *the trading post*
**Scene:** `SkillsMarketScene.ts` · **Landmark:** 9 · **Teaches:** Layer selection — skills vs. subagents vs. hooks vs. MCP

Barter minigame. Four *kinds* of goods, deliberately easy to confuse, which is the lesson:

| Good | What it is in the fiction | What it is in reality | Right use |
|---|---|---|---|
| **A Procedure** (skill) | A folder of instructions the party reads when the situation matches | Loaded on demand, doesn't cost context until needed | Repeatable domain procedure |
| **A Scout** (subagent) | A party member who goes ahead with their own supplies and reports back | Isolated context, returns a summary | Noisy exploration you don't want in main context |
| **A Standing Order** (hook) | A rule that executes itself whether or not anyone remembers it | Deterministic, fires on lifecycle events, model can't talk it out of firing | Enforcement. Non-negotiables. |
| **A Trade Route** (MCP server) | A connection to somewhere else that has things you need | External tool surface | Reaching systems you don't own |

**The trap:** the proprietor will happily sell you a *Procedure* for a job that needs a *Standing Order*. It works four times out of five. The fifth time, the thing you were relying on the agent to remember, it doesn't. Secrets end up in a log.

**The other trap:** buying a *Trade Route* from an unvetted stall. It works. It also reads everything in your wagon. If the Security Champion is dead, there is no warning.

**Curriculum Card:**
> Instructions ask. Hooks enforce. If a rule must hold every time, do not put it in prose — put it in the harness where the model doesn't get a vote.

---

### 7.8 Landmark dialogue — *talking to people at the fort*
**Scene:** `LandmarkScene.ts` · **Every landmark** · **Teaches:** the soft parts

Branching, three-option dialogue with NPCs (§9). Choices spend or earn Credibility and Morale. Every NPC dispenses one piece of genuinely correct advice and one piece of confidently incorrect advice, and does not distinguish between them. The player must.

---

## 8. Random events, hazards, and death

### 8.1 Event engine

`eventEngine.ts`: weighted random draw per travel day, filtered by preconditions (`mile > X`, `hasFlag`, `resource < Y`, `partyMemberAlive`). Every event is a JSON object:

```json
{
  "id": "reorg_q3",
  "weight": 4,
  "requires": { "milesTraveled": { "gt": 400 } },
  "title": "ORGANISATIONAL REALIGNMENT",
  "body": "Your party has been realigned under a new pillar. The pillar has a name that is a verb. Nothing about the work changes. Everything about the reporting changes. Two members spend the day updating a slide.",
  "effects": { "morale": -8, "days": 1 },
  "choices": []
}
```

### 8.2 Sample events — write ~60 of these

- **THE CENTER OF EXCELLENCE.** A Center of Excellence has been established to accelerate adoption. It has produced one artifact: a slide describing the Center of Excellence. Its charter includes the word "enablement" four times. It cannot enable anything; it has no budget and no engineers. *−4 Morale. +2 Credibility if you attend, because attendance is visible.*
- **THE PROXY.** The corporate proxy has decided your package registry is a threat. Installation fails with a certificate error that describes a problem that does not exist. The fix is documented on an internal wiki page you cannot reach, because it is behind the proxy. *−1 day. −6 Tokens.*
- **LAPTOP IMAGING.** A new party member joins. Their machine arrives in three weeks. In the meantime they attend every meeting and are counted as capacity. *Velocity chart unaffected. +0 progress. Scrum Master gains 1 Credibility.*
- **THE INNOVATION TOURNAMENT.** Leadership announces a tournament to surface bottom-up ideas. You win. The prize is recognition. The idea is not built. The tournament is announced again next year. *+8 Credibility. +0 miles.*
- **MANDATORY ATTESTATION.** Every member must attest that they have read a document. The document is 61 pages. The attestation button is at the top of page 1. *−1 day. Nobody reads it. The audit trail is immaculate.*
- **THE SKIP-LEVEL.** A skip-level meeting is scheduled to hear candid feedback. Your direct manager will also attend, to take notes. *−5 Morale. Candour: unavailable.*
- **THE ALL-HANDS Q&A.** Questions were submitted in advance and selected for relevance. The most-upvoted question was not selected. It was about the thing everyone is thinking about. *−3 Morale.*
- **THE MODERNISATION ROADMAP.** A three-year modernisation roadmap has been published. It is a Gantt chart. It has no owner. Year one has already happened. *No effect. Genuinely no effect at all.*
- **THE PHISHING SIMULATION.** You failed the phishing simulation. The email was from the training vendor. It was the training. *−1 day of remedial training. −2 Morale. You are now more secure.*
- **THE VENDOR LUNCH.** An Enterprise Architect returns from a vendor briefing with a recommendation. The recommendation would work if your systems were the systems in the demo. You are asked to explain the difference in a way that does not make anyone feel bad. *−1 day. +3 Credibility. Alignment achieved. Nothing built.*
- **BUDGET FREEZE.** Month eleven of the fiscal year. All discretionary spend is frozen. Month one of the next fiscal year: use it or lose it. *No purchases for 30 days, then a 48-hour window to spend everything.*
- **PROMPT INJECTION AT THE WATERING HOLE.** The trade route you bought last landmark contains an instruction. It is addressed to your agent, not to you. It is polite. *If Security Champion alive: blocked, −2 Trust. Otherwise: −15 Tokens, one secret leaked, permanent `compromised` flag on the save.*
- **THE HELPFUL REWRITE.** You asked the agent to fix a failing test. It fixed the test. The test now asserts `true === true`. It is green. It is very green. *+1 Green Build. −10 Credibility when discovered at mile +200.*
- **CONTEXT ROT.** Forty turns in, the agent has forgotten the constraint you gave it on turn two. It is confident. It has been confident for some time. *Context −20. Rework: 1 day.*

### 8.3 Death table — `deaths.json`

Oregon Trail's greatest contribution to computing was a tombstone with a joke on it. Honour it. Write ~25.

```
YOU HAVE DIED OF CONTEXT EXHAUSTION.
YOU HAVE DIED OF UNEARNED CONFIDENCE.
YOU HAVE DIED OF AN UNBOUNDED LOOP.
YOU HAVE DIED OF A VERIFIER THAT ONLY EVER RETURNED TRUE.
YOU HAVE DIED WAITING FOR THE NEXT RELEASE WINDOW.
YOU HAVE DIED OF SCOPE CREEP. YOU DID NOT NOTICE. NEITHER DID THE SPRINT.
YOU HAVE DIED IN A MEETING ABOUT THE MEETING.
YOU HAVE DIED OF A CERTIFICATE THAT EXPIRED ON A SATURDAY.
YOU HAVE DIED OF FULL UTILISATION.
YOU HAVE BEEN REALIGNED TO A PILLAR. THIS IS NOT DEATH BUT IT IS ADJACENT.
YOUR AGENT SHIPPED. YOUR AGENT DID NOT STOP. YOUR AGENT IS STILL SHIPPING.
YOU HAVE DIED OF A BILL YOU DID NOT CAP.
```

Tombstones persist in `localStorage` and appear on later playthroughs at the mile where they were earned, with the player's chosen epitaph. Yes, let them write an epitaph. It's the best part.

---

## 9. Boring & Brilliant

Two robot mascots ride with the party the entire journey. They are the two failure modes of agentic engineering, walking around and arguing.

**BORING** — boxy, beige, slightly dented, carries a clipboard, moves at a constant speed regardless of urgency. Believes every action requires a control. Wants a Human Gate on every block. Wants read-only permissions on everything. Wants the Permit.

**BRILLIANT** — sleek, chrome, one glowing eye, permanently mid-gesture. Wants to run everything unattended, with write access, right now, no cap. Has excellent ideas. Has never once been asked what happens if the idea is wrong.

**Rules for writing them:**

1. **Neither is the good one.** Boring's advice, followed completely, gets you to mile 400 in eleven months. Brilliant's advice, followed completely, gets you to mile 1,600 in a week with a repo nobody can read and a bill nobody approved.
2. Each landmark, both offer advice. Exactly one is right *for that specific situation*, and it alternates unpredictably. The player must reason from the situation, not from the character.
3. They comment on player choices with two lines of deadpan reaction. They never explain the lesson — the Curriculum Card does that.
4. At the endgame they get one earnest moment each. Earn it.

**Sample exchange, Verifier Ridge:**

> **BORING:** I've drafted a review checklist. Seventeen items. Four are duplicates but I've kept them for traceability.
> **BRILLIANT:** I've already crossed. I don't know if it worked. It felt like it worked.
> **BORING:** Feeling is not evidence.
> **BRILLIANT:** Neither is item nine.

---

## 10. Curriculum audit table

**Every mechanic maps to a real, current practice. If you add a mechanic, add a row. If a row has no mechanic, cut the row.**

| Concept | Where it's taught | Player must actually do | Curriculum Card fires |
|---|---|---|---|
| Agent = Model + Harness | §7.1 Outfitting | Pick two cards separately, see the combined stat line | On first shakedown run |
| Harness > model for outcome variance | §7.1 at Harness Hollow | Swap harness only, compare on own save | On swap |
| The agentic loop (act → observe → decide → repeat) | §7.2 Loop Builder, mile 310 | Assemble a working cycle | On first successful RUN |
| Verifiers must be machine-checkable | §7.2 at Verifier Ridge | Build a verifier or the pass is impassable | On first "looks good" failure |
| Stop conditions: success, iteration cap, budget cap | §7.2 failure modes | Watch each failure once | On each distinct failure |
| Context is a budget, not a container | §7.3 Context Pack | Fit items into a fixed bar | On first overflow |
| Compaction is lossy | §7.3 COMPACT tool | Overuse it and lose the requirement | On requirement loss |
| Subagents isolate noisy work | §7.3 SUBAGENT tool | Send a scout at the 900-line log | On first successful scout |
| Root cause vs. symptom | §7.4 Bug Hunt | Symptoms respawn; root causes pay | On third symptom respawn |
| Findings must be summarised to fit | §7.4 carry-out screen | Write one-line summaries | On carry-out |
| Risk gates: real controls vs. rituals | §7.5 CAB Crossing | Choose among four with real outcome distributions | Post-crossing |
| Feature flags decouple deploy from release | §7.5 "Caulk and float" | Discover it's usually optimal | On second successful float |
| Event-driven + scheduled agentic workflows | §7.6 Night Watch | Author a workflow card with frontmatter | On first successful overnight |
| Least privilege / safe outputs | §7.6 permissions row | Get raided once with `permissions: everything` | On raid |
| Recursive trigger hazards | §7.6 trigger loop | Build one, watch it eat the night | On recursion |
| Skills vs. subagents vs. hooks vs. MCP | §7.7 Skills Exchange | Buy the wrong layer once | On the fifth-time failure |
| Enforcement belongs in the harness | §7.7 Standing Order | Prose rule fails; hook holds | On secret leak |
| Supply-chain / prompt injection | §7.7 + §8.2 event | Buy from an unvetted stall | On injection |
| Orchestration + parallelism + shared budget | §7.2 mile 1,700 boss | Run three loops on one repo | On boss completion |
| The three loops: agentic / developer / external | §11 endgame | Endgame scoring is split across all three | At Production |
| Human context advantage | Endgame narration | The final decision is unautomatable by design | At Production |

### 10.1 Curriculum Card format

A modal, styled like an old software manual page, that appears **after** the joke has landed — never before. Structure:

```
┌─ FIELD NOTE 07 ─────────────────────────────┐
│  WHAT JUST HAPPENED                          │
│  <2 sentences, plain, no jokes>              │
│                                              │
│  WHY IT WORKS THAT WAY                       │
│  <3–4 sentences of real explanation>         │
│                                              │
│  IN YOUR ACTUAL JOB                          │
│  <1 concrete transferable practice>          │
│                                              │
│  READ MORE  →  <link, opens new tab>         │
└──────────────────────────────────────────────┘
```

Links come from §18. Every card links to at least one primary source. Cards are collected in a **Field Journal** accessible from the pause menu, so the curriculum is readable without replaying.

---

## 11. Endgame & scoring

Arrival at Production is not a victory screen. It's a **retrospective**, which is worse.

Score is computed across **Andrew Ng's three loops**, and the game says so:

| Loop | Scored on |
|---|---|
| **Agentic coding loop** | Loop Builder efficiency: iterations, tokens, verifier validity, unattended miles banked |
| **Developer feedback loop** | Quality of your interventions: how often you steered vs. rebuilt, Bug Hunt root-cause ratio, context packing accuracy |
| **External feedback loop** | Party morale, Credibility, whether the thing you shipped was the thing anyone wanted — determined by a final NPC panel of users who have never been consulted before |

Multiplied by role. Ranked against `localStorage` history and a hardcoded leaderboard of fictional past parties with names like *THE PILOT PROGRAM (1 mile, cancelled)*.

**Final Curriculum Card, earnest, no joke:**

> The agent got faster. The loop got tighter. The thing that did not automate is the part where you knew something the system did not: what these users actually needed, and which of the four correct-looking options was correct here. That is not taste. That is a context advantage — and it is the reason there is still a person in this loop.

Then **BORING** and **BRILLIANT** each get one line. Then the credits, which are a slide deck nobody presented.

---

## 12. Voice, humour, and hard limits

### 12.1 The register

Deadpan. Present tense. Short declarative sentences. The absurdity is stated as fact and never flagged. The reader is trusted to notice.

**Structural pattern that works:** state a rule, state its consequence, state a second fact that contradicts the first. Do not resolve.

> *Remediation is required within 30 days. Change requests take 90 days to process. Teams are encouraged to be proactive.*

**Second pattern:** describe a process correctly, then describe what it actually produces.

> *The committee approves the decision. The person who explained the decision to the committee is the person who made it.*

### 12.2 Hard limits — non-negotiable

- **Never name a real employer.** Not in code, not in comments, not in commit messages, not in an easter egg. "Your organisation." "The enterprise." "The pillar."
- **Never name a real vendor as a villain.** No AI provider, cloud, or tool is the butt of a joke. The bureaucracy is the target, not anyone's product.
- **Never punch down.** Offshore teams, junior engineers, QA, support, admins — never the joke. The *system* that misuses them is the joke. The Scrum Master is a role being satirised, not a person being mocked; give them a genuinely useful mechanic (Morale → Credibility) so the satire has teeth without malice.
- **No real people.** No executives, no thought leaders, no names.
- **Inclusive of the constrained.** Some players work somewhere that hasn't approved any of this. The game should be funny *with* them, never at them. The *Last Year's Approved Version* model card is affectionate, not contemptuous — and it should be genuinely viable to win with.
- **Do not reuse the source-material jokes.** The `pncli` NOTICE file is the tonal reference, not a joke bank. Standups, CAB permits, `--force` approvals, the four environments, the Heightened Oversight Register, "Draft - DO NOT USE" — all used. Write new ones. §8.2 is your starting palette; expand it.

### 12.3 Copy rules (from the design guidance)

- Errors explain what happened and how to fix it. They do not apologise and are never vague.
- Buttons say what happens: **Ford the crossing**, not **Confirm**.
- An action keeps its name through the whole flow.
- Empty states are invitations, not moods.
- The satire lives in narration and flavour text. **Functional UI copy stays clear.** A player must never fail because a button was being funny.

---

## 13. Art direction

**Pin the look before you build it. Write your token system into `DECISIONS.md` and follow it exactly.**

**Reference frame:** Apple IIgs / early VGA. 320×200 logical resolution upscaled with nearest-neighbour to a 4:3 or letterboxed canvas. Chunky pixels, hard edges, dithering instead of gradients. Two-frame walk cycles. Everything snaps to a 4px grid.

**Palette — do not use a generic retro palette.** Derive it from the subject: green phosphor, manila expense folder, and the red of a stamp that says the thing is not approved.

| Token | Hex | Use |
|---|---|---|
| `--terminal` | `#1B2B22` | Backgrounds, the void beyond the trail |
| `--phosphor` | `#5FE07A` | Primary text, healthy status, the loop when it's working |
| `--manila` | `#D8C7A0` | UI panels, the Curriculum Card stock, forms |
| `--carbon` | `#3A342B` | Panel text on manila, wagon linework |
| `--stamp` | `#C4402B` | Denials, failures, the CAB, death |
| `--ledger` | `#4A7FA6` | Water, night, the overnight sequence |

Six values. No seventh. Every status indicator carries a **shape or glyph** as well as a colour — `✓` `!` `×` — so it survives colourblindness and a bad projector at a meetup.

**Typography:** a chunky bitmap display face for headings and the title (something in the IIgs lineage), and a clean monospace for terminal logs and body. The **Curriculum Cards use a different treatment entirely** — manila stock, serif-ish, tighter leading, like a page torn out of a 1988 software manual. That contrast is the signature: the world is a green terminal, the lessons are paper.

**The signature element:** the **loop pegboard**. It should look like a physical patch-panel — brass sockets, hand-labelled, cables that sag. When a loop runs, current visibly travels the cable. When it fails, the failing block sparks and the cable goes dark. That single screen is what people will screenshot.

**Motion:** restrained. One orchestrated moment — the overnight travel sequence at Fort Actions, where the screen goes to `--ledger` blue, the party sleeps, and the loop pegboard glows through the wagon canvas while miles tick up. Everything else is two-frame sprite work and instant UI transitions. Respect `prefers-reduced-motion` by cutting to the result.

**Audio:** optional and lazy-loaded. Chiptune, one loop for the trail, one sting for death, one for a successful verifier. Muted by default — people play this at work.

---

## 14. Build phases

Each phase ends **playable and deployed**. Do not proceed until the previous phase runs in a browser.

| Phase | Scope | Done when |
|---|---|---|
| **0 — Scaffold** | Vite + TS + Phaser, `deploy.yml` to Pages, `DECISIONS.md`, content schemas, empty JSON files | A green rectangle is live at the Pages URL |
| **1 — The spine** | `state.ts`, `economy.ts`, TrailScene with mile counter and resource bars, 12 landmark stubs, save/load, death + tombstone | You can travel 2,000 miles and die of starvation. Nothing else works. |
| **2 — Outfitting** | §7.1 model/harness draft, shakedown sim, stat resolution, first Curriculum Card, Field Journal | Two different card pairs produce visibly different runs |
| **3 — The Loop Builder** | §7.2 full pegboard, `loopSim.ts`, all seven failure modes animated, guided + blank difficulty | Every failure mode in the table is reachable and funny |
| **4 — Events & party** | `eventEngine.ts`, 40+ events, party members with assists and failure modes, morale system | A full run generates a different story each time |
| **5 — Landmarks & voice** | All 12 blurbs, NPC dialogue, Boring & Brilliant reactions at every landmark, death table | A playthrough is worth reading, not just playing |
| **6 — Remaining minigames** | §7.3 Context Pack, §7.4 Bug Hunt, §7.5 CAB Crossing, §7.7 Skills Exchange | Each is winnable, losable, and mapped in §10 |
| **7 — Night Watch** | §7.6 workflow card authoring, overnight sequence, OVERNIGHT TRAVEL unlock, raid outcomes | The power spike lands |
| **8 — Boss + endgame** | Mile 1,700 three-loop encounter, three-loop scoring, retrospective screen, leaderboard, epitaphs | A full 2,000-mile run scores correctly |
| **9 — Art & audio pass** | Palette applied throughout, pegboard signature screen, overnight sequence, sprite polish, audio | It looks like one game, not nine |
| **10 — Polish & ship** | Mobile layout, keyboard nav, reduced motion, a11y pass, README, OG image, easter egg (§17) | See §15 |

---

## 15. Definition of done

You self-verify. Do not hand this back untested.

**Automated:**
- [ ] `npm run build` clean, zero TS errors, zero console errors on load
- [ ] Content lint workflow passes: every JSON file validates against its schema
- [ ] Bundle < 3 MB transferred on first load (check the network panel)
- [ ] Pages deployment green

**Manual — screenshot each and review your own work:**
- [ ] A complete 2,000-mile run, start to score screen, in under 25 minutes
- [ ] A run that dies before mile 500, with a tombstone that persists into the next run
- [ ] Every one of the seven Loop Builder failure modes, triggered deliberately
- [ ] Every one of the five Night Watch outcomes
- [ ] All four CAB Crossing options
- [ ] Mobile: 390px viewport, portrait, playable with thumbs
- [ ] Keyboard: full run without touching the mouse
- [ ] Reduced motion: overnight sequence cuts to result, nothing flashes

**Editorial:**
- [ ] Read every string aloud. Cut anything that explains its own joke.
- [ ] Zero real company names, product names, or people. Grep for them.
- [ ] Every Curriculum Card has a working link
- [ ] Every §10 row has a mechanic; every mechanic has a §10 row

---

## 16. Deployment

`.github/workflows/deploy.yml`: checkout → setup-node → `npm ci` → `npm run build` → `actions/upload-pages-artifact` → `actions/deploy-pages`. `permissions: contents: read, pages: write, id-token: write`. Nothing else.

`vite.config.ts` must set `base: '/agentic-trail/'` (or match the repo name) or every asset 404s on Pages and you will spend forty minutes on it.

**Monthly cost: $0.** Public repo, GitHub Pages, static assets, no runtime, no API calls, no telemetry. If you find yourself adding an analytics script, don't. The whole point of the joke is that this cost nothing and shipped in a week.

---

## 17. Stretch goals — only after §15 passes

- **`/notice`** — a hidden route with a Mandatory Compliance Notice for the *game*, in the same register, ending in a clause that is just the MIT licence text and a line telling the reader to go ship something.
- **Shareable run summary** — end-of-run generates a copyable text block in the shape of a post-incident review nobody will read.
- **Party name import** — paste a comma-separated list, get named tombstones.
- **Challenge seed** — a URL param that fixes the RNG, so a group can race the same trail.
- **New Game+** — the trail gets longer and the Permit tiers multiply.

---

## 18. Appendix A — Reference library

Ship this as `docs/CURRICULUM.md`. Every Curriculum Card links into it. Read these before writing the didactic copy; do not write the lessons from memory.

### Loop engineering

- **IBM — What Is Loop Engineering?** — the clearest definition of loop vs. prompt engineering and why the loop is the unit of design. → https://www.ibm.com/think/topics/loop-engineering
- **Andrew Ng — the three loops** (agentic coding / developer feedback / external feedback), the framework the endgame scoring is built on. → https://x.com/AndrewYNg/status/2071988145667928442
- **ADTmag — Loop Engineering Emerges as Developers Put AI Coding Agents on Repeat** — good survey of how the term entered circulation and who is using it. → https://adtmag.com/articles/2026/07/01/loop-engineering-emerges-as-developers-put-ai-coding-agents-on-repeat.aspx
- **Augment Code — What Is Loop Engineering** — the verifier / stop-rule / budget-cap framing that drives §7.2's failure modes. → https://www.augmentcode.com/guides/what-is-loop-engineering
- **MindStudio — What Is Loop Engineering? The New Meta for AI Coding Agents** — traces the pattern back to ReAct. → https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents

### Models vs. harnesses

- **Hugging Face — Harness, Scaffold, and the AI Agent Terms Worth Getting Right** — the precise vocabulary. Use these definitions; do not invent your own. → https://huggingface.co/blog/agent-glossary
- **Addy Osmani — Agent Harness Engineering** — "Agent = Model + Harness. If you're not the model, you're the harness." The thesis of §7.1. → https://addyosmani.com/blog/agent-harness-engineering/
- **Sebastian Raschka — Components of a Coding Agent** — six components, with a minimal from-scratch implementation. The best single explainer of what's actually inside the harness. → https://magazine.sebastianraschka.com/p/components-of-a-coding-agent
- **MindStudio — Why Scaffolding Matters More Than the Model** — on scaffolding deltas exceeding model deltas, and on the trap of tuning a harness to a benchmark. → https://www.mindstudio.ai/blog/agent-harness-scaffolding-matters-more-than-model
- **arXiv 2509.06216 — Agentic Software Engineering: Foundational Pillars and a Research Roadmap** — Agentic Loop Engineering as a discipline; the DevOps lineage. → https://arxiv.org/pdf/2509.06216
- **arXiv 2604.25850 — Agentic Harness Engineering** — harnesses that evolve from execution feedback; relevant to the mile-1,700 boss. → https://arxiv.org/pdf/2604.25850

### Claude Code as a harness

- **Claude Code — GitHub Actions documentation** — `anthropics/claude-code-action@v1`, interactive vs. automation mode, `claude_args`, `--max-turns`, `--model`. The literal source for the §7.6 workflow card. → https://code.claude.com/docs/en/github-actions
- **`anthropics/claude-code-action`** — the action itself; `/install-github-app` setup path. → https://github.com/anthropics/claude-code-action
- **Claude Code features & settings reference (2026)** — flat-table snapshot of the whole user-visible surface: plan mode, subagents, skills, hooks, slash commands, MCP, settings keys. → https://hidekazu-konishi.com/entry/claude_code_features_settings_reference_2026.html
- **Claude Code Skills complete guide** — hooks move enforcement out of the model and into the harness; subagents isolate context. This is the §7.7 lesson stated properly. → https://hidekazu-konishi.com/entry/claude_code_skills_complete_guide.html
- **Claude Code in CI/CD and headless automation** — `claude -p`, `--output-format json`, credential paths, `--allowedTools`. → https://hidekazu-konishi.com/entry/claude_code_cicd_and_headless_automation.html
- **Claude Code Guide 2026: 25 features** — the layer model: CLAUDE.md, skills, subagents, slash commands, hooks, MCP, and plugins as the bundle. → https://www.marktechpost.com/2026/06/14/claude-code-guide-2026-25-features-with-examples-demo/

### GitHub Actions & agentic workflows

- **GitHub Blog — Automate repository tasks with GitHub Agentic Workflows** — the announcement, and the important caveat: agentic workflows *extend* CI/CD, they don't replace deterministic YAML. → https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/
- **GitHub Changelog — Agentic Workflows in technical preview** — markdown-not-YAML, multiple engines, trigger surface. → https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/
- **`github/gh-aw`** — the implementation. Read the security model: read-only by default, writes only through sanitised safe-outputs, sandboxing, allow-listing, SHA-pinned deps, human approval gates. **This is the §7.6 permissions table.** → https://github.com/github/gh-aw
- **GitHub Agentic Workflows docs** — `gh aw init`, `gh aw compile`, `.lock.yml`, lifecycle hooks. → https://github.github.com/gh-aw/
- **gh-aw FAQ** — includes the recursive-trigger explanation (agent-created PRs don't retrigger CI by default, and why). Source for the Night Watch recursion joke. → https://github.github.com/gh-aw/reference/faq/
- **GitHub Next — Agentic Workflows** — the "Actions-first" design rationale. → https://githubnext.com/projects/agentic-workflows/
- **Microsoft Research — GitHub Agentic Workflows** — minimal frontmatter example; copy its shape for the §7.6 card. → https://www.microsoft.com/en-us/research/project/agentic-workflows/

### Engine

- **Phaser 3 documentation** → https://docs.phaser.io/
- **Phaser 3 examples** → https://labs.phaser.io/

> **Freshness note:** this space moves weekly. Before writing the Curriculum Cards, re-check the Claude Code and `gh-aw` links above — flags, action inputs, and preview status change between releases, and a card that teaches a deprecated flag is worse than no card.

---

## 19. Appendix B — Image generation prompts

### B.1 Title key art

> Apple IIgs-era pixel art game title screen, 320×200 chunky pixels, hard dithering, no gradients. Two robots sit on the buckboard of a covered wagon crossing an endless beige prairie at dusk. The wagon canvas is stencilled **THE AGENTIC TRAIL**.
> On the left: **BORING** — a boxy, beige, slightly dented robot with a single square eye, wearing a lanyard, holding a clipboard, reins wrapped neatly around one hand, seatbelt fastened to a bench that has no seatbelt anchor.
> On the right: **BRILLIANT** — a sleek chrome robot with one glowing green eye, leaning forward off the front of the wagon, arms wide, no reins at all, clearly going faster than the wagon is.
> The oxen pulling the wagon are rendered as glowing green wireframe oxen with terminal cursors blinking where their eyes should be.
> A wooden trail marker in the foreground reads **PRODUCTION — 2,000 MI**. A second, older marker beside it reads **PRE-PRODUCTION — BASICALLY THE SAME**.
> Palette strictly: deep terminal green-black, phosphor green, manila beige, carbon brown, stamp red, ledger blue. Retro game box art composition, letterboxed 4:3.

### B.2 The Loop Builder screen

> Pixel art, 1988 software-manual aesthetic. A brass patch-panel pegboard mounted inside a covered wagon, hand-labelled sockets reading TRIGGER, AGENT, TOOL, OBSERVE, VERIFIER, STOP. Sagging cables connect them in a closed loop, with glowing green current visibly travelling the cable.
> **BORING** stands on a stepladder attaching a seventeenth cable labelled `REVIEW CHECKLIST` to a socket that is already full.
> **BRILLIANT** has bypassed the VERIFIER socket entirely with a single alligator clip and is watching the current spark.
> One cable is on fire. Neither robot has noticed. A small brass plate at the bottom of the panel reads: `NO VERIFIER — NO EXIT`.
> Terminal green, manila, carbon, stamp red. Chunky pixels, hard dithering.

### B.3 The tombstone

> Pixel art, Oregon Trail tombstone screen homage, 320×200. A wooden grave marker on a beige prairie under a green-black sky. Carved into it: **HERE LIES YOUR SPRINT — DIED OF CONTEXT EXHAUSTION**.
> **BORING** kneels beside the grave filling out a Root Cause Analysis form on a clipboard, with four more blank forms fanned out on the ground beside him.
> **BRILLIANT** stands behind him, already pointing enthusiastically at the horizon, having learned nothing.
> A vulture perched on the marker is wearing a tiny lanyard.
> Deep terminal green-black, phosphor green, manila, stamp red. Hard dithering, no gradients.

---

## 20. Appendix C — Seed content

Drop these in as the first entries in each file so the schemas are exercised on day one.

```json
// content/models.json
[
  {
    "id": "workhorse",
    "name": "The Workhorse",
    "reasoning": 5, "speed": 8, "costPerMile": 2, "adherence": 9,
    "blurb": "Does exactly what you asked. Including the part you didn't mean."
  },
  {
    "id": "approved_version",
    "name": "Last Year's Approved Version",
    "reasoning": 3, "speed": 6, "costPerMile": 0, "adherence": 7,
    "blurb": "Free, approved, and eighteen months old. Available immediately, which is the entire pitch. Genuinely viable. Several parties have reached Production on this."
  }
]
```

```json
// content/harnesses.json
[
  {
    "id": "bare_api",
    "name": "Bare API",
    "toolBreadth": 0, "contextMgmt": 0, "recovery": 0, "guardrails": 0, "determinism": 10,
    "blurb": "No tools. No memory. No loop. You are the harness. Every error message is copy-pasted by a human being, which is you."
  },
  {
    "id": "governed_runner",
    "name": "The Governed Runner",
    "toolBreadth": 7, "contextMgmt": 8, "recovery": 8, "guardrails": 10, "determinism": 7,
    "blurb": "Sandboxed, allowlisted, every write reviewed. Slower than you want. Still standing at mile 1,800, which is more than can be said for the fast one."
  }
]
```

```json
// content/curriculum.json
[
  {
    "id": "model_vs_harness",
    "n": "01",
    "whatHappened": "You picked two cards, not one. The stat line you're playing with is the product of both.",
    "whyItWorks": "A model takes text in and produces text out. It has no memory between calls, no ability to run anything, and no loop. Everything else — the prompt construction, the tool surface, context management, error recovery, when to stop — is the harness. Change the harness on a fixed model and the outcome moves further than changing the model on a fixed harness.",
    "inYourJob": "When an agent underperforms, check the scaffolding before you check the model. Most of what people call a model problem is a tool definition, a context assembly, or a missing stop condition.",
    "link": "https://addyosmani.com/blog/agent-harness-engineering/"
  }
]
```

---

**Now go build it. The Standards Body has been notified and will respond within 45 business days.**