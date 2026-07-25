/**
 * Chiptune audio (spec §13: optional, lazy, MUTED BY DEFAULT).
 *
 * No audio assets: everything is WebAudio oscillators, so the module costs
 * zero bytes of transfer. Nothing touches the AudioContext until the player
 * both performs a gesture and unmutes (M key or the corner control) —
 * people play this at work.
 *
 * Surface:
 *   mountAudioControl()  — corner mute button + M key, call once at boot
 *   setBed('trail' | 'night' | null) — ambient loop for the current scene
 *   sting('death' | 'verifier')      — one-shot stings
 *
 * Mute state persists in localStorage (bbdm:muted, default muted).
 */

const MUTE_KEY = 'bbdm:muted';
const CONTROL_ID = 'audio-control';

type Bed = 'trail' | 'night' | null;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let currentBed: Bed = null;
let bedTimer: number | null = null;
let bedNodes: { stop: () => void } | null = null;

// ---------------------------------------------------------------------------
// Mute state
// ---------------------------------------------------------------------------

export function isMuted(): boolean {
  try {
    const raw = window.localStorage.getItem(MUTE_KEY);
    return raw === null ? true : raw === '1'; // muted by default
  } catch {
    return true;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage blocked: mute state simply doesn't persist */
  }
}

export function toggleMute(): void {
  const next = !isMuted();
  writeMuted(next);
  if (next) {
    stopBedNow();
    void ctx?.suspend();
  } else {
    ensureContext();
    void ctx?.resume();
    playBed(currentBed); // resume the scene's ambient loop
  }
  syncControl();
}

// ---------------------------------------------------------------------------
// Context plumbing (created only on unmute — a user gesture by definition)
// ---------------------------------------------------------------------------

function ensureContext(): void {
  if (ctx) return;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.14;
  master.connect(ctx.destination);
}

function active(): boolean {
  return !isMuted() && ctx !== null && master !== null;
}

/** One note: square/triangle blip with a fast decay envelope. */
function note(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = 'square',
  gain = 0.5,
): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// ---------------------------------------------------------------------------
// Beds — ambient loops per scene
// ---------------------------------------------------------------------------

/** The trail loop: a plodding two-bar square arpeggio. Oxen-paced. */
const TRAIL_STEPS: (number | 0)[] = [
  196, 0, 262, 294, 330, 0, 294, 262, 196, 0, 262, 294, 349, 330, 294, 262,
];
const TRAIL_BASS: (number | 0)[] = [98, 0, 0, 0, 131, 0, 0, 0, 98, 0, 0, 0, 87, 0, 0, 0];
const TRAIL_STEP_S = 0.22;

function startTrailBed(): void {
  if (!ctx) return;
  let step = 0;
  let nextAt = ctx.currentTime + 0.05;
  const tick = (): void => {
    if (!ctx || !active()) return;
    // Schedule ahead of the timer's jitter.
    while (nextAt < ctx.currentTime + 0.3) {
      const melody = TRAIL_STEPS[step % TRAIL_STEPS.length] ?? 0;
      const bass = TRAIL_BASS[step % TRAIL_BASS.length] ?? 0;
      if (melody) note(melody, nextAt, TRAIL_STEP_S * 0.9, 'square', 0.22);
      if (bass) note(bass, nextAt, TRAIL_STEP_S * 1.8, 'triangle', 0.4);
      nextAt += TRAIL_STEP_S;
      step++;
    }
  };
  bedTimer = window.setInterval(tick, 120);
  bedNodes = {
    stop: () => {
      /* interval cleared by stopBedNow */
    },
  };
}

/** The overnight pad: two detuned triangles, ledger-blue in audio form. */
function startNightBed(): void {
  if (!ctx || !master) return;
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const env = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  oscA.type = 'triangle';
  oscB.type = 'triangle';
  oscA.frequency.value = 110;
  oscB.frequency.value = 110.7; // slow beat between the two
  env.gain.value = 0.12;
  lfo.type = 'sine';
  lfo.frequency.value = 0.15;
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(env.gain);
  oscA.connect(env);
  oscB.connect(env);
  env.connect(master);
  oscA.start();
  oscB.start();
  lfo.start();
  bedNodes = {
    stop: () => {
      const now = ctx?.currentTime ?? 0;
      env.gain.linearRampToValueAtTime(0, now + 0.2);
      window.setTimeout(() => {
        oscA.stop();
        oscB.stop();
        lfo.stop();
      }, 300);
    },
  };
}

function stopBedNow(): void {
  if (bedTimer !== null) {
    window.clearInterval(bedTimer);
    bedTimer = null;
  }
  bedNodes?.stop();
  bedNodes = null;
}

function playBed(bed: Bed): void {
  stopBedNow();
  if (!bed || !active()) return;
  if (bed === 'trail') startTrailBed();
  else startNightBed();
}

/**
 * Declare the ambient bed for the current scene. Cheap to call on every
 * scene create; restarts only on change. Muted: remembered, not played.
 */
export function setBed(bed: Bed): void {
  if (bed === currentBed && (bed === null || bedNodes !== null || bedTimer !== null)) return;
  currentBed = bed;
  if (active()) playBed(bed);
  else stopBedNow();
}

// ---------------------------------------------------------------------------
// Stings
// ---------------------------------------------------------------------------

export function sting(kind: 'death' | 'verifier'): void {
  if (!active() || !ctx) return;
  const t = ctx.currentTime + 0.02;
  if (kind === 'death') {
    // Descending minor lament. The sprint is over.
    note(392, t, 0.3, 'square', 0.3);
    note(311, t + 0.32, 0.3, 'square', 0.3);
    note(233, t + 0.64, 0.7, 'square', 0.3);
    note(58, t + 0.64, 1.0, 'triangle', 0.5);
  } else {
    // Verifier pass: ascending major blip. Machine-checkable joy.
    note(523, t, 0.09, 'square', 0.28);
    note(659, t + 0.09, 0.09, 'square', 0.28);
    note(784, t + 0.18, 0.09, 'square', 0.28);
    note(1047, t + 0.27, 0.25, 'square', 0.3);
  }
}

// ---------------------------------------------------------------------------
// The control — corner button + M key
// ---------------------------------------------------------------------------

function syncControl(): void {
  const btn = document.getElementById(CONTROL_ID);
  if (!btn) return;
  const muted = isMuted();
  btn.textContent = muted ? '♪×' : '♪✓';
  btn.setAttribute('aria-label', muted ? 'Sound off. Turn sound on (M)' : 'Sound on. Mute (M)');
  btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  btn.title = muted ? 'Sound: OFF (M)' : 'Sound: ON (M)';
}

/**
 * Mount the mute control (fixed, top-right) and the M shortcut. Idempotent;
 * call once at boot. The overlay root is pointer-transparent, so the button
 * mounts as its own child.
 */
export function mountAudioControl(): void {
  if (document.getElementById(CONTROL_ID)) return;
  const root = document.getElementById('overlay') ?? document.body;
  const btn = document.createElement('button');
  btn.id = CONTROL_ID;
  btn.type = 'button';
  btn.addEventListener('click', () => toggleMute());
  root.appendChild(btn);
  syncControl();

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    const t = e.target;
    // Never steal M from a text field (epitaphs mention Morale a lot).
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    toggleMute();
  });
}
