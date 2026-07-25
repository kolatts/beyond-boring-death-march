/**
 * The hidden /notice route (spec §17). GitHub Pages has no server routes,
 * so the route is a query flag or hash: `?notice=1` or `#/notice`.
 *
 * Renders a MANDATORY COMPLIANCE NOTICE for the game itself — manila
 * paper, 1988 software-manual register — ending with the MIT licence text
 * (imported verbatim from LICENSE) and an instruction to go ship
 * something. When the route matches, the game does not boot: compliance
 * takes precedence over delivery, as is traditional.
 *
 * Prose lives in content/notice.json (spec §2); this file is layout only.
 */
import notice from '../content/notice.json';
import licenseText from '../../LICENSE?raw';

interface NoticeSection {
  n: string;
  title: string;
  body: string[];
}

interface NoticeContent {
  heading: string;
  docLine: string;
  sections: NoticeSection[];
  closing: string;
}

const CONTENT = notice as NoticeContent;

/** True when the current URL requests the notice route. */
export function noticeRequested(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('notice') === '1') return true;
  const hash = window.location.hash.replace(/\/+$/, '');
  return hash === '#/notice' || hash === '#notice';
}

/** Render the notice full-page. Call instead of booting Phaser. */
export function renderNotice(): void {
  document.title = 'MANDATORY COMPLIANCE NOTICE — Beyond Boring: Death March';
  const root = document.getElementById('overlay') ?? document.body;
  document.body.classList.add('notice-mode');

  const page = document.createElement('div');
  page.className = 'compliance-notice';

  const esc = escapeHtml;
  const sections = CONTENT.sections
    .map(
      (s) => `
        <h2>${esc(s.n)}. ${esc(s.title)}</h2>
        ${s.body.map((p) => `<p>${esc(p)}</p>`).join('')}`,
    )
    .join('');

  page.innerHTML = `
    <div class="compliance-paper" role="document">
      <div class="compliance-stamp" aria-hidden="true">RECEIVED</div>
      <h1>${esc(CONTENT.heading)}</h1>
      <p class="compliance-docline">${esc(CONTENT.docLine)}</p>
      <hr />
      ${sections}
      <pre class="compliance-licence">${esc(licenseText.trim())}</pre>
      <hr />
      <p class="compliance-closing">${esc(CONTENT.closing)}</p>
      <p><a class="compliance-return" href="./">Return to the trail</a></p>
    </div>`;

  root.appendChild(page);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
