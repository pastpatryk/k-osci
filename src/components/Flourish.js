import { html } from './html.js';

export function Flourish() {
  return html`
    <div class="decoration" aria-hidden="true">
      <svg viewBox="0 0 140 32" fill="none">
        <path d="M2 22 C 20 2, 50 32, 70 12 S 120 22, 138 8"
              stroke="#8b5a9f" stroke-width="1.2" stroke-linecap="round" fill="none" />
        <circle cx="38" cy="15" r="2.2" fill="#e8b4d0" />
        <circle cx="78" cy="12" r="2" fill="#e8b4d0" />
        <circle cx="112" cy="16" r="2.4" fill="#e8b4d0" />
      </svg>
    </div>
  `;
}
