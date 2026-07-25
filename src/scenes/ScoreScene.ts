/**
 * ScoreScene — endgame stub, reachable at mile 2000.
 *
 * Shows miles / days / deadlines met+missed and branches the ending text
 * on the businessDeadlineMissed flag ("compliance victory"). Real
 * three-loop scoring, the retrospective, and the leaderboard arrive in
 * the endgame wave — the placeholder copy below is marked for it.
 */

import Phaser from 'phaser';
import { BUSINESS_DEADLINE_DAY, GAME_WIDTH, ROLES, TOTAL_MILES } from '../config';
import { actions, getState, hasRun } from '../systems/state';
import { clearRun } from '../systems/save';
import { bus } from '../ui/overlay';

const WHITE = '#ffffff';
const GREEN = '#1bcb01';
const VIOLET = '#bb36ff';
const BLUE = '#0da1ff';

export class ScoreScene extends Phaser.Scene {
  constructor() {
    super('Score');
  }

  create(): void {
    if (!hasRun()) {
      this.scene.start('Title');
      return;
    }
    const s = getState();
    const role = ROLES[s.role];
    const missed = Boolean(s.flags['businessDeadlineMissed']) || s.day > BUSINESS_DEADLINE_DAY;
    this.cameras.main.setBackgroundColor('#000000');

    this.add
      .text(GAME_WIDTH / 2, 8, 'YOU HAVE REACHED PRODUCTION', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: WHITE,
      })
      .setOrigin(0.5, 0);

    // TODO(endgame-wave): replace with the retrospective + three-loop
    // scoring + leaderboard. Ending copy moves to content JSON.
    const endingText = missed
      ? 'Every compliance deadline was met. The business deadline was not.\nLeadership has declared this a win. There is a slide.'
      : 'It is before Day 120. The thing arrived while the date still meant something.\nNobody is sure what to do at a launch that happens on time. There is no slide.';
    this.add
      .text(GAME_WIDTH / 2, 28, endingText, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: missed ? VIOLET : GREEN,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 16 },
      })
      .setOrigin(0.5, 0);

    const aliveCount = s.party.filter((m) => m.alive).length;
    const stats = [
      `MILES:              ${Math.floor(Math.min(s.mile, TOTAL_MILES))}`,
      `DAYS:               ${s.day} (GO-LIVE WAS DAY ${BUSINESS_DEADLINE_DAY})`,
      `BUSINESS DEADLINE:  ${missed ? '× MISSED' : '✓ MET'}`,
      `SURPRISE DEADLINES: ${s.deadlinesMet} MET / ${s.deadlinesMissed} ESCALATED`,
      `PARTY REMAINING:    ${aliveCount}/${s.party.length}`,
      `ROLE:               ${role.name} (x${role.scoreMultiplier})`,
      `TOKENS UNSPENT:     ${Math.round(s.resources.tokens)}`,
    ].join('\n');
    this.add
      .text(GAME_WIDTH / 2, 76, stats, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: BLUE,
        align: 'left',
        lineSpacing: 3,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(GAME_WIDTH / 2, 168, 'The retrospective begins in an hour. Attendance is mandatory.', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: GREEN,
      })
      .setOrigin(0.5, 0);

    const btn = this.add
      .text(GAME_WIDTH / 2, 186, '> RETURN TO LEGACY JUNCTION', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: WHITE,
      })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.finish());

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', () => this.finish());
      kb.on('keydown-SPACE', () => this.finish());
    }

    bus.emit('scene:ready', { scene: 'Score' });
  }

  private finish(): void {
    clearRun();
    actions.endRun();
    this.scene.start('Title');
  }
}
