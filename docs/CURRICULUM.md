# BEYOND BORING: DEATH MARCH — Reference Library

Every Curriculum Card in the game links into this library. These are the primary sources the
didactic copy was written from. Read them in order within a section and you have a working
education in current agentic engineering practice, which is more than the trail ever promised you.

Cards live in `src/content/curriculum.json`. Each card's `link` field points at exactly one
entry below. The game's educational layer teaches the real tools by name — Claude Code, the
Claude Agent SDK, GitHub Actions, `gh-aw`, `claude-code-action`, MCP — while the fiction stays
vendor-neutral. Attributions for borrowed frameworks live here, not in player-facing copy.

---

## Claude Code as a harness

The layer model — CLAUDE.md, skills, subagents, hooks, slash commands, MCP — and why choosing
the right layer is the actual engineering decision.

- **Claude Code docs — Subagents**
  Separate context windows, custom agents in `.claude/agents`, when isolation beats
  conversation. The scout at the 900-line log, stated properly.
  → https://code.claude.com/docs/en/sub-agents

- **Claude Code docs — Hooks**
  Deterministic enforcement on lifecycle events. Hooks fire whether or not the model
  remembers; prose is advisory. The Standing Order lesson.
  → https://code.claude.com/docs/en/hooks

- **Claude Code docs — Skills**
  Instructions loaded on demand: the procedure layer, and how it differs from the
  enforcement and isolation layers. The Skills Exchange lesson.
  → https://code.claude.com/docs/en/skills

- **Claude Code docs — MCP**
  Connecting agents to external systems, and the trust boundary every connection crosses.
  → https://code.claude.com/docs/en/mcp

- **Claude Code docs — Memory (CLAUDE.md)**
  The durable, re-read-every-iteration home for constraints that must survive compaction.
  → https://code.claude.com/docs/en/memory

- **Claude Code features & settings reference (2026)**
  Flat-table snapshot of the whole user-visible surface: plan mode, subagents, skills, hooks,
  slash commands, MCP, settings keys.
  → https://hidekazu-konishi.com/entry/claude_code_features_settings_reference_2026.html

- **Claude Code Skills complete guide**
  Hooks move enforcement out of the model and into the harness; subagents isolate context.
  → https://hidekazu-konishi.com/entry/claude_code_skills_complete_guide.html

- **Claude Code Guide 2026: 25 features**
  The layer model: CLAUDE.md, skills, subagents, slash commands, hooks, MCP, and plugins as
  the bundle.
  → https://www.marktechpost.com/2026/06/14/claude-code-guide-2026-25-features-with-examples-demo/

## Claude Agent SDK

The same loop, programmable: build your own harness on the machinery Claude Code runs on.

- **Claude Agent SDK — Overview**
  The agentic loop as a library: context management, tools, permissions, sessions.
  → https://code.claude.com/docs/en/agent-sdk/overview

- **Claude Agent SDK — Subagents**
  Programmatic fan-out: each subagent gets its own context and tool scope. The source for
  the orchestration lesson at the Migration Plateau boss.
  → https://code.claude.com/docs/en/agent-sdk/subagents

- **Claude Agent SDK — Permissions**
  Tool allow-listing and permission modes — least privilege as an API surface.
  → https://code.claude.com/docs/en/agent-sdk/permissions

- **Claude Code in CI/CD and headless automation**
  `claude -p`, `--output-format json`, credential paths, `--allowedTools`.
  → https://hidekazu-konishi.com/entry/claude_code_cicd_and_headless_automation.html

## GitHub Actions & agentic workflows

Loops hosted where they run without you: triggers, permissions, budgets, safe outputs.

- **Claude Code — GitHub Actions documentation**
  `anthropics/claude-code-action@v1`, interactive vs. automation mode, `claude_args`,
  `--max-turns`, `--model`. The literal source for the Night Watch workflow card.
  → https://code.claude.com/docs/en/github-actions

- **`anthropics/claude-code-action`**
  The action itself; the `/install-github-app` setup path.
  → https://github.com/anthropics/claude-code-action

- **GitHub Blog — Automate repository tasks with GitHub Agentic Workflows**
  The announcement, and the important caveat: agentic workflows *extend* CI/CD, they don't
  replace deterministic YAML.
  → https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/

- **GitHub Changelog — Agentic Workflows in technical preview**
  Markdown-not-YAML, multiple engines, trigger surface — including the schedule triggers
  that turn recurring compliance toil into a workflow instead of a Friday surprise.
  → https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/

- **`github/gh-aw`**
  The implementation. Read the security model: read-only by default, writes only through
  sanitised safe-outputs, sandboxing, allow-listing, SHA-pinned deps, human approval gates.
  This is the Night Watch permissions table, and the model for what a real (non-ritual)
  risk gate looks like.
  → https://github.com/github/gh-aw

- **GitHub Agentic Workflows docs**
  `gh aw init`, `gh aw compile`, `.lock.yml`, lifecycle hooks.
  → https://github.github.com/gh-aw/

- **gh-aw FAQ**
  Includes the recursive-trigger explanation (agent-created PRs don't retrigger CI by default,
  and why). Source for the Night Watch recursion outcome.
  → https://github.github.com/gh-aw/reference/faq/

- **GitHub Next — Agentic Workflows**
  The "Actions-first" design rationale.
  → https://githubnext.com/projects/agentic-workflows/

- **Microsoft Research — GitHub Agentic Workflows**
  Minimal frontmatter example; the shape of the Night Watch workflow card.
  → https://www.microsoft.com/en-us/research/project/agentic-workflows/

## Loop engineering

- **IBM — What Is Loop Engineering?**
  The clearest definition of loop vs. prompt engineering and why the loop is the unit of design.
  → https://www.ibm.com/think/topics/loop-engineering

- **Andrew Ng — the three loops**
  Agentic coding loop / developer feedback loop / external feedback loop — the framework the
  endgame scoring is built on. (This is the attribution the endgame screen points at.)
  → https://x.com/AndrewYNg/status/2071988145667928442

- **ADTmag — Loop Engineering Emerges as Developers Put AI Coding Agents on Repeat**
  A survey of how the term entered circulation and who is using it.
  → https://adtmag.com/articles/2026/07/01/loop-engineering-emerges-as-developers-put-ai-coding-agents-on-repeat.aspx

- **Augment Code — What Is Loop Engineering**
  The verifier / stop-rule / budget-cap framing that drives the Loop Builder's failure modes.
  → https://www.augmentcode.com/guides/what-is-loop-engineering

- **MindStudio — What Is Loop Engineering? The New Meta for AI Coding Agents**
  Traces the pattern back to ReAct.
  → https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents

## Models vs. harnesses

- **Hugging Face — Harness, Scaffold, and the AI Agent Terms Worth Getting Right**
  The precise vocabulary. The game uses these definitions rather than inventing its own.
  → https://huggingface.co/blog/agent-glossary

- **Addy Osmani — Agent Harness Engineering**
  "Agent = Model + Harness. If you're not the model, you're the harness." The thesis of the
  Outfitting Store.
  → https://addyosmani.com/blog/agent-harness-engineering/

- **Sebastian Raschka — Components of a Coding Agent**
  Six components, with a minimal from-scratch implementation. The best single explainer of
  what is actually inside the harness.
  → https://magazine.sebastianraschka.com/p/components-of-a-coding-agent

- **MindStudio — Why Scaffolding Matters More Than the Model**
  On scaffolding deltas exceeding model deltas, and on the trap of tuning a harness to a
  benchmark. The lesson of Harness Hollow.
  → https://www.mindstudio.ai/blog/agent-harness-scaffolding-matters-more-than-model

- **arXiv 2509.06216 — Agentic Software Engineering: Foundational Pillars and a Research Roadmap**
  Agentic Loop Engineering as a discipline; the DevOps lineage.
  → https://arxiv.org/pdf/2509.06216

- **arXiv 2604.25850 — Agentic Harness Engineering**
  Harnesses that evolve from execution feedback; relevant to the Migration Plateau boss.
  → https://arxiv.org/pdf/2604.25850

## Engine

- **Phaser 3 documentation**
  → https://docs.phaser.io/

- **Phaser 3 examples**
  → https://labs.phaser.io/

---

> **Freshness note:** this space moves weekly. Before revising Curriculum Cards, re-check the
> Claude Code and `gh-aw` links above — flags, action inputs, and preview status change between
> releases, and a card that teaches a deprecated flag is worse than no card.
