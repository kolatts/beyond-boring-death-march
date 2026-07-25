/**
 * ScoreScene — arrival at Production is a RETROSPECTIVE, which is worse.
 *
 * Spec §11: score is computed across Andrew Ng's three loops, and the
 * screen says so plainly:
 *   Agentic coding loop  — best Loop Builder run, verifier validity,
 *                          unattended (Night Watch) miles, the boss
 *   Developer feedback   — Bug Hunt root-cause ratio, Context Pack
 *                          packing accuracy, interventions, floats
 *   External feedback    — morale, credibility, survivors, deadlines,
 *                          and a final panel of users consulted for the
 *                          first time
 *
 * Two ending variants: on-time vs "compliance victory" (every compliance
 * deadline met, business deadline missed, leadership declares victory,
 * there is a slide). Ranked against localStorage history + the fictional
 * historical record + the live hall of fame (GET /scores); the score is
 * POSTed. Fires curriculum cards `three_loops` then the earnest
 * `human_context_advantage`, then Boring & Brilliant's endgame lines,
 * then the credits (a slide deck nobody presented), then the §17
 * shareable run summary (COPY RUN SUMMARY, clipboard with fallback).
 *
 * Keyboard: Enter/Space advances everything; the final page is DOM
 * buttons in tab order. Retro slide transitions honor reduced motion.
 * All prose lives in src/content/endgame.json + boring-brilliant.json.
 */

import Phaser from 'phaser';
import { BUSINESS_DEADLINE_DAY, GAME_WIDTH, GAME_HEIGHT, ROLES, TOTAL_MILES } from '../config';
import { actions, getState, hasRun, type GameState } from '../systems/state';
import { clearRun } from '../systems/save';
import { loadLoopStore } from '../systems/loopSim';
import { loadNightWatchRecord } from '../systems/nightWatchSim';
import { loadStats as loadContextStats } from '../systems/contextSim';
import { readCabStore } from '../systems/cabSim';
import { loadBossRecord } from './BossScene';
import { fetchTopScores, postScore, roleApiName, type RemoteScore } from '../systems/social';
import { showCurriculumCard, isFieldNoteOpen } from '../ui/curriculumCard';
import { bus, mountPanel, unmountPanel } from '../ui/overlay';
import rawEndgame from '../content/endgame.json';
import rawBB from '../content/boring-brilliant.json';

const PANEL_ID = 'run-summary';
const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const VIOLET = '#bb36ff';
const ORANGE = '#f55d08';
const BLUE = '#0da1ff';

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

interface Ending {
  heading: string;
  lines: string[];
}

interface EndgameContent {
  arrival: { title: string; sub: string; retroNotice: string };
  endings: { onTime: Ending; compliance: Ending };
  reckoning: { met: string; missed: string; surprise: string };
  loops: {
    intro: string;
    agentic: { title: string; sub: string };
    developer: { title: string; sub: string };
    external: { title: string; sub: string };
  };
  panel: { intro: string; users: { id: string; name: string; good: string; bad: string }[] };
  leaderboard: {
    hallTitle: string;
    hallOffline: string;
    recordTitle: string;
    recordedLine: string;
    fictional: { name: string; miles: number; days: number; score: number; note: string }[];
  };
  credits: { title: string; slides: { heading: string; body: string }[] };
  summary: { copyLabel: string; copiedLabel: string; lines: string[] };
  finish: { returnLabel: string; finalLine: string };
}

const CONTENT = rawEndgame as unknown as EndgameContent;
const BB = rawBB as unknown as { endgame: { boring: string; brilliant: string } };

// ---------------------------------------------------------------------------
// Local score history — bbdm:scores
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'bbdm:scores';

interface HistoryEntry {
  name: string;
  score: number;
  role: string;
  days: number;
  miles: number;
  when: string;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? (list as HistoryEntry[]).filter((e) => typeof e?.score === 'number')
      : [];
  } catch {
    return [];
  }
}

function appendHistory(entry: HistoryEntry): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([...loadHistory(), entry].slice(-50)));
  } catch {
    /* storage blocked: the run still scored */
  }
}

// ---------------------------------------------------------------------------
// Three-loop scoring
// ---------------------------------------------------------------------------

interface LoopScores {
  agentic: number;
  developer: number;
  external: number;
  base: number;
  total: number;
  multiplier: number;
  detail: { agentic: string[]; developer: string[]; external: string[] };
}

function clamp0(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Bug Hunt kill stats, read defensively — the store may predate them. */
function bugHuntRatio(): { ratio: number; known: boolean } {
  try {
    const raw = window.localStorage.getItem('bbdm:bughunt');
    if (!raw) return { ratio: 0, known: false };
    const p = JSON.parse(raw) as Record<string, unknown>;
    const roots = typeof p['rootCauses'] === 'number' ? (p['rootCauses'] as number) : null;
    const symptoms = typeof p['symptoms'] === 'number' ? (p['symptoms'] as number) : null;
    if (roots === null || symptoms === null || roots + symptoms === 0) return { ratio: 0, known: false };
    return { ratio: roots / (roots + symptoms), known: true };
  } catch {
    return { ratio: 0, known: false };
  }
}

function computeScores(s: GameState): LoopScores {
  const role = ROLES[s.role];
  const multiplier = role.scoreMultiplier;

  // --- Agentic coding loop ---------------------------------------------
  const loops = loadLoopStore();
  const banked = loops.best?.score.tokensBanked ?? 0;
  const verifierReal = loops.best?.score.verifierReal ?? false;
  const night = loadNightWatchRecord();
  const unattended = night?.unlocked && night.budget !== 'none';
  const uncapped = night?.uncappedSpend ?? 0;
  const boss = loadBossRecord();
  const bossWon = Boolean(s.flags['bossLoopsWon']) || boss.won;
  const agentic = clamp0(
    banked * 4 + (verifierReal ? 100 : 0) + (unattended ? 150 : 0) + (bossWon ? 200 : 0) - Math.min(200, uncapped),
  );
  const agenticDetail = [
    `BEST LOOP: ${banked} TOKENS BANKED ACROSS ${loops.runs} RUN${loops.runs === 1 ? '' : 'S'}`,
    `VERIFIER: ${verifierReal ? '✓ MACHINE-CHECKABLE' : '× NEVER PROVED REAL'}`,
    `UNATTENDED MILES: ${unattended ? '✓ OVERNIGHT TRAVEL HELD ITS CAP' : '× NONE BANKED'}`,
    `THE GREAT MIGRATION: ${bossWon ? '✓ THREE LOOPS, ONE REPO, UNDER BUDGET' : '× DID NOT CONVERGE'}`,
  ];
  if (uncapped > 0) agenticDetail.push(`UNCAPPED OVERNIGHT SPEND: -${Math.min(200, uncapped)}`);

  // --- Developer feedback loop -----------------------------------------
  const hunt = bugHuntRatio();
  const pack = loadContextStats();
  const packAccuracy = pack.plays > 0 ? pack.successes / pack.plays : 0;
  const interventions = loops.best?.score.humanInterventions ?? 0;
  const floats = readCabStore().floats;
  const developer = clamp0(
    hunt.ratio * 150 + packAccuracy * 150 + pack.scoutsSent * 10 + floats * 20 - interventions * 5,
  );
  const developerDetail = [
    `ROOT CAUSE RATIO: ${hunt.known ? `${Math.round(hunt.ratio * 100)}% OF KILLS WERE CAUSES` : 'NO HUNTS ON RECORD'}`,
    `CONTEXT PACKING: ${pack.plays > 0 ? `${Math.round(packAccuracy * 100)}% CLEAN CROSSINGS, ${pack.scoutsSent} SCOUTS` : 'NEVER PACKED THE WAGON'}`,
    `STEERED, NOT REBUILT: ${interventions} HAND INTERVENTIONS IN THE BEST LOOP`,
    `SHIPPED DARK: ${floats} CAULK-AND-FLOAT CROSSING${floats === 1 ? '' : 'S'}`,
  ];

  // --- External feedback loop ------------------------------------------
  const alive = s.party.filter((m) => m.alive).length;
  const businessMet = !(Boolean(s.flags['businessDeadlineMissed']) || s.day > BUSINESS_DEADLINE_DAY);
  const external = clamp0(
    s.resources.morale * 2 +
      s.resources.credibility * 3 +
      alive * 40 +
      s.deadlinesMet * 25 -
      s.deadlinesMissed * 40 +
      (businessMet ? 250 : 0),
  );
  const externalDetail = [
    `MORALE ${Math.round(s.resources.morale)} · CREDIBILITY ${Math.round(s.resources.credibility)}`,
    `PARTY: ${alive}/${s.party.length} STILL HERE (THE OTHERS POST ABOUT IT)`,
    `DEADLINES: ${s.deadlinesMet} MET / ${s.deadlinesMissed} ESCALATED`,
    `BUSINESS DEADLINE: ${businessMet ? '✓ THE DATE STILL MEANT SOMETHING' : '× DECLARED A VICTORY ANYWAY'}`,
  ];

  const base = Math.round(Math.min(s.mile, TOTAL_MILES) / 2);
  const total = Math.round((agentic + developer + external + base) * multiplier);

  return {
    agentic,
    developer,
    external,
    base,
    total,
    multiplier,
    detail: { agentic: agenticDetail, developer: developerDetail, external: externalDetail },
  };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

type Page = 'retro' | 'loops' | 'panel' | 'board' | 'bb' | 'credits' | 'final';

const PAGE_ORDER: readonly Page[] = ['retro', 'loops', 'panel', 'board', 'bb', 'credits', 'final'];

export class ScoreScene extends Phaser.Scene {
  private page: Page = 'retro';
  private slideIdx = 0;
  private drawn: Phaser.GameObjects.GameObject[] = [];
  private scores: LoopScores | null = null;
  private missed = false;
  private hall: RemoteScore[] | null = null;
  private hallLoaded = false;
  private scoreRecorded = false;
  private scorePosted = false;
  private cardsShown = false;
  private reducedMotion = false;
  private transitioning = false;

  constructor() {
    super('Score');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    this.page = 'retro';
    this.slideIdx = 0;
    this.hall = null;
    this.hallLoaded = false;
    this.scoreRecorded = false;
    this.scorePosted = false;
    this.cardsShown = false;
    this.transitioning = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const s = getState();
    this.missed = Boolean(s.flags['businessDeadlineMissed']) || s.day > BUSINESS_DEADLINE_DAY;
    this.scores = computeScores(s);
    this.cameras.main.setBackgroundColor('#000000');

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', () => this.advance());
      kb.on('keydown-SPACE', () => this.advance());
    }

    this.events.once('shutdown', () => unmountPanel(PANEL_ID));
    this.redraw();
    bus.emit('scene:ready', { scene: 'Score' });
  }

  // -------------------------------------------------------------------------
  // Paging — retro slide transitions (instant under reduced motion)
  // -------------------------------------------------------------------------

  private advance(): void {
    if (isFieldNoteOpen() || this.transitioning) return;
    if (this.page === 'final') return; // DOM buttons own the final page.

    if (this.page === 'credits' && this.slideIdx < CONTENT.credits.slides.length - 1) {
      this.slideIdx += 1;
      this.transitionRedraw();
      return;
    }

    const idx = PAGE_ORDER.indexOf(this.page);
    const next = PAGE_ORDER[idx + 1];
    if (!next) return;

    // Leaving the leaderboard: the curriculum cards fire, in order, then
    // Boring & Brilliant get their earnest moment.
    if (this.page === 'board' && !this.cardsShown) {
      this.cardsShown = true;
      this.transitioning = true;
      void showCurriculumCard('three_loops')
        .then(() => showCurriculumCard('human_context_advantage'))
        .then(() => {
          this.transitioning = false;
          this.page = 'bb';
          this.transitionRedraw();
        });
      return;
    }

    this.page = next;
    if (next === 'board') this.enterBoard();
    this.transitionRedraw();
  }

  private transitionRedraw(): void {
    if (this.reducedMotion) {
      this.redraw();
      return;
    }
    this.transitioning = true;
    this.cameras.main.fadeOut(120, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.redraw();
      this.cameras.main.fadeIn(120, 0, 0, 0);
      this.transitioning = false;
    });
  }

  private enterBoard(): void {
    const s = getState();
    const scores = this.scores;
    if (!scores) return;
    const name = s.party[0]?.name ?? 'Anonymous';

    if (!this.scoreRecorded) {
      this.scoreRecorded = true;
      appendHistory({
        name,
        score: scores.total,
        role: ROLES[s.role].name,
        days: s.day,
        miles: Math.floor(Math.min(s.mile, TOTAL_MILES)),
        when: new Date().toISOString(),
      });
      // POST the score; the "recorded" line appears only on a real 2xx.
      void postScore({
        name,
        score: scores.total,
        role: roleApiName(s.role),
        days: Math.max(1, s.day),
        miles: Math.floor(Math.min(s.mile, TOTAL_MILES)),
        deadlinesMet: s.deadlinesMet,
        deadlinesMissed: s.deadlinesMissed,
        businessDeadlineMet: !this.missed,
      }).then((ok) => {
        this.scorePosted = ok;
        if (this.scene.isActive() && this.page === 'board') this.redraw();
      });
    }
    void fetchTopScores().then((hall) => {
      this.hall = hall;
      this.hallLoaded = true;
      if (this.scene.isActive() && this.page === 'board') this.redraw();
    });
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private text(
    x: number,
    y: number,
    str: string,
    color: string,
    size = 8,
    wrap = 0,
  ): Phaser.GameObjects.Text {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color,
      lineSpacing: 2,
    };
    if (wrap > 0) style.wordWrap = { width: wrap };
    const t = this.add.text(x, y, str, style).setOrigin(0, 0);
    this.drawn.push(t);
    return t;
  }

  private centered(y: number, str: string, color: string, size = 8, wrap = GAME_WIDTH - 16): Phaser.GameObjects.Text {
    const t = this.text(GAME_WIDTH / 2, y, str, color, size, wrap);
    t.setOrigin(0.5, 0);
    t.setAlign('center');
    return t;
  }

  private footer(label = 'ENTER TO CONTINUE'): void {
    this.centered(GAME_HEIGHT - 10, label, BLUE, 7);
  }

  private redraw(): void {
    this.drawn.forEach((o) => o.destroy());
    this.drawn = [];
    unmountPanel(PANEL_ID);

    switch (this.page) {
      case 'retro':
        this.drawRetro();
        break;
      case 'loops':
        this.drawLoops();
        break;
      case 'panel':
        this.drawPanel();
        break;
      case 'board':
        this.drawBoard();
        break;
      case 'bb':
        this.drawBB();
        break;
      case 'credits':
        this.drawCredits();
        break;
      case 'final':
        this.drawFinal();
        break;
    }
  }

  private drawRetro(): void {
    const s = getState();
    this.centered(6, CONTENT.arrival.title, WHITE, 12);
    this.centered(22, CONTENT.arrival.sub, GREEN, 7);

    const ending = this.missed ? CONTENT.endings.compliance : CONTENT.endings.onTime;
    this.centered(40, ending.heading, this.missed ? VIOLET : GREEN, 9);
    this.centered(54, ending.lines.join('\n'), this.missed ? ORANGE : GREEN, 7);

    const r = CONTENT.reckoning;
    const deadlineLine = (this.missed ? r.missed : r.met)
      .replaceAll('{day}', String(BUSINESS_DEADLINE_DAY))
      .replaceAll('{arrived}', String(s.day));
    const surpriseLine = r.surprise
      .replaceAll('{met}', String(s.deadlinesMet))
      .replaceAll('{missed}', String(s.deadlinesMissed));
    this.centered(140, `${deadlineLine}\n${surpriseLine}`, this.missed ? VIOLET : BLUE, 7);

    this.centered(170, CONTENT.arrival.retroNotice, ORANGE, 7);
    this.footer('ENTER TO BE RETROSPECTED');
  }

  private drawLoops(): void {
    const scores = this.scores;
    if (!scores) return;
    this.centered(4, 'THE RETROSPECTIVE', WHITE, 10);
    this.centered(17, CONTENT.loops.intro, BLUE, 6);

    const blocks: { key: 'agentic' | 'developer' | 'external'; y: number }[] = [
      { key: 'agentic', y: 38 },
      { key: 'developer', y: 86 },
      { key: 'external', y: 134 },
    ];
    for (const b of blocks) {
      const meta = CONTENT.loops[b.key];
      this.text(8, b.y, `${meta.title} ......... ${scores[b.key]}`, WHITE, 8);
      this.text(14, b.y + 10, scores.detail[b.key].join('\n'), GREEN, 6, GAME_WIDTH - 24);
    }
    this.text(8, 180, `+ ${scores.base} FOR THE MILES THEMSELVES`, BLUE, 7);
    this.footer();
  }

  private drawPanel(): void {
    const s = getState();
    this.centered(4, 'THE USER PANEL', WHITE, 10);
    this.centered(17, CONTENT.panel.intro, BLUE, 6);

    const alive = s.party.filter((m) => m.alive).length;
    const businessMet = !this.missed;
    const verdictFor = (id: string): boolean => {
      if (id === 'invoicer') return businessMet;
      if (id === 'operator') return s.resources.morale >= 40 && alive >= 4;
      return s.resources.credibility >= 50;
    };

    CONTENT.panel.users.forEach((u, i) => {
      const good = verdictFor(u.id);
      const y = 52 + i * 42;
      this.text(8, y, `${good ? '✓' : '×'} ${u.name}`, good ? GREEN : VIOLET, 8);
      this.text(14, y + 10, good ? u.good : u.bad, good ? GREEN : ORANGE, 6, GAME_WIDTH - 24);
    });
    this.footer();
  }

  private drawBoard(): void {
    const scores = this.scores;
    const s = getState();
    if (!scores) return;
    const role = ROLES[s.role];

    this.centered(4, `FINAL SCORE: ${scores.total}`, WHITE, 12);
    this.centered(
      20,
      `(${scores.agentic} + ${scores.developer} + ${scores.external} + ${scores.base}) x${scores.multiplier} — ${role.name}`,
      BLUE,
      7,
    );

    // Live hall of fame (top 4).
    this.text(8, 36, CONTENT.leaderboard.hallTitle, WHITE, 8);
    if (!this.hallLoaded) {
      this.text(14, 47, 'Consulting the record...', GREEN, 7);
    } else if (!this.hall) {
      this.text(14, 47, CONTENT.leaderboard.hallOffline, ORANGE, 6, GAME_WIDTH - 24);
    } else if (this.hall.length === 0) {
      this.text(14, 47, 'No party has scored before yours. Act surprised.', GREEN, 7);
    } else {
      this.hall.slice(0, 4).forEach((e, i) => {
        this.text(
          14,
          47 + i * 9,
          `${String(i + 1).padStart(2)}. ${e.name.slice(0, 14).padEnd(14)} ${String(e.score).padStart(6)}  DAY ${e.days}`,
          GREEN,
          7,
        );
      });
    }

    // Historical record: fictional parties + your local history + this run.
    this.text(8, 92, CONTENT.leaderboard.recordTitle, WHITE, 8);
    const yours: { name: string; score: number; note: string; you?: boolean } = {
      name: (s.party[0]?.name ?? 'YOU').toUpperCase(),
      score: scores.total,
      note: this.missed ? 'a compliance victory' : 'arrived on time',
      you: true,
    };
    const record = [
      ...CONTENT.leaderboard.fictional.map((f) => ({ name: f.name, score: f.score, note: f.note })),
      ...loadHistory()
        .slice(0, -1) // current run was just appended; it renders as `yours`
        .slice(-2)
        .map((h) => ({ name: `${h.name.toUpperCase()} (PRIOR MARCH)`, score: h.score, note: `day ${h.days}` })),
      yours,
    ].sort((a, b) => b.score - a.score);

    record.slice(0, 8).forEach((e, i) => {
      const isYou = 'you' in e && e.you === true;
      this.text(
        14,
        103 + i * 9,
        `${String(i + 1).padStart(2)}. ${e.name.slice(0, 22).padEnd(22)} ${String(e.score).padStart(6)}  ${e.note}`,
        isYou ? WHITE : GREEN,
        6,
      );
    });

    if (this.scorePosted) this.centered(180, CONTENT.leaderboard.recordedLine, GREEN, 6);
    this.footer();
  }

  private drawBB(): void {
    this.centered(8, 'TWO ROBOTS, ONE EARNEST MOMENT EACH', WHITE, 9);
    this.text(8, 34, 'BORING:', BLUE, 8);
    this.text(8, 46, BB.endgame.boring, GREEN, 7, GAME_WIDTH - 16);
    this.text(8, 108, 'BRILLIANT:', ORANGE, 8);
    this.text(8, 120, BB.endgame.brilliant, GREEN, 7, GAME_WIDTH - 16);
    this.footer();
  }

  private drawCredits(): void {
    const slide = CONTENT.credits.slides[this.slideIdx];
    if (!slide) return;
    this.centered(6, CONTENT.credits.title, BLUE, 7);
    // The slide: a manila-adjacent rectangle nobody presented.
    const rect = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 40, 120, 0xffffff, 0.06)
      .setStrokeStyle(1, 0x0da1ff, 0.6);
    this.drawn.push(rect);
    this.centered(52, slide.heading, WHITE, 9);
    this.centered(72, slide.body, GREEN, 7, GAME_WIDTH - 60);
    this.centered(
      164,
      `${this.slideIdx + 1} / ${CONTENT.credits.slides.length} — nobody is presenting this`,
      VIOLET,
      6,
    );
    this.footer('ENTER FOR NEXT SLIDE');
  }

  private drawFinal(): void {
    const scores = this.scores;
    if (!scores) return;
    this.centered(10, 'END OF MARCH', WHITE, 12);
    this.centered(30, `FINAL SCORE: ${scores.total}`, GREEN, 10);
    this.centered(50, CONTENT.finish.finalLine, BLUE, 7);
    this.mountFinalPanel();
  }

  // -------------------------------------------------------------------------
  // §17 — the shareable run summary
  // -------------------------------------------------------------------------

  private buildSummary(): string {
    const s = getState();
    const scores = this.scores;
    const role = ROLES[s.role];
    if (!scores) return '';
    const alive = s.party.filter((m) => m.alive).length;
    const subs: Record<string, string> = {
      '{title}': 'BEYOND BORING: DEATH MARCH',
      '{status}': this.missed ? 'RESOLVED-WITH-SLIDE' : 'RESOLVED',
      '{days}': String(s.day),
      '{miles}': String(Math.floor(Math.min(s.mile, TOTAL_MILES))),
      '{alive}': String(alive),
      '{role}': role.name,
      '{mult}': String(scores.multiplier),
      '{startTokens}': String(role.starting.tokens),
      '{deadlineOutcome}': this.missed ? 'missed; declared a victory' : 'met; nobody knew what to do',
      '{agentic}': String(scores.agentic),
      '{developer}': String(scores.developer),
      '{external}': String(scores.external),
      '{base}': String(scores.base),
      '{score}': String(scores.total),
      '{met}': String(s.deadlinesMet),
      '{missed}': String(s.deadlinesMissed),
    };
    return CONTENT.summary.lines
      .map((line) => Object.entries(subs).reduce((acc, [k, v]) => acc.replaceAll(k, v), line))
      .join('\n');
  }

  private mountFinalPanel(): void {
    const panel = mountPanel(PANEL_ID);
    panel.setAttribute(
      'style',
      [
        'position:absolute',
        'left:50%',
        'top:62%',
        'transform:translate(-50%,0)',
        'display:flex',
        'gap:12px',
        'font-family:monospace',
      ].join(';'),
    );

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = CONTENT.summary.copyLabel;
    copyBtn.addEventListener('click', () => {
      const text = this.buildSummary();
      const done = (): void => {
        copyBtn.textContent = CONTENT.summary.copiedLabel;
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    });

    const returnBtn = document.createElement('button');
    returnBtn.className = 'btn';
    returnBtn.textContent = CONTENT.finish.returnLabel;
    returnBtn.addEventListener('click', () => this.finish());

    panel.append(copyBtn, returnBtn);
    copyBtn.focus();
  }

  private finish(): void {
    unmountPanel(PANEL_ID);
    clearRun();
    actions.endRun();
    this.scene.start('Title');
  }
}

/** Clipboard fallback: hidden textarea + execCommand for older engines. */
function fallbackCopy(text: string, done: () => void): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    /* the review remains unfiled, which is traditional */
  }
  ta.remove();
}
