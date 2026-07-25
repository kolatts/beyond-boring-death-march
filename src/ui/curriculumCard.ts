/**
 * Curriculum Card ("FIELD NOTE") modal — spec §10.1 — plus the Field
 * Journal collection (localStorage) that the pause menu / score screen can
 * read. Shared by every minigame: call showCurriculumCard('card_id') AFTER
 * the joke has landed, never before.
 *
 * DOM overlay (not Phaser) so it is screen-reader reachable and keyboard
 * dismissable. Styling hooks live in ui/styles.css (.field-note*).
 */
import curriculum from '../content/curriculum.json';

export interface CurriculumCard {
  id: string;
  n: string;
  whatHappened: string;
  whyItWorks: string;
  inYourJob: string;
  link: string;
}

const CARDS: CurriculumCard[] = curriculum as CurriculumCard[];
const JOURNAL_KEY = 'bbdm:journal';

/**
 * True while a Field Note modal is on screen. Scenes should guard their own
 * window-level key handlers with this (Phaser listeners registered at boot
 * can still see events before the modal's capture listener in some
 * dispatch paths, e.g. synthetic events targeted at window).
 */
export function isFieldNoteOpen(): boolean {
  return document.querySelector('.field-note-backdrop') !== null;
}

export function getCard(id: string): CurriculumCard | undefined {
  return CARDS.find((c) => c.id === id);
}

/** Card ids collected this browser, in collection order. */
export function journalEntries(): string[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function collect(id: string): void {
  const seen = journalEntries();
  if (!seen.includes(id)) {
    seen.push(id);
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(seen));
    } catch {
      /* storage full/blocked: the lesson still displays */
    }
  }
}

/**
 * Show a Field Note modal. Resolves when dismissed (Enter/Esc/click).
 * Unknown ids resolve immediately (content and code can drift in dev;
 * never break gameplay over a missing lesson).
 */
export function showCurriculumCard(id: string): Promise<void> {
  const card = getCard(id);
  if (!card) {
    console.warn(`curriculumCard: unknown id "${id}"`);
    return Promise.resolve();
  }
  collect(id);

  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay') ?? document.body;
    const root = document.createElement('div');
    root.className = 'field-note-backdrop';
    root.innerHTML = `
      <div class="field-note" role="dialog" aria-modal="true" aria-labelledby="fn-title">
        <div class="field-note-head" id="fn-title">&#9484;&#9472; FIELD NOTE ${escapeHtml(card.n)} &#9472;&#9488;</div>
        <h2>WHAT JUST HAPPENED</h2>
        <p>${escapeHtml(card.whatHappened)}</p>
        <h2>WHY IT WORKS THAT WAY</h2>
        <p>${escapeHtml(card.whyItWorks)}</p>
        <h2>IN YOUR ACTUAL JOB</h2>
        <p>${escapeHtml(card.inYourJob)}</p>
        <p class="field-note-link">READ MORE &#8594;
          <a href="${escapeHtml(card.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortLink(card.link))}</a>
        </p>
        <button type="button" class="field-note-close">FILE THIS NOTE (Enter)</button>
      </div>`;

    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      // stopImmediatePropagation + preventDefault: stopPropagation alone
      // still lets other same-node (window) listeners — i.e. Phaser — see
      // the dismissing keypress and act on it mid-scene.
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    root.querySelector<HTMLButtonElement>('.field-note-close')?.addEventListener('click', close);
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });

    overlay.appendChild(root);
    root.querySelector<HTMLButtonElement>('.field-note-close')?.focus();
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shortLink(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
